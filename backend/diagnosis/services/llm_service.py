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
from services.json_utils import extract_json_object, extract_json_payload

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
You are AcreZen, a friendly and practical farming assistant.

You may receive either:
1) A casual farmer message (greeting, general question, or quick check-in), OR
2) A structured "Diagnosis result JSON" from internal diagnosis agents.

Core rules:
- Be concise, clear, and actionable.
- Match the user's language (English or Malay).
- If greeted or asked what you can do, introduce yourself as AcreZen and briefly say you can help with disease detection, pest ID, weather-based spray timing, inventory/stock questions, and general crop advice.

Formatting rules:
- If "Diagnosis result JSON" is present in the prompt: use the structured format with the headings Finding / Actions / Treatment / Recheck.
- If there is NO diagnosis JSON (general chat or simple factual questions): reply in natural conversational prose with no section headers.

Grounding rules (always):
- Mention what was detected and confidence context in plain language when diagnosis data exists.
- Do not hallucinate unavailable lab data.
- If recommendationSource is pesticideCatalog and recommendedPesticides is present, keep those pesticide names as the primary recommendation and do not replace them.
- If disease is Apple Scab, clearly mention Apple Scab management priorities.
"""

ENGLISH_REPLY_HEADERS = (
    "Finding",
    "Actions",
    "Treatment",
    "Recheck",
)

MALAY_REPLY_HEADERS = (
    "Penemuan",
    "Tindakan",
    "Rawatan",
    "Semakan Semula",
)

LOW_CONFIDENCE_ENGLISH_REPLY_HEADERS = (
    "Finding",
    "Actions",
    "Treatment",
    "Recheck",
)

LOW_CONFIDENCE_MALAY_REPLY_HEADERS = (
    "Penemuan",
    "Tindakan",
    "Rawatan",
    "Semakan Semula",
)

ENGLISH_QUESTION_HEADER = "Question"
MALAY_QUESTION_HEADER = "Soalan"

REPLY_VALIDATION_SYSTEM_PROMPT = """\
You are AcreZen Reply Validation Agent.

Evaluate whether the assistant reply is complete, grounded in context, and farmer-friendly.
Return valid JSON only with this schema:
{
  "verdict": "pass" | "rewrite" | "clarify",
  "score": <0-100>,
  "reason": "<short reason>",
  "missing_requirements": ["<item>"],
  "unsupported_claims": ["<item>"],
  "truncated": <true|false>,
  "needs_specific_date": <true|false>,
  "repair_instruction": "<what to fix>",
  "follow_up_question": "<optional one question>"
}

First, decide whether this reply MUST use the structured headings format:
- If the structured context includes a photo scan payload (for example `scan_result` or `scan_results`), headings ARE required.
- Else, if the structured context includes an `intents` list that contains `diagnosis` or `spread`, headings ARE required.
- Otherwise (weather, inventory/resource, location, ROI/economy, greetings, general advice), headings are NOT required.

