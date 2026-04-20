"""
LLM service wrapping Gemini 2 Flash for candidate validation.

The LLM is used ONLY for validation and reasoning — never for
retrieval, embedding, or raw image processing.  It receives the
user's text description and candidate metadata, then selects the
best match with structured JSON output.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from config import get_settings
from services.json_utils import extract_json_payload

logger = logging.getLogger(__name__)

# ── Validation Prompt ─────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a plant disease diagnosis validator for a high-performance Agentic Agrotech system.

ROLE:
- You receive a set of candidate diagnoses retrieved via vector similarity search for a scanned crop/pest region.
- The candidates ONLY contain "cropType" and "disease" metadata. They DO NOT provide treatment plans or survival formulas.
- Your job is to VALIDATE the candidates and ACT AS A DYNAMIC REASONING AGENT to formulate the precise treatment and survival indicators needed by our downstream agents.

RULES:
- Do NOT perform retrieval. Candidates are already provided.
- You MUST use your Gemini agricultural intelligence to dynamically generate "treatmentPlan", "survivalProb", "severity", and "severityScore" based on the matched disease/pest.
- You MUST output valid JSON — no markdown, no extra text.

OUTPUT FORMAT (strictly):
{
  "cropType": "<The type of plant detected (e.g., 'Tomato', 'Padi'). If it's a standalone bug, output 'Pest'>",
  "disease": "<The specific disease or pest identified (e.g., 'Late Blight', 'Rice Blast'). Use 'Healthy' if none>",
  "severity": "<Must be 'High', 'Moderate', or 'Low'>",
  "severityScore": <A normalized decimal between 0.0 and 1.0 representing mathematical severity severity>,
  "treatmentPlan": "<The recommended chemical or action, e.g., 'Fungicide A', 'Copper Spray'>",
  "survivalProb": <A decimal between 0.0 and 1.0, probability the crop survives if treated>
}

If NO candidate is relevant or it is a healthy plant, respond with:
"disease": "Healthy", "severity": "Low", "severityScore": 0.0, "survivalProb": 1.0, "treatmentPlan": "None"
"""

ASSISTANT_SYSTEM_PROMPT_BASE = """\
You are PadiGuard AI Assistant, a practical farming copilot.

You will receive a structured diagnosis result from the internal diagnosis agents.
Your job is to turn that diagnosis into a farmer-friendly response.

Rules:
- Be concise, clear, and actionable.
- Mention what was detected and confidence context in plain language.
- Do not hallucinate unavailable lab data.
- If recommendationSource is pesticideCatalog and recommendedPesticides is present, keep those pesticide names as the primary recommendation and do not replace them.
- If disease is Apple Scab, clearly mention Apple Scab management priorities.
"""

ENGLISH_REPLY_HEADERS = (
    "What This Is",
    "Treatment Plan",
    "Immediate Actions",
    "Recheck Time",
)

MALAY_REPLY_HEADERS = (
    "Apa Ini",
    "Pelan Rawatan",
    "Tindakan Segera",
    "Masa Semakan Semula",
)

LOW_CONFIDENCE_ENGLISH_REPLY_HEADERS = (
    "What This Looks Like",
    "Why Confidence Is Low",
    "Next Step",
)

LOW_CONFIDENCE_MALAY_REPLY_HEADERS = (
    "Apa Yang Kelihatan",
    "Kenapa Keyakinan Rendah",
    "Langkah Seterusnya",
)

_MALAY_HINT_WORDS = {
    "apa",
    "adakah",
    "bagaimana",
    "dengan",
    "daun",
    "dalam",
    "dan",
    "ini",
    "jika",
    "kawasan",
    "kenapa",
    "langkah",
    "masa",
    "perlu",
    "pokok",
    "rawatan",
    "saya",
    "segera",
    "selepas",
    "serangan",
    "serangga",
    "sila",
    "tanaman",
    "tolong",
    "untuk",
    "yang",
}

_ENGLISH_HINT_WORDS = {
    "action",
    "disease",
    "how",
    "immediate",
    "is",
    "my",
    "next",
    "please",
    "plan",
    "recheck",
    "should",
    "treatment",
    "what",
    "why",
}

_SEVERITY_TO_MALAY = {
    "high": "Tinggi",
    "moderate": "Sederhana",
    "low": "Rendah",
}

_AGRICULTURE_HINT_WORDS = {
    "agri",
    "agriculture",
    "crop",
    "crops",
    "field",
    "farm",
    "farmland",
    "farming",
    "fertilizer",
    "fertiliser",
    "greenhouse",
    "graft",
    "grafting",
    "garden",
    "gardening",
    "harvest",
    "harvesting",
    "horticulture",
    "irrigation",
    "manure",
    "mulch",
    "nursery",
    "orchard",
    "paddy",
    "padi",
    "pest",
    "pests",
    "plant",
    "planting",
    "plants",
    "prune",
    "pruning",
    "seed",
    "seedling",
    "seedlings",
    "soil",
    "spray",
    "spraying",
    "sow",
    "sowing",
    "transplant",
    "tree",
    "trees",
    "yield",
    "weed",
    "weeds",
}


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _trim_text(value: Any, default: str = "Unknown") -> str:
    text = str(value or "").strip()
    return text or default


def _looks_agriculture_prompt(user_prompt: str) -> bool:
    text = (user_prompt or "").lower()
    if any(phrase in text for phrase in ("farm management", "crop management", "planting", "orchard", "soil", "fertilizer", "fertiliser", "irrigation", "pest control", "weed control", "harvest", "pruning")):
        return True

    tokens = re.findall(r"[a-z']+", text)
    return any(token in _AGRICULTURE_HINT_WORDS for token in tokens)


def _agriculture_refusal(language: str) -> str:
    if language == "ms":
        return "Pembantu ini hanya menjawab soalan berkaitan pertanian. Sila tanya tentang tanaman, penanaman, tanah, pengairan, perosak, baja, tuaian, atau pengurusan ladang."

    return "This assistant only answers agriculture-related questions. Please ask about crops, planting, soil, irrigation, pests, fertilizer, harvesting, or farm management."


def _agriculture_fallback(language: str) -> str:
    if language == "ms":
        return "Sila beritahu tanaman, lokasi, dan tahap pertumbuhan supaya saya boleh beri cadangan yang lebih tepat."

    return "Please share the crop, location, and growth stage so I can give a more specific recommendation."


def detect_farmer_language(user_prompt: str) -> str:
    """Detect the farmer-facing reply language from the user prompt.

    Returns:
        "en" for English or "ms" for Malay.
    """
    text = (user_prompt or "").lower()
    malay_score = 0
    english_score = 0

    if "bahasa melayu" in text or "bahasa malaysia" in text or "dalam melayu" in text:
        malay_score += 3
    if " in malay" in text:
        malay_score += 2
    if " in english" in text:
        english_score += 2

    tokens = re.findall(r"[a-z']+", text)
    malay_score += sum(1 for token in tokens if token in _MALAY_HINT_WORDS)
    english_score += sum(1 for token in tokens if token in _ENGLISH_HINT_WORDS)

    return "ms" if malay_score >= 2 and malay_score >= english_score else "en"


def _get_reply_headers(language: str) -> tuple[str, str, str, str]:
    return MALAY_REPLY_HEADERS if language == "ms" else ENGLISH_REPLY_HEADERS


def _get_low_confidence_reply_headers(language: str) -> tuple[str, str, str]:
    return LOW_CONFIDENCE_MALAY_REPLY_HEADERS if language == "ms" else LOW_CONFIDENCE_ENGLISH_REPLY_HEADERS


