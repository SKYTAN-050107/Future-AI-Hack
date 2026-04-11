"""
Reasoning Agent — Google ADK BaseAgent.

Produces the final disease label, confidence, severity, and reasoning.

Two execution paths:
1. **Fast path** — ``fast_match`` set by VectorMatchAgent (score ≥ 0.85).
   Label is taken directly from the Vertex AI Vector Search metadata.
   No Gemini call → lowest latency (~100 ms total).
2. **LLM path** — Gemini 2 Flash (via Vertex AI) reasons over all
   candidates to select the best match and assign severity (~300 ms).

State keys read:
    candidates  (list[RetrievalCandidate])
    fast_match  (dict | None)
    bbox        (dict)
    grid_id     (str | None)

State keys written:
    scan_result (dict) — matches ScanResult schema
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from services.llm_service import LLMService

logger = logging.getLogger(__name__)

# ── Severity mapping ─────────────────────────────────────────────────

_SEVERITY_MAP = [
    (0.90, "critical"),
    (0.75, "high"),
    (0.55, "medium"),
    (0.0,  "low"),
]


def _to_severity(confidence: float) -> str:
    for threshold, level in _SEVERITY_MAP:
        if confidence >= threshold:
            return level
    return "unknown"


class ReasoningAgent(BaseAgent):
    """Google ADK agent: fast-path vector label or Gemini Flash reasoning."""

    _llm_svc: LLMService = PrivateAttr(default_factory=LLMService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        fast_match = state.get("fast_match")
        candidates = state.get("candidates", [])
        bbox = state.get("bbox", {})
        grid_id = state.get("grid_id")

        # ── Path 1: Fast match — vector result only, no Gemini ───────
        if fast_match:
            label = self._label_from_metadata(fast_match.get("metadata", {}))
            confidence = float(fast_match["score"])
            reason = "High-confidence Vertex AI Vector Search match."
            alternatives = []

        # ── Path 2: LLM — Gemini 2 Flash via Vertex AI ───────────────
        elif candidates:
            candidate_dicts = [c.model_dump() for c in candidates]
            validation = await self._llm_svc.validate_candidates(
                user_input={"text": None},
                candidates=candidate_dicts,
            )
            label = validation.get("result", "Unknown")
            confidence = float(validation.get("confidence", 0.0))
            reason = validation.get("reason", "")
            alternatives = validation.get("alternatives", [])

        # ── Path 3: Nothing matched ──────────────────────────────────
        else:
            label = "Healthy"
            confidence = 0.5
            reason = "No matching diseases found in Vertex AI Vector Search index."
            alternatives = []

        severity = _to_severity(confidence)
        is_abnormal = label.lower() != "healthy" and confidence >= 0.55

        state["scan_result"] = {
            "label": label,
            "confidence": confidence,
            "reason": reason,
            "severity": severity,
            "is_abnormal": is_abnormal,
            "bbox": bbox,
            "grid_id": grid_id,
            "alternatives": alternatives,
        }

        logger.info(
            "[%s] %s | conf=%.2f | sev=%s | abnormal=%s",
            self.name, label, confidence, severity, is_abnormal,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )

    @staticmethod
    def _label_from_metadata(metadata: dict) -> str:
        """Extract human-readable label from vector datapoint metadata."""
        for key in ("label", "disease", "name", "category", "class"):
            if key in metadata:
                return str(metadata[key])
        return "Unknown"
