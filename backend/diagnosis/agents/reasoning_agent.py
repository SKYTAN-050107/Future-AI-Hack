"""
Reasoning Agent — Google ADK BaseAgent.

Produces the final disease label, confidence, severity, and reasoning.

Diagnosis path:
1. Uses the top Vector Search candidate directly.
2. Uses candidate ID to fetch diagnosis fields from Firestore.
3. Builds final ``scan_result`` without LLM analysis.

State keys read:
    candidates  (list[RetrievalCandidate])
    bbox        (dict)
    grid_id     (str | None)

State keys written:
    scan_result (dict) — matches ScanResult schema
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import ConfigDict, PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from services.firestore_service import FirestoreService

logger = logging.getLogger(__name__)


# Import the context variable from pipeline
def _get_result_setter():
    """Lazy import to avoid circular dependency."""
    try:
        from orchestration.pipeline import _latest_scan_result
        return _latest_scan_result
    except (ImportError, AttributeError):
        return None




class ReasoningAgent(BaseAgent):
    """Google ADK agent: use Vector Search results for diagnosis."""

    model_config = ConfigDict(extra='ignore')
    _firestore_svc: FirestoreService = PrivateAttr(default_factory=FirestoreService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        
        try:
            candidates = state.get("candidates", [])
            bbox = state.get("bbox", {})
            grid_id = state.get("grid_id")

            # Use Vector Search result ID to fetch diagnosis fields from Firestore.
            if candidates:
                top_candidate = candidates[0]
                candidate_id = top_candidate.id
                score = top_candidate.score
                candidate_doc = await self._firestore_svc.get_candidate_metadata_by_id(candidate_id)
                
                logger.info(
                    "[%s] Top matching candidate: id=%s, similarity_score=%.4f",
                    self.name, candidate_id, score
                )
                
                # Extract diagnosis info from Firestore candidate document.
                cropType = candidate_doc.get("cropType", "Unknown")
                disease = candidate_doc.get("disease", "Unknown disease")
                gcs_uri = candidate_doc.get("gcs_uri", "")

                disease_normalized = str(disease).strip().lower()
                if disease_normalized in ["healthy", "normal"]:
                    severity = "Low"
                    treatmentPlan = "None"
                    survivalProb = 0.95
                    is_abnormal = False
                elif disease_normalized in ["unknown", "unknown disease", ""]:
                    severity = "Moderate"
                    treatmentPlan = (
                        "Inconclusive result. Please capture a closer, well-lit leaf photo and re-scan."
                    )
                    survivalProb = 0.5
                    is_abnormal = False
                else:
                    severity = "Moderate"
                    treatmentPlan = "Consult agrologist"
                    survivalProb = 0.6
                    is_abnormal = True

                if gcs_uri:
                    treatmentPlan = f"Reference image: {gcs_uri}"

                severityScore = score
                
                logger.info(
                    "[%s] Diagnosis from Firestore candidate document: %s - %s (similarity=%.4f)",
                    self.name, cropType, disease, score
                )
            else:
                # No candidates found from vector search
                logger.warning("[%s] No candidates found from vector search, returning inconclusive", self.name)
                cropType = "Unknown"
                disease = "Inconclusive"
                severity = "Moderate"
                severityScore = 0.0
                treatmentPlan = "Inconclusive result. Please capture a clearer close-up photo and re-scan."
                survivalProb = 0.5
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

            # Also save to global context so pipeline can retrieve it
            result_setter = _get_result_setter()
            if result_setter:
                result_setter.set(state["scan_result"])
                logger.info("[%s] Saved scan_result to context variable", self.name)

            logger.info(
                "[%s] SUCCESS: Result written to state (Vector Search-based): %s | %s",
                self.name, cropType, disease,
            )

            logger.info(
                "[%s] %s | %s | confidence=%.4f | abnormal=%s",
                self.name, cropType, disease, severityScore, is_abnormal,
            )
        except Exception as e:
            logger.error("[%s] Reasoning failed: %s", self.name, e, exc_info=True)
            cropType = "Error"
            disease = str(e)
            severity = "Low"
            severityScore = 0.0
            treatmentPlan = "Error in diagnosis pipeline"
            survivalProb = 0.0
            is_abnormal = False
            bbox = state.get("bbox", {})
            grid_id = state.get("grid_id")
            
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
            
            # Also save to global context
            result_setter = _get_result_setter()
            if result_setter:
                result_setter.set(state["scan_result"])
                logger.info("[%s] Saved error scan_result to context variable", self.name)

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