def _build_assistant_system_prompt(language: str) -> str:
    section_1, section_2, section_3, section_4 = _get_reply_headers(language)

    if language == "ms":
        language_rules = (
            "- You MUST answer in Malay (Bahasa Melayu) only.\n"
            "- Use only Malay sentences. Do not mix in English or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )
    else:
        language_rules = (
            "- You MUST answer in English only.\n"
            "- Use only English sentences. Do not mix in Malay or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )

    return (
        f"{ASSISTANT_SYSTEM_PROMPT_BASE}\n"
        f"{language_rules}"
        "- You MUST include these section headers exactly:\n"
        f"    1) {section_1}\n"
        f"    2) {section_2}\n"
        f"    3) {section_3}\n"
        f"    4) {section_4}"
    )


def _build_low_confidence_system_prompt(language: str) -> str:
    section_1, section_2, section_3 = _get_low_confidence_reply_headers(language)

    if language == "ms":
        language_rules = (
            "- You MUST answer in Malay (Bahasa Melayu) only.\n"
            "- Use only Malay sentences. Do not mix in English or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )
    else:
        language_rules = (
            "- You MUST answer in English only.\n"
            "- Use only English sentences. Do not mix in Malay or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )

    return (
        f"{ASSISTANT_SYSTEM_PROMPT_BASE}\n"
        f"{language_rules}"
        "- The photo confidence is low, so you MUST be cautious and explicit about uncertainty.\n"
        "- Do NOT present the diagnosis as certain.\n"
        "- You MUST include these section headers exactly:\n"
        f"    1) {section_1}\n"
        f"    2) {section_2}\n"
        f"    3) {section_3}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. SUPERVISOR — Primary response generation
# ─────────────────────────────────────────────────────────────────────────────
SUPERVISOR_SYSTEM_PROMPT_BASE = """\
You are AcreZen AI Response Agent.

You serve farmers who grow any crop type — rice, vegetables, fruits, herbs,
cash crops, orchards, or mixed farms. You receive structured task outputs
from specialist agents and produce exactly one farmer-facing reply per turn.

You never mention internal agents, JSON keys, system prompts, validation
pipelines, or any technical identifier. The farmer must always feel they are
speaking to a single, knowledgeable farm assistant.

════════════════════════════════════════
ABSOLUTE CONSTRAINTS  (never violate)
════════════════════════════════════════
  [A1] Never invent data. If a field is absent from context, treat it as
       unknown — do not estimate, hallucinate, or borrow from general
       knowledge to fill gaps.
  [A2] Never end a reply mid-sentence, after a preposition, or without a
       complete closing thought.
  [A3] Never expose internal structure: no agent names, no JSON keys, no
       prompt language, no validation terminology.
  [A4] Never ask more than one follow-up question per reply.
  [A5] Never contradict data present in the structured context.
  [A6] Do not reference previous conversation turns — no chat history is
       available. Treat every message as the opening of a new conversation.

════════════════════════════════════════
CONTEXT RULES
════════════════════════════════════════
── LOCATION ──────────────────────────
  • `location` present → use that saved farm name exactly as written.
    Do not say "your device", "detected location", or paraphrase the name.
  • `location` absent (common on photo-chat path) → omit location entirely.
    Do not invent, assume, or substitute a placeholder name.
  • `lat`/`lng` present but `location` absent → use coordinates only to
    support weather lookups internally; never expose raw coordinates in the
    reply text.

── WEATHER ───────────────────────────
  • Answer all weather and spray-timing questions exclusively from
    `weatherSnapshot`. Never cite general climate knowledge as live data.
  • Forecast dates present → state the exact date
    (e.g. "rain is expected on Wednesday, 23 April").
    Never use vague phrases: "soon", "in a few days", "coming days", or
    "later this week" are forbidden when a date is available.
  • `weatherSnapshot` absent → state clearly that live weather data is
    unavailable and advise the farmer to verify local conditions before
    any spray or irrigation decision.
  • Every weather sentence must be grammatically complete.

── INVENTORY ─────────────────────────
  • `inventory` present → always include:
      1. A one-line total stock summary.
      2. Every low-stock item listed by name and current quantity.
    Do not omit any low-stock item even if there are many.
  • `inventory` absent but farmer asks about stock → acknowledge the data
    is not currently accessible and advise a manual check.

── SCAN / DIAGNOSIS ──────────────────
  • Scan context present → reply must cover all four pillars in order:
      1. Crop and variety (if known)
      2. Disease, pest, or condition identified
      3. Severity level
      4. Recommended treatment or action
    Do not merge or skip any pillar.
  • Low-confidence scan → lead with a plain-language caveat that the image
    was unclear, give the most probable finding with an explicit uncertainty
    note, then ask the farmer to retake the photo in better lighting or at
    closer range before acting on the result.
  • Multi-region scan → address each affected region individually with its
    own disease / severity / treatment note, listed in the order they appear
    in context. Do not collapse them into a single vague statement.
  • No scan data present → do not guess or approximate a diagnosis.

── CROP SCOPE ────────────────────────
  • This agent covers all crops without exception: staple grains (rice,
    maize, wheat), vegetables, legumes, fruits, tree crops, cash crops,
    herbs, spices, and ornamental or mixed-use plants.
  • Never refuse or hedge a crop question because the crop is not rice.
  • When crop type is stated in context or by the farmer, tailor advice to
    that specific crop's biology, growth stage, and regional norms.
  • When crop type is unknown, ask exactly one clarifying question rather
    than giving generic advice that may be harmful.

════════════════════════════════════════
REPLY PRIORITY ORDER  (enforce strictly)
════════════════════════════════════════
Evaluate each level before proceeding to the next.

  LEVEL 1 — SAFETY BLOCK
    If spray conditions are unsafe (rain imminent within hours, wind above
    safe threshold, temperature outside label range, or humidity extreme):
    state the safety issue FIRST, before any other content. Do not bury it.

  LEVEL 2 — TREATMENT ROI
    If disease severity, crop growth stage, or remaining crop value makes
    treatment economically unviable: state this FIRST before recommending
    any product or action.

  LEVEL 3 — SPREAD RISK
    If disease or pest spread risk to adjacent plants or plots is flagged:
    instruct isolation, removal, or monitoring of neighbouring crops BEFORE
    giving treatment steps for the affected plant.

  LEVEL 4 — DIRECT ANSWER
    Answer the farmer's actual question using only available context.
    Be specific: name the product, rate, timing, or action directly.
    Do not generalise when the data supports specificity.

  LEVEL 5 — FOLLOW-UP (only if Level 4 is blocked)
    If critical data is genuinely missing and prevents a safe or accurate
    answer, ask exactly ONE concise, targeted question and stop.
    Do not attempt a partial answer alongside the question.

════════════════════════════════════════
STYLE AND FORMAT
════════════════════════════════════════
  • Language: always match the user's message language exactly — Malay,
    English, or code-switched Malay-English. Do not switch languages mid-reply
    unless the farmer does.
  • Format: plain flowing prose or short numbered steps for action lists.
    No markdown headers, no bullet symbols, no bold/italic markers.
    Farmers read on mobile in bright sunlight — keep it clean and scannable.
  • Length: as short as the answer allows. Add length only when safety,
    multi-region, or multi-pillar diagnosis genuinely requires it.
  • Tone: direct, practical, and respectful. Avoid filler phrases:
    "Great question!", "Certainly!", "Of course!" are forbidden openers.
  • Completeness: every sentence must be grammatically complete. Every reply
    must end with a full stop or equivalent terminal punctuation.
"""


# ─────────────────────────────────────────────────────────────────────────────
# 2. REPLY VALIDATION — Judge only, never generate
# ─────────────────────────────────────────────────────────────────────────────
REPLY_VALIDATION_SYSTEM_PROMPT = """\
You are AcreZen Response Validation Agent.

You evaluate whether a farmer-facing assistant reply correctly and completely
answers the user's question given the structured context that was available.

You do NOT generate the primary answer.
You do NOT add advice or commentary beyond the schema fields.
Return valid JSON only — no prose, no markdown fences, no extra keys,
no trailing commas.

════════════════════════════════════════
VERDICT DEFINITIONS  (choose exactly one)
════════════════════════════════════════
  pass    — Reply is complete, fully accurate to context, safe, and directly
            answers the farmer's question. No repair needed.

  rewrite — Reply exists but contains one or more fixable violations: wrong
            or assumed location, vague date when a specific date exists,
            missing diagnosis pillar, omitted safety warning, truncation,
            wrong language, invented data, or exposed internals.
            The repair agent can fix this without new context.

  clarify — The structured context is genuinely insufficient to produce a
            safe or accurate answer, and asking the farmer one targeted
            question is the correct next action. Use only when the gap is
            a missing input, not a drafting error.

════════════════════════════════════════
SCORING RUBRIC  (score: integer 0–100)
════════════════════════════════════════
Start at 100. Deduct for each violation present.
A single reply may accumulate multiple deductions.

  CRITICAL (each -25)
    • Truncated — reply ends mid-sentence, after a preposition, or without
      a complete closing thought → also set truncated: true
    • Invented data — weather, diagnosis, inventory, or location not present
      in the structured context was stated as fact

  MAJOR (each -20)
    • Wrong location — device/assumed location used when saved location was
      available in context
    • Vague date — "soon", "in a few days", "coming days", or similar used
      when forecast dates were present in context
    • Safety warning omitted — spray conditions were flagged as unsafe but
      reply did not lead with the safety block
    • Crop mismatch — advice given for a different crop than the one stated
      in context or by the farmer

  STANDARD (each -15)
    • Diagnosis incomplete — scan context present and diagnosis asked, but
      one or more of: crop, disease, severity, treatment is missing from reply
    • Spread risk omitted — spread risk was flagged in context but isolation
      or monitoring instruction was not included
    • Low-confidence caveat missing — scan was low-confidence but no clarity
      caveat or retake instruction appeared in reply
    • Multi-region collapsed — multiple scan regions were present but reply
      merged them into a single vague statement

  MINOR (each -10)
    • Inventory gap — inventory context present but summary or low-stock
      items were not mentioned when inventory was the question topic
    • Language mismatch — reply language differs from user message language
      → also set language_mismatch: true
    • Internals exposed — agent names, JSON keys, "validation", "prompt",
      or system terminology appeared in the reply
      → also set exposed_internals: true
    • Filler opener — reply began with "Great question!", "Certainly!",
      "Of course!", or equivalent

  MINOR (each -5)
    • Multiple follow-up questions — more than one question asked in reply
    • Markdown symbols used — headers, bullets, bold, or italic markers
      present in reply

════════════════════════════════════════
PHOTO-PATH SPECIAL RULES
════════════════════════════════════════
  • Location and lat/lng are NOT sent in photo-path requests.
    Do NOT penalise the reply for omitting location on this path.
    Set photo_path: true when this applies.
  • Low-confidence caveat and retake instruction are mandatory on the
    low-confidence photo branch. Penalise -15 if absent.
  • Multi-region replies must address each region individually.
    Penalise -15 if collapsed.

════════════════════════════════════════
CONSISTENCY RULES
════════════════════════════════════════
  • Apply the same rubric regardless of crop type. Do not relax standards
    for less common crops.
  • Do not award partial credit for a partially met requirement —
    the requirement is either met or it is not.
  • If score drops to 60 or below, verdict must be rewrite or clarify.
  • If score is 61–79, verdict should be rewrite unless the only gap
    is a missing input that only the farmer can provide.
  • If score is 80–100 with no violations, verdict must be pass.

════════════════════════════════════════
OUTPUT SCHEMA  (strict — no extra keys)
════════════════════════════════════════
{
  "verdict": "pass|rewrite|clarify",
  "score": 0,
  "reason": "Single sentence stating the primary issue or confirming pass.",
  "missing_requirements": [],
  "unsupported_claims": [],
  "truncated": false,
  "needs_specific_date": false,
  "language_mismatch": false,
  "exposed_internals": false,
  "photo_path": false,
  "low_confidence_caveat_missing": false,
  "multi_region_collapsed": false,
  "safety_warning_omitted": false,
  "crop_mismatch": false,
  "repair_instruction": "Precise, actionable instruction for the repair agent. Empty string if verdict is pass.",
  "follow_up_question": "The single best question to ask the farmer if verdict is clarify. Empty string otherwise."
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# 3. REPLY REWRITE — Repair agent, receives full validation payload
# ─────────────────────────────────────────────────────────────────────────────
REPLY_REWRITE_SYSTEM_PROMPT_BASE = """\
You are AcreZen Response Repair Agent.

You receive four inputs:
  1. The original farmer message.
  2. The structured context that was available to the primary agent.
  3. The flawed draft reply.
  4. The validation payload (JSON) produced by the validation agent.

Your sole job is to produce one corrected, complete, farmer-facing reply that
resolves every issue listed in the validation payload without introducing
new violations.

════════════════════════════════════════
ABSOLUTE CONSTRAINTS  (same as primary agent)
════════════════════════════════════════
  [A1] Never invent data. Use only what is in the structured context.
  [A2] Never end a reply mid-sentence or without a complete closing thought.
  [A3] Never expose internal structure — no agent names, JSON keys, prompt
       language, "validation", "repair", or system terminology.
  [A4] Never ask more than one follow-up question.
  [A5] Never contradict context.
  [A6] No chat history is available. Do not reference prior turns.

════════════════════════════════════════
REPAIR WORKFLOW  (execute in this order)
════════════════════════════════════════
STEP 1 — READ THE VALIDATION FLAGS
  Load the validation JSON. Note the verdict, score, every flag set to true,
  missing_requirements, unsupported_claims, and repair_instruction.
  Address every listed issue. Do not skip any.

STEP 2 — LANGUAGE
  • If language_mismatch is true or if the draft language differs from the
    farmer's message: rewrite the entire reply in the farmer's language.
    Do not translate mechanically — rewrite naturally.
  • If languages match: preserve the original language throughout.

STEP 3 — STRIP VIOLATIONS
  • Remove any invented facts listed in unsupported_claims.
  • Remove any internal terminology (agent names, JSON, "validation", etc.).
  • Remove any markdown formatting symbols.
  • Remove any filler openers ("Great question!" etc.).

STEP 4 — APPLY REPAIRS IN PRIORITY ORDER
  Safety block
    If safety_warning_omitted is true: insert the safety warning as the
    very first sentence of the reply before any other content.

  Location
    If location is in context: replace any wrong or assumed location
    reference with the exact saved farm name.
    If photo_path is true and location is absent: remove all location
    references from the draft entirely — do not substitute a placeholder.

  Date specificity
    If needs_specific_date is true and forecast dates exist in context:
    replace every vague time phrase with the specific forecast date.
    If multiple dates are relevant, use the most directly applicable one.
    Do not use "soon", "in a few days", "coming days", or "later this week".

  Diagnosis completeness
    If diagnosis is incomplete per missing_requirements:
    ensure crop, disease, severity, and treatment all appear, in that order,
    before any other advisory content.
    If low_confidence_caveat_missing is true: insert a one-sentence clarity
    caveat and a retake instruction immediately before the tentative finding.
    If multi_region_collapsed is true: split the diagnosis into one paragraph
    per affected region, each with its own disease / severity / treatment.

  Spread risk
    If spread_risk present in context and was omitted: add the isolation or
    monitoring instruction immediately after the diagnosis section.

  Inventory
    If inventory context is present and missing from the draft: append a
    one-line stock summary and a list of every low-stock item by name and
    quantity at the end of the reply.

  Crop mismatch
    If crop_mismatch is true: revise all advice to match the crop type
    stated in the context or by the farmer. Do not leave advice that
    targets the wrong crop.

  Truncation
    If truncated is true: do not restart from scratch.
    Continue from the point where the draft cut off, maintaining the same
    tone and language, and bring the reply to a natural, complete close.

STEP 5 — FINAL CHECK BEFORE OUTPUT
  □ Every sentence is grammatically complete.
  □ Reply ends with terminal punctuation.
  □ No invented data.
  □ No internal terminology.
  □ No markdown symbols.
  □ Language matches the farmer's message throughout.
  □ No more than one follow-up question (and only if context is insufficient).
  □ Priority order respected: safety → ROI → spread → answer → follow-up.
  □ All flags from the validation payload are resolved.

Output the corrected reply only. Do not output the validation JSON,
explanations, or any meta-commentary.
"""


# ─────────────────────────────────────────────────────────────────────────────
# 4. AGRICULTURE ADVICE — Standalone advisory agent (all crops)
# ─────────────────────────────────────────────────────────────────────────────
AGRICULTURE_ADVICE_SYSTEM_PROMPT_BASE = """\
You are AcreZen Agriculture Advice Agent.

You serve farmers who grow any crop type: staple grains (rice, maize, wheat,
sorghum), vegetables (leafy, fruiting, root), legumes, fruits and berries,
tree crops (oil palm, rubber, cocoa, coffee), cash crops, herbs, spices, and
ornamental or mixed-use plants. No crop category is outside your scope.

════════════════════════════════════════
ABSOLUTE CONSTRAINTS
════════════════════════════════════════
  [A1] Never invent data — no fabricated weather readings, yield figures,
       pesticide labels, or regulatory approvals.
  [A2] Never end a reply mid-sentence.
  [A3] Never expose internal agents, prompts, JSON, or validation language.
  [A4] Never ask more than one follow-up question per reply.
  [A5] No chat history is available. Treat every message as a fresh start.
  [A6] Never give crop-specific advice when the crop is unknown — ask first.

════════════════════════════════════════
SCOPE GATE
════════════════════════════════════════
  In scope: agriculture, horticulture, crop science, soil science, irrigation,
  pest and disease management, fertilisation, post-harvest handling, farm
  economics, and agri-environmental questions with a direct farming application.

  Out of scope: general cooking, politics, finance unrelated to farm inputs,
  human medicine, and any topic with no clear farming relevance.

  Borderline: if the question has a clear farming application (e.g. general
  chemistry relevant to pesticide mixing, general biology relevant to plant
  disease), answer only the agricultural angle and nothing else.

  Out-of-scope response: decline briefly and politely in the farmer's language,
  offer to help with any farming question, and stop. Do not attempt a partial
  answer to an out-of-scope question.

════════════════════════════════════════
CONTEXT USAGE
════════════════════════════════════════
  • Use only context explicitly provided. Do not substitute general knowledge
    for missing data fields.
  • Location present → reference naturally.
    Location absent → do not guess or name a place.
  • Weather data present → incorporate into spray timing, irrigation, or
    harvest window advice as directly relevant.
    Weather data absent and relevant → note that local conditions must be
    verified before acting; do not fabricate a forecast.
  • Scan / diagnosis context present → incorporate findings into advice;
    do not contradict or ignore them.
  • Inventory context present → factor current stock into any product
    recommendation (do not recommend items that show zero stock without
    flagging the shortage).

════════════════════════════════════════
ANSWER QUALITY STANDARDS
════════════════════════════════════════
  CROP SPECIFICITY
    • Always tailor advice to the exact crop stated. Never give generic
      advice that applies equally to all crops when the crop is known.
    • State the crop name at least once in the reply when giving diagnosis
      or treatment advice so there is no ambiguity.
    • For tropical crops (oil palm, rubber, durian, banana, cocoa, paddy,
      chilli, etc.): apply tropical-climate defaults for temperature, rainfall,
      and pest pressure unless the farmer specifies otherwise.

  CHEMICAL AND INPUT RECOMMENDATIONS
    • Always name the active ingredient(s) alongside any brand name.
    • State the recommended application rate or dilution range.
    • Include any re-entry interval, pre-harvest interval, or safety
      precaution relevant to the product.
    • If the product has known resistance issues for this pest or disease,
      note it and recommend rotation with an alternative mode of action.
    • Do not recommend a product that is outside the farmer's current
      inventory if inventory context shows it is out of stock — suggest
      alternatives or flag the gap.

  INTEGRATED PEST MANAGEMENT (IPM)
    • When recommending pest or disease control, follow IPM priority:
        1. Cultural controls (spacing, sanitation, resistant varieties)
        2. Biological controls (beneficial insects, biopesticides)
        3. Chemical controls (only when threshold is exceeded or risk is high)
    • Do not jump straight to chemical recommendations without briefly
      noting whether non-chemical options apply.

  GROWTH STAGE AWARENESS
    • When growth stage is known, calibrate all advice to that stage.
      A fungicide safe at vegetative stage may be phytotoxic at flowering.
    • If growth stage is unknown and it is material to the answer, ask for
      it as your one follow-up question.

  ECONOMIC THRESHOLD
    • When infestation or disease severity is low, note whether treatment
      cost is likely to exceed yield benefit before recommending intervention.

  MISSING INFORMATION
    • If the crop type is unknown: ask for it. Do not generalise.
    • If a key agronomic detail (growth stage, soil type, pest description,
      symptom location on plant) is genuinely needed and absent: ask for
      exactly ONE detail — the most critical missing piece — and stop.
    • Do not stack multiple clarifying questions in one reply.

════════════════════════════════════════
STYLE AND FORMAT
════════════════════════════════════════
  • Language: match the farmer's message exactly — Malay, English, or
    code-switched Malay-English. Do not shift language mid-reply.
  • Format: plain prose or short numbered steps for action sequences.
    No markdown headers, no bullet symbols, no bold or italic markers.
  • Tone: direct, respectful, practical. No filler openers.
  • Length: use only as many words as the answer requires.
  • Completeness: every sentence must end properly. Every reply must close
    with terminal punctuation and a complete thought.
"""


def _build_supervisor_system_prompt(language: str) -> str:
    if language == "ms":
        language_rules = (
            "- You MUST answer in Malay (Bahasa Melayu) only.\n"
            "- Use only Malay sentences. Do not mix in English or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )
    else:
        language_rules = (
            "- You MUST answer in English only.\n"
            "- Use only English sentences. Do not mix in Malay or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
        )

    return f"{SUPERVISOR_SYSTEM_PROMPT_BASE}\n{language_rules}"


def _format_reason_suffix(language: str, reason: str | None) -> str:
    if not reason:
        return ""

    if language == "ms":
        return (
            "\n\nCatatan\n"
            "Sistem diagnosis sedang berjalan dalam mod terhad. Ambil semula gambar untuk pengesahan sebelum keputusan rawatan akhir."
        )

    return f"\n\nNote\n{reason}"


def build_farmer_fallback_dialogue(
    scan_result: dict[str, Any],
    user_prompt: str,
    reason: str | None = None,
) -> str:
    """Build a deterministic fallback reply in English or Malay."""
    language = detect_farmer_language(user_prompt)

    disease = str(scan_result.get("disease", "Unknown")).strip() or "Unknown"
    crop_type = str(scan_result.get("cropType", "Unknown")).strip() or "Unknown"
    severity_raw = str(scan_result.get("severity", "Moderate")).strip() or "Moderate"
    severity_score = _safe_float(scan_result.get("severityScore", 0.0), 0.0)
    treatment_plan = str(scan_result.get("treatmentPlan", "Consult agrologist")).strip()
    survival_prob = _safe_float(scan_result.get("survivalProb", 0.0), 0.0)
    recommended_raw = scan_result.get("recommendedPesticides", scan_result.get("recommended_pesticides", []))
    if not isinstance(recommended_raw, list):
        recommended_raw = []
    recommended_pesticides = [
        str(item).strip()
        for item in recommended_raw
        if str(item).strip()
    ]
    recommendation_source = str(
        scan_result.get("recommendationSource", scan_result.get("recommendation_source", "")),
    ).strip().lower()
    disease_normalized = disease.lower()

    if language == "ms":
        disease_label = disease if disease else "Tidak Konklusif"
        severity_label = _SEVERITY_TO_MALAY.get(severity_raw.lower(), severity_raw)
        plan_text = treatment_plan or "Sila ambil semula gambar close-up yang jelas sebelum memilih rawatan."

        if disease_normalized in {"healthy", "normal"}:
            plan_text = "Buat masa ini jangan guna racun dahulu. Teruskan pemantauan dan catat gejala baru."
        elif disease_normalized in {"unknown", "unknown disease", "inconclusive", "error", ""}:
            disease_label = "Tidak Konklusif"
            plan_text = (
                "Keputusan belum jelas. Ambil semula gambar close-up kawasan simptom dalam pencahayaan baik sebelum pilih rawatan."
            )
        elif recommendation_source == "pesticidecatalog" and recommended_pesticides:
            plan_text = (
                "Rujukan katalog racun: "
                + ", ".join(recommended_pesticides)
                + ". Ikut kadar label dan tempoh pra-tuai sebelum aplikasi."
            )

        reason_suffix = _format_reason_suffix(language, reason)
        return (
            f"Apa Ini\n{disease_label} (Jenis tanaman: {crop_type}, Tahap keterukan: {severity_label}, Skor: {severity_score:.2f})\n\n"
            f"Pelan Rawatan\n{plan_text}\n\n"
            "Tindakan Segera\n"
            "1. Asingkan daun atau pokok yang jelas bergejala untuk kurangkan jangkitan silang.\n"
            "2. Simpan rekod lokasi dan masa gambar untuk perbandingan semakan seterusnya.\n"
            f"3. Guna nilai kebarangkalian hidup {survival_prob:.2f} sebagai rujukan bersama pemerhatian ladang.\n\n"
            "Masa Semakan Semula\nAmbil semula gambar kawasan sama selepas 24-48 jam; jika tompok merebak, tingkatkan rawatan segera."
            f"{reason_suffix}"
        )

    disease_label = disease if disease else "Inconclusive"
    plan_text = treatment_plan or "Please retake a clear close-up photo before deciding treatment."

    if disease_normalized in {"healthy", "normal"}:
        plan_text = "Do not spray immediately. Keep monitoring and record any new symptoms."
    elif disease_normalized in {"unknown", "unknown disease", "inconclusive", "error", ""}:
        disease_label = "Inconclusive"
        plan_text = (
            "The result is not clear yet. Retake a close-up photo of the symptom area in good lighting before selecting treatment."
        )
    elif recommendation_source == "pesticidecatalog" and recommended_pesticides:
        plan_text = (
            "Catalog-based pesticides: "
            + ", ".join(recommended_pesticides)
            + ". Follow product label rate and pre-harvest interval before application."
        )

    reason_suffix = _format_reason_suffix(language, reason)
    return (
        f"What This Is\n{disease_label} (Crop type: {crop_type}, Severity: {severity_raw}, Score: {severity_score:.2f})\n\n"
        f"Treatment Plan\n{plan_text}\n\n"
        "Immediate Actions\n"
        "1. Isolate leaves or plants with obvious symptoms to reduce cross-spread.\n"
        "2. Record photo location and capture time for follow-up comparison.\n"
        f"3. Use survival probability {survival_prob:.2f} as a reference together with field observations.\n\n"
        "Recheck Time\nRetake photos of the same area in 24-48 hours; if lesions expand, escalate treatment immediately."
        f"{reason_suffix}"
    )


def _reply_looks_truncated(text: str) -> bool:
    cleaned = " ".join(str(text or "").strip().split())
    if not cleaned:
        return True

    if cleaned.endswith((".", "!", "?", ")", '"', "'")):
        return False

    if cleaned.endswith((",", ":", ";", "-", "—")):
        return True

    words = re.findall(r"[A-Za-z0-9']+", cleaned)
    if not words:
        return False

    return words[-1].lower() in {
        "a",
        "an",
        "and",
        "as",
        "at",
        "because",
        "before",
        "by",
        "for",
        "from",
        "in",
        "into",
        "of",
        "on",
        "or",
        "over",
        "the",
        "to",
        "under",
        "until",
        "with",
        "within",
        "without",
    }


def _reply_requires_specific_date(
    user_prompt: str,
    assistant_reply: str,
    context: dict[str, Any],
) -> bool:
    prompt_text = (user_prompt or "").lower()
    if not re.search(r"\b(rain|weather|forecast|spray)\b", prompt_text):
        return False

    if not re.search(r"\b(when|what date|specific date|date)\b", prompt_text):
        return False

    weather_snapshot = context.get("weather_snapshot") if isinstance(context, dict) else {}
    if not isinstance(weather_snapshot, dict):
        weather_snapshot = {}

    dashboard_summary = context.get("dashboard_summary") if isinstance(context, dict) else {}
    if not isinstance(dashboard_summary, dict):
        dashboard_summary = {}

    forecast_sources = []
    if weather_snapshot.get("forecast"):
        forecast_sources.append(weather_snapshot.get("forecast"))
    dashboard_weather = dashboard_summary.get("weatherSnapshot") if isinstance(dashboard_summary, dict) else {}
    if isinstance(dashboard_weather, dict) and dashboard_weather.get("forecast"):
        forecast_sources.append(dashboard_weather.get("forecast"))

    forecast_dates: list[str] = []
    for forecast_list in forecast_sources:
        if not isinstance(forecast_list, list):
            continue
        for entry in forecast_list:
            if not isinstance(entry, dict):
                continue
            date_text = str(entry.get("date") or "").strip()
            if date_text:
                forecast_dates.append(date_text)

    if not forecast_dates:
        return False

    reply_text = str(assistant_reply or "")
    reply_dates = set(re.findall(r"\b\d{4}-\d{2}-\d{2}\b", reply_text))
    if reply_dates.intersection(forecast_dates):
        return False

    for date_text in forecast_dates:
        if date_text and date_text in reply_text:
            return False

    return True


def _normalize_reply_validation_result(
    result: dict[str, Any],
    *,
    assistant_reply: str,
    user_prompt: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    verdict = str(result.get("verdict") or "rewrite").strip().lower()
    if verdict not in {"pass", "rewrite", "clarify"}:
        verdict = "rewrite"

    score = int(round(max(0.0, min(100.0, _safe_float(result.get("score"), 0.0)))))
    missing_requirements = [
        str(item).strip()
        for item in (result.get("missing_requirements") or [])
        if str(item).strip()
    ]
    unsupported_claims = [
        str(item).strip()
        for item in (result.get("unsupported_claims") or [])
        if str(item).strip()
    ]

    truncated = bool(result.get("truncated")) or _reply_looks_truncated(assistant_reply)
    needs_specific_date = bool(result.get("needs_specific_date")) or _reply_requires_specific_date(
        user_prompt=user_prompt,
        assistant_reply=assistant_reply,
        context=context,
    )
    reason = _trim_text(result.get("reason"), default="Reply needs review.")
    repair_instruction = _trim_text(result.get("repair_instruction"), default="")
    follow_up_question = _trim_text(result.get("follow_up_question"), default="")

    if truncated and verdict == "pass":
        verdict = "rewrite"
    if needs_specific_date and verdict == "pass":
        verdict = "rewrite"
    if (missing_requirements or unsupported_claims) and verdict == "pass":
        verdict = "rewrite"

    if needs_specific_date and not any("date" in item.lower() for item in missing_requirements):
        missing_requirements.append("Specific forecast date")

    return {
        "verdict": verdict,
        "score": score,
        "reason": reason,
        "missing_requirements": missing_requirements,
        "unsupported_claims": unsupported_claims,
        "truncated": truncated,
        "needs_specific_date": needs_specific_date,
        "repair_instruction": repair_instruction,
        "follow_up_question": follow_up_question,
    }


def _compact_forecast_entries(forecast: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for entry in (forecast or [])[:5]:
        if not isinstance(entry, dict):
            continue

        compacted.append(
            {
                "date": _trim_text(entry.get("date"), default=""),
                "day": _trim_text(entry.get("day"), default=""),
                "condition": _trim_text(entry.get("condition"), default="Unknown"),
                "rainChance": int(_safe_float(entry.get("rainChance"), default=0.0)),
                "wind": _trim_text(entry.get("wind"), default=""),
                "sprayWindow": _trim_text(entry.get("sprayWindow"), default="Delay spraying"),
                "safe": bool(entry.get("safe")),
                "temperature_high": entry.get("temperature_high"),
                "temperature_low": entry.get("temperature_low"),
            }
        )

    return compacted


def _compact_weather_snapshot(weather_snapshot: dict[str, Any]) -> dict[str, Any]:
    compacted = {
        "condition": _trim_text(weather_snapshot.get("condition"), default="Unknown"),
        "temperatureC": _safe_float(weather_snapshot.get("temperatureC"), default=0.0),
        "humidity": int(_safe_float(weather_snapshot.get("humidity"), default=0.0)),
        "windKmh": _safe_float(weather_snapshot.get("windKmh"), default=0.0),
        "windDirection": _trim_text(weather_snapshot.get("windDirection"), default=""),
        "rainInHours": weather_snapshot.get("rainInHours"),
        "safeToSpray": bool(weather_snapshot.get("safeToSpray")),
        "rain_probability": int(_safe_float(weather_snapshot.get("rain_probability"), default=0.0)),
        "best_spray_window": _trim_text(weather_snapshot.get("best_spray_window"), default=""),
        "advisory": _trim_text(weather_snapshot.get("advisory"), default=""),
        "recommendation": _trim_text(weather_snapshot.get("recommendation"), default=""),
        "forecast": _compact_forecast_entries(weather_snapshot.get("forecast") or []),
    }

    return compacted


# ── Retry Configuration ───────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1.0

VERTEX_MODEL_PREFIX = "publishers/google/models/"
DEFAULT_VERTEX_MODEL_CANDIDATES = (
    "publishers/google/models/gemini-2.5-flash",
    "publishers/google/models/gemini-2.0-flash-001",
)


def _normalize_vertex_model_name(model_name: str) -> str:
    normalized = (model_name or "").strip()
    if not normalized:
        return DEFAULT_VERTEX_MODEL_CANDIDATES[0]
    if normalized.startswith(VERTEX_MODEL_PREFIX):
        return normalized
    return f"{VERTEX_MODEL_PREFIX}{normalized}"


def _build_vertex_model_candidates(model_name: str) -> list[str]:
    candidates = [_normalize_vertex_model_name(model_name)]
    for fallback_model in DEFAULT_VERTEX_MODEL_CANDIDATES:
        if fallback_model not in candidates:
            candidates.append(fallback_model)
    return candidates


def _is_vertex_model_not_found(exc: Exception) -> bool:
    message = str(exc).lower()
    return "publisher model" in message and "not found" in message


class LLMService:
    """Validates retrieval candidates using Gemini 2 Flash."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(
            vertexai=True,
            project=settings.GCP_PROJECT_ID,
            location=settings.GCP_REGION,
        )
        self._model_candidates = _build_vertex_model_candidates(settings.GEMINI_MODEL_NAME)
        self._model_name = self._model_candidates[0]

    def _generate_content_with_model_fallback(
        self,
        *,
        contents: Any,
        config: types.GenerateContentConfig,
    ):
        for index, model_name in enumerate(self._model_candidates):
            try:
                return self._client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
            except Exception as exc:
                has_fallback = index < len(self._model_candidates) - 1
                if has_fallback and _is_vertex_model_not_found(exc):
                    next_model = self._model_candidates[index + 1]
                    logger.warning(
                        "Vertex model unavailable (%s). Retrying with %s",
                        model_name,
                        next_model,
                    )
                    continue
                raise

    # ── Public API ────────────────────────────────────────────────────

    async def validate_candidates(
        self,
        user_input: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Ask Gemini to analyze image and diagnose disease using vector search results as reference.

        Args:
            user_input: Dict with the user's original query context (may be None for direct analysis).
            candidates: List of similar cases retrieved from vector search.
                        Used as reference context for Gemini's diagnosis.

        Returns:
            Parsed JSON dict with keys matching ``ScanResult`` schema:
            ``cropType``, ``disease``, ``severity``, ``severityScore``,
            ``treatmentPlan``, ``survivalProb``.
        """
        user_text = user_input.get("text") or "No text description provided."
        candidate_summary = json.dumps(candidates, indent=2, default=str)

        user_prompt = (
            f"## User Query\n{user_text}\n\n"
            f"## Retrieved Candidates ({len(candidates)} total)\n"
            f"{candidate_summary}\n\n"
            "Select the best matching candidate and provide your reasoning."
        )

        fallback = {
            "cropType": "Unknown",
            "disease": "Unknown",
            "severity": "Moderate",
            "severityScore": 0.0,
            "treatmentPlan": "Consult Agrologist",
            "survivalProb": 0.5,
        }

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.2,
                        max_output_tokens=1024,
                    ),
                )

                raw_text = response.text.strip()
                logger.info("LLM validation response received (%d chars)", len(raw_text))

                try:
                    result = extract_json_payload(raw_text)
                    if not isinstance(result, dict):
                        logger.error(
                            "LLM returned non-object JSON (%s)",
                            type(result).__name__,
                        )
                        if attempt == MAX_RETRIES:
                            return fallback
                        continue
                    return result
                except json.JSONDecodeError:
                    logger.error("LLM returned invalid JSON: %s", raw_text[:200])
                    if attempt == MAX_RETRIES:
                        return fallback
                    # Retry — the model may produce valid JSON on the next attempt

            except Exception as e:
                if attempt == MAX_RETRIES:
                    logger.error(
                        "LLM call failed after %d attempts: %s", MAX_RETRIES, e,
                    )
                    return fallback
                logger.warning(
                    "LLM attempt %d/%d failed: %s — retrying in %.1fs...",
                    attempt, MAX_RETRIES, e, RETRY_DELAY_SECONDS,
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback  # unreachable, satisfies type checker

    async def generate_assistant_dialogue(
        self,
        scan_result: dict[str, Any],
        user_prompt: str,
    ) -> str:
        """Generate a conversational assistant response from diagnosis output."""
        language = detect_farmer_language(user_prompt)
        required_sections = _get_reply_headers(language)
        fallback = build_farmer_fallback_dialogue(scan_result, user_prompt)
        target_language = "Malay (Bahasa Melayu)" if language == "ms" else "English"

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Diagnosis result JSON:\n{json.dumps(scan_result, ensure_ascii=True)}\n\n"
            f"Target response language: {target_language}\n"
            "Generate a direct reply addressed to the farmer."
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_assistant_system_prompt(language),
                        temperature=0.35,
                        max_output_tokens=380,
                    ),
                )
                text = (response.text or "").strip()
                if text:
                    if all(section in text for section in required_sections):
                        return text
                    return f"{text}\n\n{fallback}"
            except Exception as e:
                logger.warning(
                    "Assistant dialogue attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    e,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def generate_consolidated_assistant_dialogue(
        self,
        scan_results: list[dict[str, Any]],
        user_prompt: str,
    ) -> str:
        """Generate a consolidated assistant response for multiple diagnosed regions."""
        language = detect_farmer_language(user_prompt)
        target_language = "Malay (Bahasa Melayu)" if language == "ms" else "English"

        results_summary = json.dumps(
            [
                {
                    "cropType": r.get("cropType", "Unknown"),
                    "disease": r.get("disease", "Unknown"),
                    "severity": r.get("severity", "Low"),
                    "severityScore": _safe_float(r.get("severityScore", 0.0), 0.0),
                    "treatmentPlan": r.get("treatmentPlan", "None"),
                }
                for r in scan_results
            ],
            indent=2,
        )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Multiple crop diagnoses from one photo:\n{results_summary}\n\n"
            f"Target response language: {target_language}\n"
            "Generate a consolidated reply addressing all detected crops with priority guidance."
        )

        required_sections = _get_reply_headers(language)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_assistant_system_prompt(language),
                        temperature=0.35,
                        max_output_tokens=500,
                    ),
                )
                text = (response.text or "").strip()
                if text:
                    if all(section in text for section in required_sections):
                        return text

                    fallback = build_farmer_fallback_dialogue(
                        scan_results[0] if scan_results else {},
                        user_prompt,
                    )
                    return f"{text}\n\n{fallback}"
            except Exception as e:
                logger.warning(
                    "Consolidated dialogue attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    e,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        fallback = build_farmer_fallback_dialogue(
            scan_results[0] if scan_results else {},
            user_prompt,
        )
        return fallback

    async def generate_weather_recommendation(
        self,
        *,
        temperature_c: int,
        humidity: int,
        wind_kmh: int,
        rain_probability: int,
        rain_in_hours: float | None,
        safe_to_spray: bool,
        best_spray_window: str,
        advisory: str,
    ) -> str:
        """Generate concise spray recommendation text from weather signals."""
        fallback = advisory or "Weather is unstable for spraying. Recheck conditions in the next cycle."

        rain_window = "none expected in next 12h" if rain_in_hours is None else f"expected in ~{rain_in_hours:.0f} hour(s)"
        spray_state = "safe to spray" if safe_to_spray else "not safe to spray now"

        prompt = (
            "You are an agronomy weather advisor. "
            "Given the weather snapshot, output exactly one short recommendation sentence for pesticide/fungicide spray timing.\n\n"
            f"Temperature: {temperature_c} C\n"
            f"Humidity: {humidity}%\n"
            f"Wind: {wind_kmh} km/h\n"
            f"Rain probability: {rain_probability}%\n"
            f"Rain window: {rain_window}\n"
            f"Current spray safety: {spray_state}\n"
            f"Best spray window: {best_spray_window}\n"
            f"Baseline advisory: {advisory}\n\n"
            "Constraints:\n"
            "- Keep under 25 words\n"
            "- No bullet points\n"
            "- Mention either timing or delay clearly\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=90,
                    ),
                )
                text = (response.text or "").strip()
                if text:
                    return " ".join(text.split())
            except Exception as exc:
                logger.warning(
                    "Weather recommendation attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def generate_zone_quick_review(
        self,
        *,
        zone_name: str,
        latest_disease: str,
        latest_severity: float,
        latest_confidence: float,
        trend_hint: str,
    ) -> str:
        """Generate a very short zone-specific health review sentence."""
        fallback = (
            f"{zone_name}: {latest_disease} at {latest_severity:.0f}% severity. "
            "Prioritize quick treatment and rescan soon."
        )

        prompt = (
            "You are an agronomy assistant. Produce exactly one short sentence for a dashboard quick review.\n\n"
            f"Zone: {zone_name}\n"
            f"Latest disease: {latest_disease}\n"
            f"Latest severity: {latest_severity:.0f}%\n"
            f"Latest confidence: {latest_confidence:.0f}%\n"
            f"Trend hint: {trend_hint}\n\n"
            "Constraints:\n"
            "- Maximum 22 words\n"
            "- No bullet points\n"
            "- Mention urgency/action clearly\n"
            "- Plain farmer-friendly language\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=80,
                    ),
                )

                text = " ".join((response.text or "").strip().split())
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Zone quick review attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def generate_low_confidence_photo_reply(
        self,
        *,
        user_prompt: str,
        scan_result: dict[str, Any] | None = None,
        scan_results: list[dict[str, Any]] | None = None,
    ) -> str:
        """Generate a cautious response for an uncertain photo scan."""
        language = detect_farmer_language(user_prompt)
        structured_payload = scan_results if scan_results is not None else [scan_result or {}]
        payload_text = json.dumps(structured_payload, indent=2, ensure_ascii=True, default=str)
        fallback = self._build_low_confidence_fallback(
            language=language,
            scan_result=scan_result or (scan_results[0] if scan_results else {}),
            scan_results=scan_results,
        )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Structured scan context:\n{payload_text}\n\n"
            "The scan confidence is low.\n"
            "Do not present the diagnosis as certain.\n"
            "Give the farmer a short reply with a direct warning, a simple reason, and one next step.\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_low_confidence_system_prompt(language),
                        temperature=0.25,
                        max_output_tokens=240,
                    ),
                )
                text = (response.text or "").strip()
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Low confidence photo reply attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def generate_supervisor_reply(
        self,
        *,
        user_prompt: str,
        context: dict[str, Any],
    ) -> str:
        """Generate a farmer-friendly response from structured task outputs."""
        language = detect_farmer_language(user_prompt)
        compact_context = self._compact_supervisor_context(context)
        context_text = json.dumps(compact_context, indent=2, ensure_ascii=True, default=str)
        fallback = self._build_supervisor_fallback(
            language=language,
            user_prompt=user_prompt,
            context=context,
        )

        weather_snapshot = compact_context.get("weather_snapshot") or {}
        weather_instructions = ""
        if weather_snapshot:
            weather_instructions = (
                "Weather guidance: use the forecast dates in the weather snapshot when the user asks when rain will return. "
                "If a forecast date is available, include it explicitly in YYYY-MM-DD format. "
                "Never stop the reply after a preposition or half-formed sentence.\n"
            )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Structured task outputs:\n{context_text}\n\n"
            f"{weather_instructions}"
            "Use only the structured task outputs.\n"
            "Answer the farmer directly and keep it short.\n"
            "If the data is incomplete, ask one clear follow-up question and stop.\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_supervisor_system_prompt(language),
                        temperature=0.25,
                        max_output_tokens=420,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
                    if _reply_looks_truncated(text):
                        continuation = await self._continue_supervisor_reply(
                            user_prompt=user_prompt,
                            context_text=context_text,
                            partial_text=text,
                            language=language,
                            weather_instructions=weather_instructions,
                        )
                        merged = self._merge_reply_segments(text, continuation)
                        if merged:
                            return merged
                    return text
            except Exception as exc:
                logger.warning(
                    "Supervisor reply attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def _continue_supervisor_reply(
        self,
        *,
        user_prompt: str,
        context_text: str,
        partial_text: str,
        language: str,
        weather_instructions: str = "",
    ) -> str:
        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Structured task outputs:\n{context_text}\n\n"
            f"Previous draft answer:\n{partial_text}\n\n"
            f"{weather_instructions}"
            "Continue the draft from the next word only. Do not repeat any part of the draft. "
            "Return only the missing continuation."
        )

        for attempt in range(1, 3):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_supervisor_system_prompt(language),
                        temperature=0.2,
                        max_output_tokens=160,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Supervisor continuation attempt %d/2 failed: %s",
                    attempt,
                    exc,
                )

            if attempt < 2:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return ""

    @staticmethod
    def _compact_supervisor_context(context: dict[str, Any]) -> dict[str, Any]:
        compacted = dict(context)

        weather_snapshot = compacted.get("weather_snapshot")
        if isinstance(weather_snapshot, dict):
            compacted["weather_snapshot"] = _compact_weather_snapshot(weather_snapshot)

        dashboard_summary = compacted.get("dashboard_summary")
        if isinstance(dashboard_summary, dict):
            compact_dashboard = dict(dashboard_summary)
            weather_snapshot_from_dashboard = compact_dashboard.get("weatherSnapshot")
            if isinstance(weather_snapshot_from_dashboard, dict):
                compact_dashboard["weatherSnapshot"] = _compact_weather_snapshot(weather_snapshot_from_dashboard)
            compacted["dashboard_summary"] = compact_dashboard

        return compacted

    @staticmethod
    def _merge_reply_segments(prefix: str, continuation: str) -> str:
        prefix_clean = " ".join(str(prefix or "").split())
        continuation_clean = " ".join(str(continuation or "").split())

        if not continuation_clean:
            return prefix_clean

        prefix_words = prefix_clean.split()
        continuation_words = continuation_clean.split()

        if prefix_words and continuation_words:
            previous_tail = prefix_words[-1].lower().strip(".,;:!?")
            next_head = continuation_words[0].lower().strip(".,;:!?")
            if previous_tail == next_head:
                continuation_words = continuation_words[1:]

        merged = " ".join(prefix_words + continuation_words).strip()
        return merged or prefix_clean

    async def generate_inventory_reply(
        self,
        *,
        user_prompt: str,
        inventory_summary: dict[str, Any],
    ) -> str:
        """Generate a short inventory status reply from structured stock data."""
        language = detect_farmer_language(user_prompt)
        items = inventory_summary.get("items") or []
        total_items = int(inventory_summary.get("total_items") or len(items))
        low_stock_count = int(inventory_summary.get("low_stock_count") or 0)
        payload_text = json.dumps(inventory_summary, indent=2, ensure_ascii=True, default=str)
        fallback = self._build_inventory_fallback(
            language=language,
            inventory_summary=inventory_summary,
        )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Inventory summary:\n{payload_text}\n\n"
            "Answer as a farm inventory assistant.\n"
            "Give the user a concise stock summary.\n"
            "If stock is low, say which items are low and advise restocking.\n"
            "Do not mention crop diagnosis or ask for crop/zone.\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            "You are PadiGuard's inventory assistant. "
                            "Use only the provided inventory summary. "
                            "Keep the answer short, practical, and farmer-friendly. "
                            "Do not mention diagnosis or weather."
                        ),
                        temperature=0.25,
                        max_output_tokens=220,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Inventory reply attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    async def validate_assistant_reply(
        self,
        *,
        user_prompt: str,
        assistant_reply: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Judge whether a Gemini reply fully satisfies the user's request."""
        language = detect_farmer_language(user_prompt)
        target_language = "Malay (Bahasa Melayu)" if language == "ms" else "English"
        compact_context = self._compact_supervisor_context(context)
        context_text = json.dumps(compact_context, indent=2, ensure_ascii=True, default=str)
        reply_text = str(assistant_reply or "").strip()

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Assistant reply:\n{reply_text}\n\n"
            f"Structured context:\n{context_text}\n\n"
            f"Target response language: {target_language}\n"
            "Evaluate whether the assistant reply fully answers the user message.\n"
            "If the reply is incomplete, truncated, unsupported, or missing a required specific date, mark it for rewrite.\n"
            "If the context is insufficient to answer safely, mark it for clarification."
        )

        fallback_result = _normalize_reply_validation_result(
            {
                "verdict": "rewrite" if _reply_looks_truncated(reply_text) or _reply_requires_specific_date(user_prompt, reply_text, compact_context) else "pass",
                "score": 0,
                "reason": "Validation unavailable.",
                "missing_requirements": [],
                "unsupported_claims": [],
                "truncated": False,
                "needs_specific_date": False,
                "repair_instruction": "",
                "follow_up_question": "",
            },
            assistant_reply=reply_text,
            user_prompt=user_prompt,
            context=compact_context,
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=REPLY_VALIDATION_SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.0,
                        max_output_tokens=320,
                    ),
                )
                raw_text = (response.text or "").strip()
                if not raw_text:
                    raise ValueError("Empty validation response")

                parsed = extract_json_payload(raw_text)
                if not isinstance(parsed, dict):
                    raise ValueError(f"Validation response was not a JSON object: {type(parsed).__name__}")

                return _normalize_reply_validation_result(
                    parsed,
                    assistant_reply=reply_text,
                    user_prompt=user_prompt,
                    context=compact_context,
                )
            except Exception as exc:
                logger.warning(
                    "Reply validation attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback_result

    async def rewrite_assistant_reply(
        self,
        *,
        user_prompt: str,
        assistant_reply: str,
        context: dict[str, Any],
        validation_result: dict[str, Any],
    ) -> str:
        """Ask Gemini to repair an incomplete or unsupported assistant reply."""
        language = detect_farmer_language(user_prompt)
        target_language = "Malay (Bahasa Melayu)" if language == "ms" else "English"
        compact_context = self._compact_supervisor_context(context)
        context_text = json.dumps(compact_context, indent=2, ensure_ascii=True, default=str)
        validation_text = json.dumps(validation_result, indent=2, ensure_ascii=True, default=str)
        reply_text = str(assistant_reply or "").strip()

        if language == "ms":
            language_rules = (
                "- You MUST answer in Malay (Bahasa Melayu) only.\n"
                "- Use only Malay sentences. Do not mix in English or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
            )
        else:
            language_rules = (
                "- You MUST answer in English only.\n"
                "- Use only English sentences. Do not mix in Malay or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
            )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Original assistant reply:\n{reply_text}\n\n"
            f"Structured context:\n{context_text}\n\n"
            f"Validation feedback:\n{validation_text}\n\n"
            f"Target response language: {target_language}\n"
            "Rewrite the reply so it fully answers the user message.\n"
            "If the context is still insufficient, ask one concise follow-up question instead of inventing facts.\n"
            "Return only the revised reply."
        )

        system_instruction = f"{REPLY_REWRITE_SYSTEM_PROMPT_BASE}\n{language_rules}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.2,
                        max_output_tokens=360,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Reply rewrite attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return reply_text

    async def generate_agriculture_reply(
        self,
        *,
        user_prompt: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Generate an agriculture-only fallback reply or a refusal for unrelated prompts."""
        language = detect_farmer_language(user_prompt)
        if not _looks_agriculture_prompt(user_prompt):
            return _agriculture_refusal(language)

        compact_context = self._compact_supervisor_context(context or {})
        context_text = json.dumps(compact_context, indent=2, ensure_ascii=True, default=str)
        fallback = _agriculture_fallback(language)

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Optional farm context:\n{context_text}\n\n"
            "Answer only if the request is about agriculture, horticulture, crops, plants, orchards, gardens, or farm management. "
            "If it is not agriculture-related, refuse politely and briefly. "
            "If it is agriculture-related but details are missing, ask one concise follow-up question."
        )

        if language == "ms":
            language_rules = (
                "- You MUST answer in Malay (Bahasa Melayu) only.\n"
                "- Use only Malay sentences. Do not mix in English or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
            )
        else:
            language_rules = (
                "- You MUST answer in English only.\n"
                "- Use only English sentences. Do not mix in Malay or Chinese, except unavoidable crop, disease, or product names from diagnosis data.\n"
            )

        system_instruction = f"{AGRICULTURE_ADVICE_SYSTEM_PROMPT_BASE}\n{language_rules}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._generate_content_with_model_fallback(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.25,
                        max_output_tokens=360,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "Agriculture reply attempt %d/%d failed: %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return fallback

    def _build_low_confidence_fallback(
        self,
        *,
        language: str,
        scan_result: dict[str, Any] | None,
        scan_results: list[dict[str, Any]] | None,
    ) -> str:
        if language == "ms":
            crop_type = _trim_text((scan_result or {}).get("cropType"), default="Tanaman")
            disease = _trim_text((scan_result or {}).get("disease"), default="Tidak jelas")
            if scan_results and len(scan_results) > 1:
                return (
                    "Apa Yang Kelihatan\n"
                    f"Beberapa kawasan menunjukkan {crop_type}: {disease}.\n\n"
                    "Kenapa Keyakinan Rendah\n"
                    "Gambar ini belum cukup jelas untuk pengesahan yang selamat.\n\n"
                    "Langkah Seterusnya\n"
                    "Ambil semula gambar dekat dalam cahaya baik. Jika simptom merebak, asingkan pokok dan semak semula."
                )

            return (
                "Apa Yang Kelihatan\n"
                f"{crop_type}: {disease}.\n\n"
                "Kenapa Keyakinan Rendah\n"
                "Gambar ini belum cukup jelas untuk pengesahan yang selamat.\n\n"
                "Langkah Seterusnya\n"
                "Ambil semula gambar dekat dalam cahaya baik. Jika simptom merebak, asingkan pokok dan semak semula."
            )

        crop_type = _trim_text((scan_result or {}).get("cropType"), default="Crop")
        disease = _trim_text((scan_result or {}).get("disease"), default="Unclear")
        if scan_results and len(scan_results) > 1:
            return (
                "What This Looks Like\n"
                f"Several areas suggest {crop_type}: {disease}.\n\n"
                "Why Confidence Is Low\n"
                "The photo is not clear enough for a safe diagnosis.\n\n"
                "Next Step\n"
                "Retake a close photo in good light. If the issue is spreading, isolate the plant and recheck soon."
            )

        return (
            "What This Looks Like\n"
            f"Possible issue: {disease} on {crop_type}.\n\n"
            "Why Confidence Is Low\n"
            "The photo is not clear enough for a safe diagnosis.\n\n"
            "Next Step\n"
            "Retake a close photo in good light. If the issue is spreading, isolate the plant and recheck soon."
        )

    def _build_supervisor_fallback(self, *, language: str, user_prompt: str, context: dict[str, Any]) -> str:
        recent_scan = context.get("recent_scan") or {}
        inventory_summary = context.get("inventory_summary") or {}
        weather_snapshot = context.get("weather_snapshot") or {}
        dashboard_summary = context.get("dashboard_summary")
        location = str(context.get("location") or "").strip()
        latest = recent_scan.get("latest_report") or {}

        location_prompt = bool(
            re.search(r"\b(location|my location|saved location|farm location|bound location|where am i|where is my farm)\b", user_prompt.lower())
        )

        if location_prompt:
            if language == "ms":
                return f"Lokasi ladang yang disimpan ialah {location}." if location else "Lokasi ladang belum disimpan. Sila kemas kini di Settings."

            return f"Your saved farm location is {location}." if location else "Your farm location is not saved yet. Please update it in Settings."

        if weather_snapshot:
            condition = _trim_text(weather_snapshot.get("condition"), default="unknown")
            temperature_c = _safe_float(weather_snapshot.get("temperatureC"), default=0.0)
            wind_kmh = _safe_float(weather_snapshot.get("windKmh"), default=0.0)
            rain_in_hours = weather_snapshot.get("rainInHours")
            rain_text = "no rain expected soon" if rain_in_hours is None else f"rain in about {_safe_float(rain_in_hours, default=0.0):.0f} hours"
            recommendation = _trim_text(weather_snapshot.get("recommendation") or weather_snapshot.get("advisory"), default="")
            spray_text = "safe to spray" if weather_snapshot.get("safeToSpray") else "not safe to spray yet"

            if language == "ms":
                prefix = f"Untuk {location}, " if location else ""
                return (
                    f"{prefix}cuaca {condition}, {temperature_c:.0f}C, angin {wind_kmh:.0f} km/j, dan {rain_text}. "
                    f"Ini {spray_text}. {recommendation}".strip()
                )

            prefix = f"For {location}, " if location else ""
            return (
                f"{prefix}weather is {condition}, {temperature_c:.0f}C, wind is {wind_kmh:.0f} km/h, and {rain_text}. "
                f"It is {spray_text}. {recommendation}".strip()
            )

        if inventory_summary:
            return self._build_inventory_fallback(language=language, inventory_summary=inventory_summary)

        if dashboard_summary:
            weather = dashboard_summary.get("weatherSnapshot") or {}
            financial = dashboard_summary.get("financialSummary") or {}
            zone_health = dashboard_summary.get("zoneHealthSummary") or {}

            if language == "ms":
                pieces: list[str] = []
                pieces.append(
                    f"Cuaca {_trim_text(weather.get('condition'), default='tidak jelas')}, angin {_trim_text(weather.get('windKmh'), default='0')} km/j, hujan dalam {_trim_text(weather.get('rainInHours'), default='n/a')} jam."
                )
                pieces.append(
                    f"ROI {_trim_text(financial.get('roiPercent'), default='0')}% dan kos rawatan RM {_trim_text(financial.get('treatmentCostRm'), default='0')}."
                )
                low_stock_item = financial.get("lowStockItem")
                if low_stock_item:
                    pieces.append(
                        f"Stok rendah: {_trim_text(low_stock_item, default='tidak diketahui')} tinggal {_trim_text(financial.get('lowStockLiters'), default='0')} liter."
                    )
                if zone_health:
                    pieces.append(
                        f"Zon perlukan perhatian: {_trim_text(zone_health.get('zonesNeedingAttention'), default='0')}."
                    )
                return " ".join(pieces)

            pieces = []
            pieces.append(
                f"Weather looks {_trim_text(weather.get('condition'), default='unclear')}, wind is {_trim_text(weather.get('windKmh'), default='0')} km/h, and rain is expected in {_trim_text(weather.get('rainInHours'), default='n/a')} hours."
            )
            pieces.append(
                f"ROI is {_trim_text(financial.get('roiPercent'), default='0')}% and treatment cost is RM {_trim_text(financial.get('treatmentCostRm'), default='0')}."
            )
            low_stock_item = financial.get("lowStockItem")
            if low_stock_item:
                pieces.append(
                    f"Low stock: {_trim_text(low_stock_item, default='unknown')} has {_trim_text(financial.get('lowStockLiters'), default='0')} liters left."
                )
            if zone_health:
                pieces.append(
                    f"Zones needing attention: {_trim_text(zone_health.get('zonesNeedingAttention'), default='0')}."
                )
            return " ".join(pieces)

        if latest:
            disease = _trim_text(latest.get("disease"), default="Unknown")
            severity = _trim_text(latest.get("severity"), default="Unknown")
            trend = _trim_text(recent_scan.get("trend"), default="Trend data is limited.")
            confidence = latest.get("confidence")
            confidence_text = ""
            if confidence is not None:
                confidence_text = f" Confidence {self._normalize_confidence(confidence) or 0}%."

            if language == "ms":
                return f"Ujian terakhir menunjukkan {disease} pada tahap {severity}.{confidence_text} {trend}"

            return f"Latest scan shows {disease} at {severity} severity.{confidence_text} {trend}"

        if language == "ms":
            return "Sila muat naik gambar yang lebih jelas atau beritahu saya tanaman dan zon yang perlu diperiksa."

        return "Please upload a clear photo or tell me which crop and zone you want checked."

    def _build_inventory_fallback(self, *, language: str, inventory_summary: dict[str, Any]) -> str:
        items = inventory_summary.get("items") or []
        total_items = int(inventory_summary.get("total_items") or len(items))
        low_stock_count = int(inventory_summary.get("low_stock_count") or 0)

        if not items:
            if language == "ms":
                return "Tiada rekod inventori ditemui untuk akaun anda."
            return "No inventory records were found for your account."

        top_items: list[str] = []
        for item in items[:3]:
            name = _trim_text(item.get("name"), default="Unknown item")
            liters = _safe_float(item.get("liters"), default=0.0)
            unit = _trim_text(item.get("unit"), default="liters")
            top_items.append(f"{name}: {liters:.1f} {unit}")

        if language == "ms":
            low_stock_note = f" {low_stock_count} item berada pada stok rendah." if low_stock_count else ""
            return f"Anda mempunyai {total_items} item inventori.{low_stock_note} {', '.join(top_items)}"

        low_stock_note = f" {low_stock_count} item are low on stock." if low_stock_count else ""
        return f"You have {total_items} inventory item(s).{low_stock_note} {', '.join(top_items)}"
