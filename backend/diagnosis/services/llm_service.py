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


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _trim_text(value: Any, default: str = "Unknown") -> str:
    text = str(value or "").strip()
    return text or default


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


SUPERVISOR_SYSTEM_PROMPT_BASE = """\
You are PadiGuard AI Response Agent.

You receive structured task outputs from specialist agents.
Use only the structured context.
Answer the farmer with short, direct, practical sentences.
If the data is missing, ask one clear follow-up question and stop.
Do not mention internal agent names or JSON.
If spraying is unsafe, say that first.
If treatment is not worth it, say that first.
If spread risk is high, say to isolate or monitor nearby plants.
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
        context_text = json.dumps(context, indent=2, ensure_ascii=True, default=str)
        fallback = self._build_supervisor_fallback(
            language=language,
            user_prompt=user_prompt,
            context=context,
        )

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Structured task outputs:\n{context_text}\n\n"
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
                        max_output_tokens=280,
                    ),
                )
                text = " ".join((response.text or "").strip().split())
                if text:
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
        dashboard_summary = context.get("dashboard_summary")
        latest = recent_scan.get("latest_report") or {}

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
