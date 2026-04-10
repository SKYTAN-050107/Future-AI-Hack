"""
LLM service wrapping Gemini 2 Flash for candidate validation.

The LLM is used ONLY for validation and reasoning — never for
retrieval, embedding, or raw image processing.  It receives the
user's text description and candidate metadata, then selects the
best match with structured JSON output.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from google import genai
from google.genai import types

from config import get_settings

logger = logging.getLogger(__name__)

# ── Validation Prompt ─────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a plant disease diagnosis validator.

ROLE:
- You receive a user query (text description of a plant issue) and a set
  of candidate diagnoses retrieved via vector similarity search.
- Your job is to VALIDATE which candidate best matches the user's
  description by comparing semantic relevance.

RULES:
- Do NOT perform retrieval.  Candidates are already provided.
- Do NOT process or analyze any raw images.
- Do NOT hallucinate diagnoses outside the provided candidates.
- You MUST output valid JSON — no markdown, no extra text.

OUTPUT FORMAT (strictly):
{
  "best_match_id": "<candidate id>",
  "result": "<diagnosis name or description from the best candidate>",
  "confidence": <float 0.0 to 1.0>,
  "reason": "<brief reasoning for your selection>",
  "alternatives": ["<other plausible candidate results>"]
}

If NO candidate is relevant, set:
- "best_match_id": null
- "result": "No matching diagnosis found"
- "confidence": 0.0
- "reason": "None of the retrieved candidates match the described symptoms."
- "alternatives": []
"""


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
        """Ask Gemini to validate and rank retrieval candidates.

        Args:
            user_input: Dict with the user's original query context.
                        Expected key: ``"text"`` (str or None).
            candidates: List of candidate dicts, each containing at
                        minimum ``"id"``, ``"score"``, ``"metadata"``.

        Returns:
            Parsed JSON dict with keys: ``best_match_id``, ``result``,
            ``confidence``, ``reason``, ``alternatives``.
        """
        user_text = user_input.get("text") or "No text description provided."
        candidate_summary = json.dumps(candidates, indent=2, default=str)

        user_prompt = (
            f"## User Query\n{user_text}\n\n"
            f"## Retrieved Candidates ({len(candidates)} total)\n"
            f"{candidate_summary}\n\n"
            "Select the best matching candidate and provide your reasoning."
        )

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
        except json.JSONDecodeError:
            logger.error("LLM returned invalid JSON: %s", raw_text[:200])
            result = {
                "best_match_id": None,
                "result": "Validation failed — invalid LLM response",
                "confidence": 0.0,
                "reason": "The LLM did not return parseable JSON.",
                "alternatives": [],
            }

        return result
