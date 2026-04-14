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
from typing import Any

from google import genai
from google.genai import types

from config import get_settings

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

ASSISTANT_SYSTEM_PROMPT = """\
You are PadiGuard AI Assistant, a practical farming copilot.

You will receive a structured diagnosis result from the internal diagnosis agents.
Your job is to turn that diagnosis into a farmer-friendly response.

Rules:
- You MUST answer in Simplified Chinese.
- You MUST include these section headers exactly:
    1) 这是什么
    2) 治疗方案
    3) 立即行动
    4) 复查时间
- Be concise, clear, and actionable.
- Mention what was detected and confidence context in plain language.
- Do not hallucinate unavailable lab data.
- If disease is Apple Scab, clearly mention Apple Scab management priorities.
"""


# ── Retry Configuration ───────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1.0


class LLMService:
    """Validates retrieval candidates using Gemini 2 Flash."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(
            vertexai=True,
            project=settings.GCP_PROJECT_ID,
            location=settings.GCP_REGION,
        )
        self._model_name = settings.GEMINI_MODEL_NAME

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
                response = self._client.models.generate_content(
                    model=self._model_name,
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
                    result = json.loads(raw_text)
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
        disease = str(scan_result.get("disease", "Unknown"))
        crop_type = str(scan_result.get("cropType", "Unknown"))
        severity = str(scan_result.get("severity", "Moderate"))
        severity_score = float(scan_result.get("severityScore", 0.0) or 0.0)
        treatment_plan = str(scan_result.get("treatmentPlan", "Consult agrologist"))
        survival_prob = float(scan_result.get("survivalProb", 0.0) or 0.0)
        is_abnormal = bool(scan_result.get("is_abnormal", False))
        disease_normalized = disease.strip().lower()

        def build_fallback_dialogue() -> str:
            disease_label = disease if disease.strip() else "Inconclusive"
            plan_text = treatment_plan.strip() or "请先重拍清晰近照，再根据复扫结果决定用药。"

            if disease_normalized in ["healthy", "normal"]:
                plan_text = "当前不建议立即用药，先持续监测并记录新症状。"
            elif disease_normalized in ["unknown", "unknown disease", "inconclusive", "error", ""]:
                disease_label = "Inconclusive"
                plan_text = "结果暂时不明确，请在光线充足下拍摄叶片病斑近照后复扫，再决定具体药剂。"

            return (
                f"这是什么\n{disease_label}（作物类型：{crop_type}，严重度：{severity}，评分：{severity_score:.2f}）\n\n"
                f"治疗方案\n{plan_text}\n\n"
                "立即行动\n"
                "1. 先隔离明显异常叶片，避免交叉传播。\n"
                "2. 记录拍摄区域与时间，便于后续对比病情变化。\n"
                f"3. 关注存活概率参考值：{survival_prob:.2f}，结合田间观察调整策略。\n\n"
                "复查时间\n24-48小时后复拍同一区域；若病斑扩大，立即升级处理。"
            )

        fallback = build_fallback_dialogue()

        prompt = (
            f"User message:\n{user_prompt}\n\n"
            f"Diagnosis result JSON:\n{json.dumps(scan_result, ensure_ascii=True)}\n\n"
            "Generate a direct reply addressed to the farmer."
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._client.models.generate_content(
                    model=self._model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=ASSISTANT_SYSTEM_PROMPT,
                        temperature=0.35,
                        max_output_tokens=380,
                    ),
                )
                text = (response.text or "").strip()
                if text:
                    required_sections = ["这是什么", "治疗方案", "立即行动", "复查时间"]
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
