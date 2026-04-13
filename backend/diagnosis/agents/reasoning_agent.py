"""
Reasoning Agent — Google ADK BaseAgent.

Produces the final disease label, confidence, severity, and reasoning.

Two speed paths:
1. **Fast Path (Vector-Direct):** If VectorMatchAgent sets ``fast_match``
   (score ≥ 0.85), the label is assigned immediately from vector metadata
   without calling the LLM. (~100ms)
2. **LLM Path (Reasoned):** If lower confidence, Gemini 2.0 Flash analyzes
   the candidates to provide a final diagnosis and reasoning. (~300ms)

State keys read:
    candidates  (list[RetrievalCandidate])
    fast_match  (dict | None) — set by VectorMatchAgent when top score ≥ threshold
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
        candidates = state.get("candidates", [])
        fast_match = state.get("fast_match")
        bbox = state.get("bbox", {})
        grid_id = state.get("grid_id")

        # ── Fast Path: skip LLM entirely ─────────────────────────
        if fast_match:
            metadata = fast_match.get("metadata", {})
            cropType = str(metadata.get("cropType", "Unknown"))
            disease = str(metadata.get("disease", "Healthy"))
            score = float(fast_match.get("score", 0.0))

            # Infer severity from the disease label
            is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]
            severity = "High" if is_abnormal else "Low"
            severityScore = score if is_abnormal else 0.0
            survivalProb = max(0.0, 1.0 - score * 0.5) if is_abnormal else 1.0
            treatmentPlan = "Consult Agrologist" if is_abnormal else "None"

            logger.info(
                "[%s] ⚡ FAST PATH: %s | %s | score=%.3f — LLM skipped",
                self.name, cropType, disease, score,
            )

        # ── LLM Path: use Gemini for reasoning ────────────────────
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
            is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]

        # ── Nothing matched ──────────────────────────────────────────
        else:
            cropType = "Unknown"
            disease = "Healthy"
            severity = "Low"
            severityScore = 0.0
            treatmentPlan = "None"
            survivalProb = 1.0
            is_abnormal = False

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
