"""
Result Collector Agent — Google ADK BaseAgent.

Final agent in the pipeline that collects all intermediate results
and ensures they are properly persisted.

This agent runs last and gathers all the work done by previous agents,
packaging it into a final ScanResult.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr, ConfigDict
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

logger = logging.getLogger(__name__)


class ResultCollectorAgent(BaseAgent):
    """Final agent: collects and packages scan results."""

    model_config = ConfigDict(extra='ignore')

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        """Collect final results from state."""
        state = ctx.session.state
        
        logger.info("[%s] ENTRY: Collecting results", self.name)
        logger.info("[%s] State keys available: %s", self.name, list(state.keys()))
        
        # If scan_result was already set by ReasoningAgent, keep it
        if "scan_result" in state:
            logger.info("[%s] scan_result already in state, keeping it", self.name)
        else:
            # Fallback collection logic
            logger.warning("[%s] scan_result not found, creating from available data", self.name)
            candidates = state.get("candidates", [])
            fast_match = state.get("fast_match")
            bbox = state.get("bbox", {})
            grid_id = state.get("grid_id")
            
            if fast_match:
                metadata = fast_match.get("metadata", {})
                crop_type = str(metadata.get("cropType", "Unknown"))
                disease = str(metadata.get("disease", "Healthy"))
                score = float(fast_match.get("score", 0.0))
                is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]
                severity = "High" if is_abnormal else "Low"
                severity_score = score if is_abnormal else 0.0
                treatment_plan = "Consult Agrologist" if is_abnormal else "None"
                survival_prob = max(0.0, 1.0 - score * 0.5) if is_abnormal else 1.0
            elif candidates:
                top = candidates[0]
                meta = top.metadata
                crop_type = str(meta.get("cropType", "Unknown"))
                disease = str(meta.get("disease", "Unknown"))
                severity = "Moderate"
                severity_score = top.score
                treatment_plan = "Review candidate recommendations"
                survival_prob = max(0.0, 1.0 - top.score * 0.3)
                is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]
            else:
                crop_type = "Unknown"
                disease = "Healthy"
                severity = "Low"
                severity_score = 0.0
                treatment_plan = "None"
                survival_prob = 1.0
                is_abnormal = False
            
            state["scan_result"] = {
                "cropType": crop_type,
                "disease": disease,
                "severity": severity,
                "severityScore": severity_score,
                "treatmentPlan": treatment_plan,
                "survivalProb": survival_prob,
                "is_abnormal": is_abnormal,
                "bbox": bbox,
                "grid_id": grid_id,
            }
            logger.info("[%s] Created scan_result from candidates", self.name)
        
        logger.info("[%s] EXIT: Results collected", self.name)
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
