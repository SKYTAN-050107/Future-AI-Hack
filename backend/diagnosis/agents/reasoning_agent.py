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
            metadata = fast_match.get("metadata", {})
            disease = self._label_from_metadata(metadata)
            cropType = str(metadata.get("cropType", "Unknown"))
            severityScore = float(fast_match.get("score", 0.0))
            severity = "High" if severityScore > 0.8 else "Moderate"
            treatmentPlan = str(metadata.get("treatmentPlan", "Consult Agrologist"))
            survivalProb = float(metadata.get("survivalProb", 0.5))

        # ── Path 2: LLM — Gemini 2 Flash via Vertex AI ───────────────
        elif candidates:
            candidate_dicts = [c.model_dump() for c in candidates]
            validation = await self._llm_svc.validate_candidates(
                user_input={"text": None},
                candidates=candidate_dicts,
            )
            cropType = str(validation.get("cropType", "Unknown"))
            disease = str(validation.get("disease", "Unknown"))
            severity = str(validation.get("severity", "Moderate"))
            severityScore = float(validation.get("severityScore", 0.5))
            treatmentPlan = str(validation.get("treatmentPlan", "Consult Agrologist"))
            survivalProb = float(validation.get("survivalProb", 0.5))

        # ── Path 3: Nothing matched ──────────────────────────────────
        else:
            cropType = "Unknown"
            disease = "Healthy"
            severity = "Low"
            severityScore = 0.0
            treatmentPlan = "None"
            survivalProb = 1.0

        is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]

        state["scan_result"] = {
            "cropType": cropType,
            "disease": disease,
            "severity": severity,
            "severityScore": severityScore,
            "treatmentPlan": treatmentPlan,
            "survivalProb": survivalProb,
            "is_abnormal": is_abnormal,
            "bbox": bbox,
            "grid_id": grid_id,
        }

        logger.info(
            "[%s] %s | %s | score=%.2f | abnormal=%s",
            self.name, cropType, disease, severityScore, is_abnormal,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )

    @staticmethod
    def _label_from_metadata(metadata: dict) -> str:
        """Extract human-readable label from vector datapoint metadata."""
        for key in ("disease", "label", "name", "category", "class"):
            if key in metadata:
                return str(metadata[key])
        return "Unknown"