Rules:
- Mark verdict="rewrite" if markdown heading markers (#, ##, ###) appear.
- If headings are required: mark verdict="rewrite" if required sections are missing: Finding, Actions, Treatment, Recheck, or Malay equivalents Penemuan, Tindakan, Rawatan, Semakan Semula.
- If headings are NOT required: do NOT require those headings, and do NOT mark rewrite just because headings are absent.
- Mark verdict="rewrite" if unsupported claims or contradictory advice appears.
- Mark verdict="clarify" only when context is genuinely insufficient.
- Keep reason and repair_instruction concise and actionable.
"""

REPLY_REWRITE_SYSTEM_PROMPT_BASE = """\
You are AcreZen Reply Rewrite Agent.

Rewrite the assistant reply so it is complete, accurate, and easy to read.

Decide the format based on context:
- If the structured context includes a photo scan payload (for example `scan_result` or `scan_results`), OR an `intents` list containing `diagnosis` or `spread`: use the headings Finding, Actions, Treatment, Recheck.
- Otherwise: write natural conversational prose with no section headers.

Formatting rules (strict):
- Plain text only.
- No markdown markers (#, ##, ###, **, *, `_`).
- If using headings: put each heading on its own line (Finding, Actions, Treatment, Recheck), and write short point-form lines under each one prefixed with "- ". Keep Actions to at most 3 bullets.
- If NOT using headings: keep it short and practical, and ask at most one follow-up question (as a normal sentence).
- Do not invent facts beyond provided context.
"""

AGRICULTURE_ADVICE_SYSTEM_PROMPT_BASE = """\
You are AcreZen, a friendly and knowledgeable farming chat assistant.

Scope:
- Answer agriculture-related questions (crops, pests, diseases, soil, irrigation, fertilization, weather timing, spray planning, farm management).

Style:
- Use short, practical, friendly conversational prose (no forced templates).
- Match the user's language (English or Malay).
- If details are missing, ask exactly one natural follow-up question.

Formatting rules:
- Do NOT force any headings for general chat, greetings, or simple questions.
- Only use the headings Finding / Actions / Treatment / Recheck when the prompt includes scan/diagnosis data (for example a "Diagnosis result JSON" or a structured scan result) AND the user is asking about that diagnosis.
- Never start with "Finding:" when there is no scan/diagnosis data in the prompt.

Off-topic handling:
- If the question is off-topic, redirect warmly in 1–2 sentences (no cold refusals).
- If greeted or asked what you can do, introduce yourself as AcreZen and briefly say what you can help with.
"""

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


def _to_percent_int(value: Any) -> int | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if numeric <= 1.0:
        numeric *= 100.0

    numeric = max(0.0, min(100.0, numeric))
    return int(round(numeric))


def _format_percent(value: Any, default: str = "N/A") -> str:
    percent = _to_percent_int(value)
    if percent is None:
        return default
    return f"{percent}%"


def _get_question_header(language: str) -> str:
    return MALAY_QUESTION_HEADER if language == "ms" else ENGLISH_QUESTION_HEADER


def _normalize_heading_candidate(line: str) -> str:
    normalized = str(line or "")
    normalized = normalized.replace("：", ":")
    normalized = re.sub(r"^\s{0,3}#{1,6}\s*", "", normalized)
    normalized = re.sub(r"^\s*\d+\s*[\.)]\s*", "", normalized)
    normalized = re.sub(r"^\s*[\-\*•]+\s*", "", normalized)
    normalized = re.sub(r"[`*_]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _extract_heading_alias_match(
    normalized_line: str,
    heading_aliases: dict[str, str],
) -> tuple[str | None, str]:
    probe = normalized_line.strip()
    probe_lower = probe.lower()

    for alias in sorted(heading_aliases.keys(), key=len, reverse=True):
        alias_lower = alias.lower()
        if probe_lower == alias_lower:
            return heading_aliases[alias], ""

        for delimiter in (":", " -", " –", " —", " "):
            candidate_prefix = f"{alias_lower}{delimiter}"
            if probe_lower.startswith(candidate_prefix):
                trailing = probe[len(alias):].lstrip(" :.-–—")
                return heading_aliases[alias], trailing

    return None, ""


def _has_required_headings(text: str, headings: tuple[str, ...]) -> bool:
    if not headings:
        return True

    found: set[str] = set()
    required = {heading: heading.lower() for heading in headings}

    for raw_line in str(text or "").splitlines():
        normalized = _normalize_heading_candidate(raw_line)
        if not normalized:
            continue

        normalized_lower = normalized.lower()
        for heading, heading_lower in required.items():
            if normalized_lower == heading_lower:
                found.add(heading)
                break
            if normalized_lower.startswith(f"{heading_lower}:"):
                found.add(heading)
                break
            if normalized_lower.startswith(f"{heading_lower} "):
                found.add(heading)
                break

    return len(found) == len(headings)


def _build_structured_reply_example(headings: tuple[str, str, str, str]) -> str:
    section_1, section_2, section_3, section_4 = headings
    return (
        f"{section_1}\n"
        "- Example finding in one short sentence.\n\n"
        f"{section_2}\n"
        "- Example immediate action the farmer can do now.\n\n"
        f"{section_3}\n"
        "- Example treatment guidance with one clear step.\n\n"
        f"{section_4}\n"
        "- Example recheck timing in 24 to 48 hours."
    )


def _clean_reply_format(text: Any, language: str) -> str:
    raw_text = str(text or "").replace("\r\n", "\n").strip()
    if not raw_text:
        return ""

    section_1, section_2, section_3, section_4 = _get_reply_headers(language)
    question_heading = _get_question_header(language)
    heading_aliases = {
        "finding": section_1,
        "what this is": section_1,
        "what what this is": section_1,
        "what this looks like": section_1,
        "apa ini": section_1,
        "apa yang kelihatan": section_1,
        "penemuan": section_1,
        "actions": section_2,
        "immediate actions": section_2,
        "tindakan segera": section_2,
        "tindakan": section_2,
        "treatment": section_3,
        "treatment plan": section_3,
        "pelan rawatan": section_3,
        "rawatan": section_3,
        "recheck": section_4,
        "recheck time": section_4,
        "next step": section_4,
        "masa semakan semula": section_4,
        "langkah seterusnya": section_4,
        "semakan semula": section_4,
        "question": question_heading,
        "soalan": question_heading,
    }

    cleaned_lines: list[str] = []
    for raw_line in raw_text.split("\n"):
        line = raw_line.rstrip("\n")
        if not line.strip():
            cleaned_lines.append("")
            continue

        normalized = _normalize_heading_candidate(line)
        canonical_heading, trailing_text = _extract_heading_alias_match(
            normalized,
            heading_aliases,
        )
        if canonical_heading:
            cleaned_lines.append(canonical_heading)
            if trailing_text:
                cleaned_lines.append(
                    trailing_text if trailing_text.startswith("- ") else f"- {trailing_text}",
                )
            continue

        bullet_normalized = re.sub(r"^\s*[\*•]\s+", "- ", line.strip())
        bullet_normalized = re.sub(r"^\s*[–—]\s+", "- ", bullet_normalized)
        cleaned_lines.append(bullet_normalized)

    cleaned_text = "\n".join(cleaned_lines).strip()
    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text)
    return cleaned_text


def _looks_agriculture_prompt(user_prompt: str) -> bool:
    text = (user_prompt or "").lower()
    if any(phrase in text for phrase in ("farm management", "crop management", "planting", "orchard", "soil", "fertilizer", "fertiliser", "irrigation", "pest control", "weed control", "harvest", "pruning")):
        return True

    tokens = re.findall(r"[a-z']+", text)
    return any(token in _AGRICULTURE_HINT_WORDS for token in tokens)


def _is_casual_prompt(user_prompt: str) -> bool:
    text = (user_prompt or "").lower()
    casual_patterns = r"\b(hi|hello|hey|helo|hai|apa\s+khabar|good\s+morning|selamat|what\s+can\s+you\s+do|what\s+are\s+you|who\s+are\s+you|help\s+me|boleh\s+bantu)\b"
    return bool(re.search(casual_patterns, text))


def _agriculture_refusal(language: str) -> str:
    if language == "ms":
        return (
            "Hai! Saya AcreZen, pembantu ladang anda. "
            "Saya boleh bantu tentang tanaman, perosak, penyakit, tanah, cuaca, dan jadual semburan—ada apa di ladang hari ini?"
        )

    return (
        "Hey! I'm AcreZen, your farming assistant. "
        "I can help with crops, pests, diseases, soil, weather timing, and spray planning—what's going on with your farm today?"
    )


def _agriculture_fallback(language: str) -> str:
    if language == "ms":
        return (
            "Saya nak bantu, tapi perlukan maklumat lebih sedikit. "
            "Tanaman apa, lokasi ladang di mana, dan apa yang anda nampak sekarang?"
        )

    return (
        "I'd love to help, but I need a bit more to go on. "
        "What crop are you growing, where is your farm, and what are you seeing right now?"
    )


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


def _get_low_confidence_reply_headers(language: str) -> tuple[str, str, str, str]:
    return LOW_CONFIDENCE_MALAY_REPLY_HEADERS if language == "ms" else LOW_CONFIDENCE_ENGLISH_REPLY_HEADERS


def _build_assistant_system_prompt(language: str) -> str:
    section_1, section_2, section_3, section_4 = _get_reply_headers(language)
    question_heading = _get_question_header(language)

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
        "- Output plain text only. Do not use markdown markers (#, ##, ###, **, *, `_`).\n"
        "- Use this exact structure with subheadings on separate lines when diagnosis data is present:\n"
        f"    {section_1}\n"
        f"    {section_2}\n"
        f"    {section_3}\n"
        f"    {section_4}\n"
        "- Keep these subheading labels exactly as written above. Do not translate, rename, or stylize them.\n"
        "- Under each subheading, write short point-form lines prefixed with '- '.\n"
        f"- Keep {section_2} to at most 3 bullet points.\n"
        "- Keep percentages readable when present in context (for example, confidence or severity as %).\n"
        f"- Keep it interactive: add optional '{question_heading}' with exactly one bullet question only when clarification is needed.\n"
        "- If the user message is a greeting, casual question, or general inquiry with no diagnosis JSON present: respond in natural conversational prose. Do not use any section headers.\n"
        "- If diagnosis data is present in the prompt: use the Finding / Actions / Treatment / Recheck structure.\n"
    )


def _build_low_confidence_system_prompt(language: str) -> str:
    section_1, section_2, section_3, section_4 = _get_low_confidence_reply_headers(language)
    question_heading = _get_question_header(language)

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
        "- Output plain text only. Do not use markdown markers (#, ##, ###, **, *, `_`).\n"
        "- Use this exact structure with subheadings on separate lines:\n"
        f"    {section_1}\n"
        f"    {section_2}\n"
        f"    {section_3}\n"
        f"    {section_4}\n"
        "- Keep these subheading labels exactly as written above. Do not translate, rename, or stylize them.\n"
        "- Under each subheading, write short point-form lines prefixed with '- '.\n"
        f"- Keep {section_2} to at most 3 bullet points.\n"
        f"- Add optional '{question_heading}' with one bullet question if the farmer must retake a photo before treatment confirmation."
    )


# ─────────────────────────────────────────────────────────────────────────────
# SUPERVISOR_SYSTEM_PROMPT_BASE
# Replace your existing SCAN / DIAGNOSIS context rule block with this.
# Everything else in your supervisor prompt stays the same.
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
  [A7] Never begin a reply with filler phrases: "Hello!", "Great!",
       "Certainly!", "Of course!", "Based on the photo you uploaded",
       "Here's the diagnosis", or any equivalent opener.
  [A8] Never repeat the same diagnosis information twice in one reply.
       State each fact exactly once.
  [A9] Never expose raw numeric scores, probability floats, or JSON-style
       labels (e.g. "Score: 0.92", "survival probability 0.60",
       "Crop type: Padi") directly in farmer-facing text. Translate all
       numeric confidence and severity values into plain language only.

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
  • Forecast dates present → state the exact date.
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
  (See PHOTO REPLY FORMAT section below for exact rendering rules.)

  • Scan context present → reply must cover all four pillars:
      1. Crop and variety (if known)
      2. Disease, pest, or condition identified
      3. Severity level in plain language
      4. Recommended treatment or action
  • Low-confidence scan → lead with a plain-language caveat that the image
    was unclear, give the most probable finding with an explicit uncertainty
    note, then ask the farmer to retake the photo in better lighting or at
    closer range before acting on the result.
  • Multi-region scan → address each affected region individually with its
    own disease / severity / treatment note. Do not collapse them.
  • No scan data present → do not guess or approximate a diagnosis.

── CROP SCOPE ────────────────────────
  • This agent covers all crops without exception.
  • When crop type is stated in context, tailor advice to that specific
    crop's biology, growth stage, and regional norms.
  • When crop type is unknown, ask exactly one clarifying question.

════════════════════════════════════════
PHOTO REPLY FORMAT  (scan results only)
════════════════════════════════════════
When replying to a photo scan, follow this exact structure and no other.

STRUCTURE (4 parts, in this order):

  PART 1 — FINDING (1–2 sentences)
    Open directly with the crop name and what was found.
    State severity in plain descriptive language only.
    Forbidden: score numbers, float values, JSON labels, percentage strings
    pulled verbatim from the data, and the word "confidence" as a label.

    Severity translation table:
      score ≥ 0.85  → "severe" or "advanced"
      score 0.65–0.84 → "moderate"
      score 0.40–0.64 → "early stage" or "mild"
      score < 0.40  → "suspected" (and trigger low-confidence caveat)

    Confidence translation table (use only to qualify, not to label):
      confidence ≥ 0.85 → no qualification needed; state finding directly
      confidence 0.65–0.84 → "likely" before the disease name
      confidence < 0.65 → "possibly" + low-confidence caveat + retake request

    Example (correct):
      "Your rice crop shows signs of moderate Blast disease."

    Example (wrong — never do this):
      "Blast (Crop type: Padi, Severity: Moderate, Score: 0.92)"
      "Diagnosis: Blast | Severity 92% | Confidence 92% | Risk High"

  PART 2 — IMMEDIATE ACTIONS (numbered steps, plain prose)
    List only actions the farmer can realistically take today or tomorrow.
    Maximum 3 steps. Each step must be a complete, actionable sentence.
    Do not include internal monitoring instructions
    (e.g. "record photo location for follow-up comparison") — these are
    system instructions, not farmer actions.
    Do not expose internal fields like "survival probability" or
    "capture time" as farmer-facing guidance.

  PART 3 — TREATMENT (1–2 sentences)
    Name the recommended treatment approach directly.
    Include the active ingredient or method name, not just "consult someone".
    If a specific product or active ingredient is available in context,
    name it with its application rate.
    If context only provides a general recommendation, state it plainly
    without deferring entirely to a third party.

  PART 4 — MONITORING (1 sentence)
    State when and what to watch for next.
    Translate any numeric recheck intervals into plain language
    (e.g. "Check the same plants again in 24 to 48 hours" is correct;
    "Use survival probability 0.60 as a reference" is forbidden).

SPACING BETWEEN PARTS:
    Separate each part with a single blank line.
    No markdown headers. No bullet symbols. No bold or italic markers.
    The entire reply reads as four short natural paragraphs.

FORBIDDEN IN PHOTO REPLIES (in addition to [A1]–[A9]):
    • Any greeting or opener before Part 1.
    • Raw score floats or percentages used as labels.
    • JSON-style inline labels (key: value pairs in the reply text).
    • Repeating the diagnosis summary at the end after already stating it
      in Part 1 (violates [A8]).
    • "Consult agrologist" or equivalent as the sole treatment guidance —
      always include at least one concrete action alongside any referral.
    • Internal system phrases: "survival probability", "capture time",
      "photo location", "cross-spread", "field observations reference".

════════════════════════════════════════
REPLY PRIORITY ORDER  (enforce strictly)
════════════════════════════════════════
  LEVEL 1 — SAFETY BLOCK
    If spray conditions are unsafe: state this FIRST.

  LEVEL 2 — TREATMENT ROI
    If treatment is economically unviable given severity and crop stage:
    state this FIRST.

  LEVEL 3 — SPREAD RISK
    If spread risk is flagged: instruct isolation or monitoring of
    neighbouring crops BEFORE giving treatment steps.

  LEVEL 4 — DIRECT ANSWER
    Follow PHOTO REPLY FORMAT for scan replies.
    Be specific: name the product, rate, timing, or action directly.

  LEVEL 5 — FOLLOW-UP (only if Level 4 is blocked)
    Ask exactly ONE concise, targeted question and stop.

════════════════════════════════════════
STYLE AND FORMAT
════════════════════════════════════════
  • Language: always match the user's message language — Malay, English,
    or code-switched Malay-English.
  • Format: plain flowing prose or short numbered steps for action lists.
    No markdown headers, no bullet symbols, no bold/italic markers.
  • Length: as short as the answer allows.
  • Tone: direct, practical, respectful. No filler openers.
  • Completeness: every sentence must be grammatically complete and end
    with proper terminal punctuation.
"""


def _build_supervisor_system_prompt(language: str) -> str:
    section_1, section_2, section_3, section_4 = _get_reply_headers(language)
    question_heading = _get_question_header(language)

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
        f"{SUPERVISOR_SYSTEM_PROMPT_BASE}\n"
        f"{language_rules}"
        "- Format override (apply even if any earlier line conflicts):\n"
        "- Output plain text only. Do not use markdown markers (#, ##, ###, **, *, `_`).\n"
        "- If the prompt contains scan/diagnosis JSON and the user is asking about that diagnosis: use these headings on separate lines:\n"
        f"    {section_1}\n"
        f"    {section_2}\n"
        f"    {section_3}\n"
        f"    {section_4}\n"
        "- Under each heading (when used), write short point-form lines prefixed with '- '.\n"
        f"- Keep {section_2} to at most 3 bullet points when used.\n"
        "- Otherwise (general chat, weather, inventory, ROI): respond in natural conversational prose with no section headers.\n"
        f"- If clarification is required, ask exactly one question (you may prefix it with '{question_heading}' on its own line only when necessary).\n"
        "- If the user message is a greeting, casual question, or general inquiry with no diagnosis JSON present: respond in natural conversational prose. Do not use any section headers.\n"
        "- If diagnosis data is present in the prompt: use the Finding / Actions / Treatment / Recheck structure.\n"
    )


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
    section_1, section_2, section_3, section_4 = _get_reply_headers(language)
    question_heading = _get_question_header(language)

    disease = str(scan_result.get("disease", "Unknown")).strip() or "Unknown"
    crop_type = str(scan_result.get("cropType", "Unknown")).strip() or "Unknown"
    severity_raw = str(scan_result.get("severity", "Moderate")).strip() or "Moderate"
    severity_percent = _format_percent(
        scan_result.get("severity_percent", scan_result.get("severityScore")),
        default="",
    )
    confidence_percent = _format_percent(scan_result.get("confidence"), default="")
    survival_percent = _format_percent(scan_result.get("survivalProb"), default="")
    treatment_plan = str(scan_result.get("treatmentPlan", "Consult agrologist")).strip()
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
    reason_text = _trim_text(reason, default="") if reason else ""

    if language == "ms":
        disease_label = disease if disease else "Tidak Konklusif"
        severity_label = _SEVERITY_TO_MALAY.get(severity_raw.lower(), severity_raw)
        plan_text = treatment_plan or "Ambil semula gambar close-up yang jelas sebelum memilih rawatan."
        need_question = False

        if disease_normalized in {"healthy", "normal"}:
            plan_text = "Belum perlu guna racun. Teruskan pemantauan dan catat gejala baru."
        elif disease_normalized in {"unknown", "unknown disease", "inconclusive", "error", ""}:
            disease_label = "Tidak Konklusif"
            need_question = True
            plan_text = (
                "Keputusan belum jelas. Ambil semula gambar close-up kawasan simptom dalam pencahayaan baik sebelum pilih rawatan."
            )
        elif recommendation_source == "pesticidecatalog" and recommended_pesticides:
            plan_text = (
                "Rujukan katalog racun: "
                + ", ".join(recommended_pesticides)
                + ". Ikut kadar label dan tempoh pra-tuai sebelum aplikasi."
            )

        finding_lines = [f"- {disease_label} dikesan pada {crop_type}."]
        if severity_percent:
            finding_lines.append(f"- Tahap semasa: {severity_label} ({severity_percent}).")
        else:
            finding_lines.append(f"- Tahap semasa: {severity_label}.")
        if confidence_percent:
            finding_lines.append(f"- Keyakinan anggaran: {confidence_percent}.")

        actions_lines = [
            "- Asingkan daun atau pokok yang jelas bergejala untuk kurangkan jangkitan silang.",
            "- Semak kawasan sekeliling untuk gejala baharu sebelum rawatan susulan.",
            "- Rekod perubahan gejala supaya keputusan rawatan berikutnya lebih tepat.",
        ]

        treatment_lines = [f"- {plan_text}"]
        if recommended_pesticides and recommendation_source == "pesticidecatalog":
            treatment_lines.append(
                "- Pilihan produk: " + ", ".join(recommended_pesticides) + "."
            )

        recheck_lines = [
            "- Ambil semula gambar kawasan sama dalam 24 hingga 48 jam untuk semakan kemajuan.",
        ]
        if survival_percent:
            recheck_lines.append(f"- Kebarangkalian pulih semasa: {survival_percent}.")
        if reason_text:
            recheck_lines.append("- Nota sistem: semak semula kerana mod diagnosis terhad.")

        question_block = ""
        if need_question:
            question_block = (
                f"\n\n{question_heading}\n"
                "- Boleh kongsi gambar close-up bahagian simptom dengan pencahayaan lebih terang?"
            )

        return (
            f"{section_1}\n" + "\n".join(finding_lines) + "\n\n"
            + f"{section_2}\n" + "\n".join(actions_lines[:3]) + "\n\n"
            + f"{section_3}\n" + "\n".join(treatment_lines[:2]) + "\n\n"
            + f"{section_4}\n" + "\n".join(recheck_lines[:3])
            + f"{question_block}"
        )

    disease_label = disease if disease else "Inconclusive"
    plan_text = treatment_plan or "Retake a clear close-up photo before deciding treatment."
    need_question = False

    if disease_normalized in {"healthy", "normal"}:
        plan_text = "No immediate spray is needed. Keep monitoring and record new symptoms."
    elif disease_normalized in {"unknown", "unknown disease", "inconclusive", "error", ""}:
        disease_label = "Inconclusive"
        need_question = True
        plan_text = (
            "The result is not clear yet. Retake a close-up photo of the symptom area in good lighting before selecting treatment."
        )
    elif recommendation_source == "pesticidecatalog" and recommended_pesticides:
        plan_text = (
            "Catalog-based pesticides: "
            + ", ".join(recommended_pesticides)
            + ". Follow product label rate and pre-harvest interval before application."
        )

    finding_lines = [f"- {disease_label} was detected on {crop_type}."]
    if severity_percent:
        finding_lines.append(f"- Current severity: {severity_raw} ({severity_percent}).")
    else:
        finding_lines.append(f"- Current severity: {severity_raw}.")
    if confidence_percent:
        finding_lines.append(f"- Estimated confidence: {confidence_percent}.")

    actions_lines = [
        "- Isolate leaves or plants with visible symptoms to reduce spread.",
        "- Check nearby plants for early signs before conditions worsen.",
        "- Track symptom changes so the next treatment decision is clearer.",
    ]

    treatment_lines = [f"- {plan_text}"]
    if recommended_pesticides and recommendation_source == "pesticidecatalog":
        treatment_lines.append("- Product options: " + ", ".join(recommended_pesticides) + ".")

    recheck_lines = [
        "- Retake a photo of the same area in 24 to 48 hours to confirm progress.",
    ]
    if survival_percent:
        recheck_lines.append(f"- Current recovery outlook: {survival_percent}.")
    if reason_text:
        recheck_lines.append("- System note: diagnosis was generated in limited mode, so verify with another photo.")

    question_block = ""
    if need_question:
        question_block = (
            f"\n\n{question_heading}\n"
            "- Can you share a closer photo of the symptom area in brighter light?"
        )

    return (
        f"{section_1}\n" + "\n".join(finding_lines) + "\n\n"
        + f"{section_2}\n" + "\n".join(actions_lines[:3]) + "\n\n"
        + f"{section_3}\n" + "\n".join(treatment_lines[:2]) + "\n\n"
        + f"{section_4}\n" + "\n".join(recheck_lines[:3])
        + f"{question_block}"
    )


def _reply_looks_truncated(text: str) -> bool:
    cleaned = " ".join(str(text or "").strip().split())
    if not cleaned:
        return True

    # A complete sentence should end with terminal punctuation, optionally
    # followed by a closing quote/bracket.
    if not re.search(r"[.!?](?:[\"')\]]\s*)?$", cleaned):
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
ASSISTANT_DIALOGUE_MAX_RETRIES = 2
ASSISTANT_DIALOGUE_RETRY_DELAY_SECONDS = 0.2

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

    async def _generate_content_async(
        self,
        *,
        contents: Any,
        config: types.GenerateContentConfig,
    ):
        return await asyncio.to_thread(
            self._generate_content_with_model_fallback,
            contents=contents,
            config=config,
        )

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
                response = await self._generate_content_async(
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
                    if isinstance(result, list):
                        # Gemini sometimes wraps a single result in a list
                        result = result[0] if result and isinstance(result[0], dict) else fallback
                        logger.info("LLM returned list — extracted first element as result")
                    if not isinstance(result, dict):
                        logger.warning(
                            "LLM returned non-object JSON (%s) — using fallback",
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
        output_example = _build_structured_reply_example(required_sections)

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Diagnosis result JSON:\n{json.dumps(scan_result, ensure_ascii=True)}\n\n"
            f"Target response language: {target_language}\n"
            "Regardless of the user's input language, keep section headings in the canonical form from system instructions.\n"
            "Follow this output shape exactly (replace content only):\n"
            f"{output_example}\n\n"
            "Generate a direct reply addressed to the farmer."
        )

        for attempt in range(1, ASSISTANT_DIALOGUE_MAX_RETRIES + 1):
            try:
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_assistant_system_prompt(language),
                        temperature=0.35,
                        max_output_tokens=380,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Assistant dialogue missing required headings. Retrying generation.")
            except Exception as e:
                logger.warning(
                    "Assistant dialogue attempt %d/%d failed: %s",
                    attempt,
                    ASSISTANT_DIALOGUE_MAX_RETRIES,
                    e,
                )

            if attempt < ASSISTANT_DIALOGUE_MAX_RETRIES:
                await asyncio.sleep(ASSISTANT_DIALOGUE_RETRY_DELAY_SECONDS)

        return fallback

    async def generate_consolidated_assistant_dialogue(
        self,
        scan_results: list[dict[str, Any]],
        user_prompt: str,
    ) -> str:
        """Generate a consolidated assistant response for multiple diagnosed regions."""
        language = detect_farmer_language(user_prompt)
        target_language = "Malay (Bahasa Melayu)" if language == "ms" else "English"
        required_sections = _get_reply_headers(language)
        output_example = _build_structured_reply_example(required_sections)

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
            "Regardless of the user's input language, keep section headings in the canonical form from system instructions.\n"
            "Follow this output shape exactly (replace content only):\n"
            f"{output_example}\n\n"
            "Generate a consolidated reply addressing all detected crops with priority guidance."
        )

        for attempt in range(1, ASSISTANT_DIALOGUE_MAX_RETRIES + 1):
            try:
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_assistant_system_prompt(language),
                        temperature=0.35,
                        max_output_tokens=500,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Consolidated dialogue missing required headings. Retrying generation.")
            except Exception as e:
                logger.warning(
                    "Consolidated dialogue attempt %d/%d failed: %s",
                    attempt,
                    ASSISTANT_DIALOGUE_MAX_RETRIES,
                    e,
                )

            if attempt < ASSISTANT_DIALOGUE_MAX_RETRIES:
                await asyncio.sleep(ASSISTANT_DIALOGUE_RETRY_DELAY_SECONDS)

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
                response = await self._generate_content_async(
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
                response = await self._generate_content_async(
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
        required_sections = _get_low_confidence_reply_headers(language)
        output_example = _build_structured_reply_example(required_sections)
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
            "Regardless of the user's input language, keep section headings in the canonical form from system instructions.\n"
            "Follow this output shape exactly (replace content only):\n"
            f"{output_example}\n\n"
            "Give the farmer a short reply with a direct warning, a simple reason, and one next step.\n"
        )

        for attempt in range(1, ASSISTANT_DIALOGUE_MAX_RETRIES + 1):
            try:
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_low_confidence_system_prompt(language),
                        temperature=0.25,
                        max_output_tokens=240,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Low confidence reply missing required headings. Retrying generation.")
            except Exception as exc:
                logger.warning(
                    "Low confidence photo reply attempt %d/%d failed: %s",
                    attempt,
                    ASSISTANT_DIALOGUE_MAX_RETRIES,
                    exc,
                )

            if attempt < ASSISTANT_DIALOGUE_MAX_RETRIES:
                await asyncio.sleep(ASSISTANT_DIALOGUE_RETRY_DELAY_SECONDS)

        return fallback

    async def generate_supervisor_reply(
        self,
        *,
        user_prompt: str,
        context: dict[str, Any],
    ) -> str:
        """Generate a farmer-friendly response from structured task outputs."""
        language = detect_farmer_language(user_prompt)
        intents_raw = context.get("intents") if isinstance(context, dict) else None
        intents: set[str] = set()
        if isinstance(intents_raw, (list, tuple, set)):
            intents = {str(item or "").strip().lower() for item in intents_raw if str(item or "").strip()}
        elif isinstance(intents_raw, str) and intents_raw.strip():
            intents = {intents_raw.strip().lower()}

        requires_structured = bool(intents & {"diagnosis", "spread"})
        required_sections: tuple[str, ...] = _get_reply_headers(language) if requires_structured else ()
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
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_supervisor_system_prompt(language),
                        temperature=0.25,
                        max_output_tokens=420,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Supervisor reply missing required headings. Retrying generation.")
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
                response = await self._generate_content_async(
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
        required_sections = _get_reply_headers(language)
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
            "Use subheadings Finding, Actions, Treatment, Recheck.\n"
            "Under each subheading, use short bullet lines prefixed with '- '.\n"
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            "You are AcreZen's inventory assistant. "
                            "Use only the provided inventory summary. "
                            "Keep the answer short, practical, and farmer-friendly. "
                            "Do not mention diagnosis or weather. "
                            "Output plain text only with subheadings Finding, Actions, Treatment, Recheck and bullet-point lines. "
                            "Do not use markdown markers."
                        ),
                        temperature=0.25,
                        max_output_tokens=220,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Inventory reply missing required headings. Retrying generation.")
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
                response = await self._generate_content_async(
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

                parsed = extract_json_object(raw_text)

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
        intents_raw = context.get("intents") if isinstance(context, dict) else None
        intents: set[str] = set()
        if isinstance(intents_raw, (list, tuple, set)):
            intents = {str(item or "").strip().lower() for item in intents_raw if str(item or "").strip()}
        elif isinstance(intents_raw, str) and intents_raw.strip():
            intents = {intents_raw.strip().lower()}

        requires_structured = (
            bool(context.get("scan_result"))
            or bool(context.get("scan_results"))
            or bool(intents & {"diagnosis", "spread"})
        )
        required_sections: tuple[str, ...] = _get_reply_headers(language) if requires_structured else ()
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
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.2,
                        max_output_tokens=360,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Reply rewrite missing required headings. Retrying generation.")
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
        # Agriculture fallback is general chat. Do not force structured headings unless a scan/diagnosis
        # JSON payload is explicitly present in the prompt (not expected on this path).
        required_sections: tuple[str, ...] = ()
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
                response = await self._generate_content_async(
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.25,
                        max_output_tokens=360,
                    ),
                )
                text = _clean_reply_format(response.text, language)
                if text:
                    if _is_casual_prompt(user_prompt) or _has_required_headings(text, required_sections):
                        return text
                    logger.warning("Agriculture reply missing required headings. Retrying generation.")
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
        section_1, section_2, section_3, section_4 = _get_low_confidence_reply_headers(language)
        question_heading = _get_question_header(language)

        if language == "ms":
            crop_type = _trim_text((scan_result or {}).get("cropType"), default="Tanaman")
            disease = _trim_text((scan_result or {}).get("disease"), default="Tidak jelas")
            confidence_percent = _format_percent((scan_result or {}).get("confidence"), default="")

            finding_line = (
                f"- Beberapa kawasan pada {crop_type} menunjukkan kemungkinan {disease}."
                if scan_results and len(scan_results) > 1
                else f"- Terdapat kemungkinan {disease} pada {crop_type}."
            )
            finding_lines = [finding_line]
            if confidence_percent:
                finding_lines.append(f"- Keyakinan anggaran semasa: {confidence_percent}.")

            actions_lines = [
                "- Gambar belum cukup jelas untuk pengesahan muktamad.",
                "- Elakkan rawatan agresif sehingga gambar baharu disahkan.",
                "- Asingkan pokok bergejala sementara menunggu semakan semula.",
            ]

            treatment_lines = [
                "- Gunakan rawatan awal yang ringan dan selamat sehingga diagnosis lebih pasti.",
                "- Jika gejala merebak cepat, dapatkan nasihat agronomi setempat segera.",
            ]

            recheck_lines = [
                "- Ambil semula gambar close-up dalam cahaya baik dalam 24 jam.",
                "- Semak semula selepas muat naik gambar baharu sebelum ubah kadar rawatan.",
            ]

            return (
                f"{section_1}\n" + "\n".join(finding_lines) + "\n\n"
                f"{section_2}\n" + "\n".join(actions_lines[:3]) + "\n\n"
                f"{section_3}\n" + "\n".join(treatment_lines[:2]) + "\n\n"
                f"{section_4}\n" + "\n".join(recheck_lines[:2]) + "\n\n"
                f"{question_heading}\n"
                "- Boleh kongsi gambar yang lebih dekat dengan pencahayaan lebih terang?"
            )

        crop_type = _trim_text((scan_result or {}).get("cropType"), default="Crop")
        disease = _trim_text((scan_result or {}).get("disease"), default="Unclear")
        confidence_percent = _format_percent((scan_result or {}).get("confidence"), default="")

        finding_line = (
            f"- Several regions suggest possible {disease} on {crop_type}."
            if scan_results and len(scan_results) > 1
            else f"- A possible {disease} issue was detected on {crop_type}."
        )
        finding_lines = [finding_line]
        if confidence_percent:
            finding_lines.append(f"- Current estimated confidence: {confidence_percent}.")

        actions_lines = [
            "- The image is not clear enough for a final diagnosis.",
            "- Avoid aggressive treatment until the next clearer scan.",
            "- Isolate visibly affected plants while waiting for confirmation.",
        ]

        treatment_lines = [
            "- Use only cautious first-line treatment until confirmation.",
            "- If symptoms spread rapidly, get local agronomy support immediately.",
        ]

        recheck_lines = [
            "- Retake a close photo in brighter light within 24 hours.",
            "- Recheck after the new photo before changing treatment intensity.",
        ]

        return (
            f"{section_1}\n" + "\n".join(finding_lines) + "\n\n"
            f"{section_2}\n" + "\n".join(actions_lines[:3]) + "\n\n"
            f"{section_3}\n" + "\n".join(treatment_lines[:2]) + "\n\n"
            f"{section_4}\n" + "\n".join(recheck_lines[:2]) + "\n\n"
            f"{question_heading}\n"
            "- Can you share a closer photo with brighter lighting for confirmation?"
        )

    def _build_supervisor_fallback(self, *, language: str, user_prompt: str, context: dict[str, Any]) -> str:
        section_1, section_2, section_3, section_4 = _get_reply_headers(language)
        question_heading = _get_question_header(language)
        recent_scan = context.get("recent_scan") or {}
        inventory_summary = context.get("inventory_summary") or {}
        weather_snapshot = context.get("weather_snapshot") or {}
        dashboard_summary = context.get("dashboard_summary")
        location = str(context.get("location") or "").strip()
        latest = recent_scan.get("latest_report") or {}

        location_prompt = bool(
            re.search(r"\b(location|my location|saved location|farm location|bound location|where am i|where is my farm)\b", user_prompt.lower())
        )

        def compose(
            finding_lines: list[str],
            action_lines: list[str],
            treatment_lines: list[str],
            recheck_lines: list[str],
            question_line: str | None = None,
        ) -> str:
            reply = (
                f"{section_1}\n" + "\n".join(f"- {line}" for line in finding_lines[:3]) + "\n\n"
                f"{section_2}\n" + "\n".join(f"- {line}" for line in action_lines[:3]) + "\n\n"
                f"{section_3}\n" + "\n".join(f"- {line}" for line in treatment_lines[:2]) + "\n\n"
                f"{section_4}\n" + "\n".join(f"- {line}" for line in recheck_lines[:3])
            )

            if question_line:
                reply += f"\n\n{question_heading}\n- {question_line}"

            return reply

        if location_prompt:
            if language == "ms":
                if location:
                    return compose(
                        [f"Lokasi ladang yang disimpan ialah {location}."],
                        ["Gunakan lokasi ini untuk ramalan cuaca dan jadual semburan seterusnya."],
                        ["Tiada rawatan khusus diperlukan untuk semakan lokasi."],
                        ["Semak semula lokasi selepas kemas kini profil atau perpindahan ladang."],
                    )

                return compose(
                    ["Lokasi ladang belum disimpan."],
                    ["Kemas kini lokasi di Settings untuk analisis cuaca yang tepat."],
                    ["Tiada rawatan boleh disesuaikan tanpa lokasi ladang."],
                    ["Semak semula selepas lokasi disimpan."],
                    "Boleh kongsi lokasi ladang anda sekarang?",
                )

            if location:
                return compose(
                    [f"Your saved farm location is {location}."],
                    ["Use this location for weather timing and next spray planning."],
                    ["No crop treatment is needed for a location check."],
                    ["Review location again after profile updates or farm relocation."],
                )

            return compose(
                ["Your farm location is not saved yet."],
                ["Update your farm location in Settings for accurate weather guidance."],
                ["Treatment guidance cannot be localized until location is saved."],
                ["Recheck once your location is saved."],
                "Can you share your farm location now?",
            )

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
                return compose(
                    [f"{prefix}cuaca semasa {condition}, suhu {temperature_c:.0f}C, angin {wind_kmh:.0f} km/j, {rain_text}."],
                    [f"Status semasa: {spray_text}.", "Rancang semburan ikut tetingkap cuaca paling stabil."],
                    [recommendation or "Gunakan rawatan pencegahan berdasarkan risiko cuaca semasa."],
                    ["Semak semula ramalan sebelum semburan seterusnya."],
                )

            prefix = f"For {location}, " if location else ""
            return compose(
                [f"{prefix}weather is {condition}, temperature is {temperature_c:.0f}C, wind is {wind_kmh:.0f} km/h, and {rain_text}."],
                [f"Current spray status: {spray_text}.", "Plan application only during the most stable weather window."],
                [recommendation or "Use weather-aware preventive treatment based on current field risk."],
                ["Recheck forecast before the next spray round."],
            )

        if inventory_summary:
            return self._build_inventory_fallback(language=language, inventory_summary=inventory_summary)

        if dashboard_summary:
            weather = dashboard_summary.get("weatherSnapshot") or {}
            financial = dashboard_summary.get("financialSummary") or {}
            zone_health = dashboard_summary.get("zoneHealthSummary") or {}

            if language == "ms":
                pieces: list[str] = [
                    f"Cuaca {_trim_text(weather.get('condition'), default='tidak jelas')} dengan angin {_trim_text(weather.get('windKmh'), default='0')} km/j.",
                    f"ROI semasa {_trim_text(financial.get('roiPercent'), default='0')}% dan kos rawatan RM {_trim_text(financial.get('treatmentCostRm'), default='0')}.",
                ]
                low_stock_item = financial.get("lowStockItem")
                if low_stock_item:
                    pieces.append(
                        f"Stok rendah: {_trim_text(low_stock_item, default='tidak diketahui')} tinggal {_trim_text(financial.get('lowStockLiters'), default='0')} liter."
                    )
                if zone_health:
                    pieces.append(
                        f"Zon perlukan perhatian: {_trim_text(zone_health.get('zonesNeedingAttention'), default='0')}."
                    )
                return compose(
                    [pieces[0]],
                    [pieces[1]],
                    [pieces[2] if len(pieces) > 2 else "Keutamaan rawatan ikut zon paling berisiko."],
                    [pieces[3] if len(pieces) > 3 else "Semak semula ringkasan dashboard selepas kemas kini data baharu."],
                )

            pieces = [
                f"Weather is {_trim_text(weather.get('condition'), default='unclear')} with wind {_trim_text(weather.get('windKmh'), default='0')} km/h.",
                f"ROI is {_trim_text(financial.get('roiPercent'), default='0')}% and treatment cost is RM {_trim_text(financial.get('treatmentCostRm'), default='0')}.",
            ]
            low_stock_item = financial.get("lowStockItem")
            if low_stock_item:
                pieces.append(
                    f"Low stock: {_trim_text(low_stock_item, default='unknown')} has {_trim_text(financial.get('lowStockLiters'), default='0')} liters left."
                )
            if zone_health:
                pieces.append(
                    f"Zones needing attention: {_trim_text(zone_health.get('zonesNeedingAttention'), default='0')}."
                )
            return compose(
                [pieces[0]],
                [pieces[1]],
                [pieces[2] if len(pieces) > 2 else "Prioritize treatment budget for the highest-risk zones first."],
                [pieces[3] if len(pieces) > 3 else "Recheck dashboard metrics after the next data refresh."],
            )

        if latest:
            disease = _trim_text(latest.get("disease"), default="Unknown")
            severity = _trim_text(latest.get("severity"), default="Unknown")
            trend = _trim_text(recent_scan.get("trend"), default="Trend data is limited.")
            confidence_text = _format_percent(latest.get("confidence"), default="")

            if language == "ms":
                finding_lines = [f"Ujian terakhir menunjukkan {disease} pada tahap {severity}."]
                if confidence_text:
                    finding_lines.append(f"Keyakinan imbasan terakhir: {confidence_text}.")
                return compose(
                    finding_lines,
                    ["Fokus pemeriksaan pada kawasan yang gejalanya sedang meningkat."],
                    ["Teruskan pelan rawatan semasa dan laras ikut perkembangan gejala."],
                    [trend],
                )

            finding_lines = [f"Latest scan shows {disease} at {severity} severity."]
            if confidence_text:
                finding_lines.append(f"Latest scan confidence: {confidence_text}.")
            return compose(
                finding_lines,
                ["Prioritize field checks where symptoms are increasing."],
                ["Continue current treatment and adjust based on symptom progression."],
                [trend],
            )

        if language == "ms":
            return compose(
                ["Tiada data mencukupi untuk jawapan khusus sekarang."],
                ["Muat naik gambar yang lebih jelas atau nyatakan tanaman dan zon."],
                ["Rawatan boleh dipadankan selepas data tanaman atau gambar diterima."],
                ["Semak semula selepas maklumat tambahan dikongsi."],
                "Boleh kongsi tanaman atau zon yang anda mahu saya fokuskan?",
            )

        return compose(
            ["There is not enough data for a specific recommendation yet."],
            ["Upload a clearer photo or share the crop and zone you want checked."],
            ["Treatment can be tailored once crop details or scan data are available."],
            ["Recheck after sharing additional details."],
            "Can you share which crop or zone you want me to focus on?",
        )

    def _build_inventory_fallback(self, *, language: str, inventory_summary: dict[str, Any]) -> str:
        section_1, section_2, section_3, section_4 = _get_reply_headers(language)
        items = inventory_summary.get("items") or []
        total_items = int(inventory_summary.get("total_items") or len(items))
        low_stock_count = int(inventory_summary.get("low_stock_count") or 0)

        if not items:
            if language == "ms":
                return (
                    f"{section_1}\n- Tiada rekod inventori ditemui untuk akaun anda.\n\n"
                    f"{section_2}\n- Sahkan sambungan akaun dan kemas kini stok terkini.\n\n"
                    f"{section_3}\n- Tiada pelan rawatan inventori boleh dijana tanpa data stok.\n\n"
                    f"{section_4}\n- Semak semula selepas rekod inventori disegerakkan."
                )
            return (
                f"{section_1}\n- No inventory records were found for your account.\n\n"
                f"{section_2}\n- Verify account sync and update your latest stock data.\n\n"
                f"{section_3}\n- No inventory treatment plan can be generated without stock data.\n\n"
                f"{section_4}\n- Recheck after inventory records are synchronized."
            )

        top_items: list[str] = []
        for item in items[:3]:
            name = _trim_text(item.get("name"), default="Unknown item")
            liters = _safe_float(item.get("liters"), default=0.0)
            unit = _trim_text(item.get("unit"), default="liters")
            top_items.append(f"{name}: {liters:.1f} {unit}")

        if language == "ms":
            finding = f"Anda mempunyai {total_items} item inventori."
            if low_stock_count:
                finding += f" {low_stock_count} item berada pada stok rendah."
            return (
                f"{section_1}\n- {finding}\n\n"
                f"{section_2}\n- Semak item stok rendah dahulu dan jadualkan pembelian semula.\n"
                f"- Ringkasan item utama: {', '.join(top_items)}.\n\n"
                f"{section_3}\n- Prioritikan penggunaan stok sedia ada ikut keperluan rawatan semasa.\n\n"
                f"{section_4}\n- Semak semula inventori selepas kemas kini penggunaan atau pembelian baharu."
            )

        finding = f"You have {total_items} inventory item(s)."
        if low_stock_count:
            finding += f" {low_stock_count} item are low on stock."
        return (
            f"{section_1}\n- {finding}\n\n"
            f"{section_2}\n- Review low-stock items first and schedule replenishment.\n"
            f"- Key items snapshot: {', '.join(top_items)}.\n\n"
            f"{section_3}\n- Prioritize current stock usage based on active treatment needs.\n\n"
            f"{section_4}\n- Recheck inventory after usage updates or new purchases."
        )
