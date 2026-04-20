"""
Live-Scan Pipeline — Google ADK SequentialAgent orchestrator.

Chains three ADK BaseAgent sub-agents in strict order:
    CropEmbedAgent → VectorMatchAgent → ReasoningAgent

The pipeline processes ONE cropped bounding-box region per invocation.
The API layer calls ``run()`` once per region, potentially in parallel
for multiple regions in a single frame.

Architecture:
    LiveScanPipeline                (this class)
      └── ADK SequentialAgent       (Google ADK orchestrator)
            ├── CropEmbedAgent      (Vertex AI Multimodal Embedding)
            ├── VectorMatchAgent    (Vertex AI Vector Search)
            └── ReasoningAgent      (Vector metadata to final diagnosis)

Lifecycle:
    1. Temporary ADK Session created with region data as initial state.
    2. ADK Runner drives SequentialAgent to completion.
    3. ``scan_result`` read from final session state.
    4. Session discarded — stateless across requests.
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

from google.adk.agents import SequentialAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from agents.crop_embed_agent import CropEmbedAgent
from agents.vector_match_agent import VectorMatchAgent
from agents.reasoning_agent import ReasoningAgent

logger = logging.getLogger(__name__)

_APP_NAME = "padiguard_livescan"

# Dummy trigger — agents read session state, not the user message.
_TRIGGER = genai_types.Content(parts=[genai_types.Part(text="scan")])

# Context variable to store results from agents (since session service doesn't persist them)
_latest_scan_result: ContextVar[dict] = ContextVar("_latest_scan_result", default=None)


class LiveScanPipeline:
    """Google ADK SequentialAgent pipeline for live plant scanning.

    Call ``run()`` once per cropped bounding-box region.
    All three sub-agents are ADK BaseAgent instances that share
    state via ``ctx.session.state``.
    """

    def __init__(self) -> None:
        self._pipeline = SequentialAgent(
            name="LiveScanPipeline",
            description=(
                "3-agent pipeline: CropEmbed (Vertex AI Embedding) → "
                "VectorMatch (Vertex AI Vector Search) → "
                "Reasoning (Vector metadata diagnosis)."
            ),
            sub_agents=[
                CropEmbedAgent(
                    name="CropEmbedAgent",
                    description="Vertex AI Multimodal Embedding from cropped image bytes.",
                ),
                VectorMatchAgent(
                    name="VectorMatchAgent",
                    description="Vertex AI Vector Search with confidence gating.",
                ),
                ReasoningAgent(
                    name="ReasoningAgent",
                    description="Generate final diagnosis from Vector Search candidate metadata.",
                ),
            ],
        )

        self._session_svc = InMemorySessionService()
        self._runner = Runner(
            agent=self._pipeline,
            app_name=_APP_NAME,
            session_service=self._session_svc,
        )

    async def run(
        self,
        cropped_image_b64: str,
        bbox: dict,
        grid_id: str | None = None,
    ) -> dict:
        """Execute the 3-agent scan pipeline for one cropped region.

        Args:
            cropped_image_b64: Base64-encoded cropped image.
            bbox: BoundingBox data as dict.
            grid_id: Optional farm grid section ID.

        Returns:
            Dict matching ``ScanResult`` schema.
        """
        session_id = uuid.uuid4().hex
        session = await self._session_svc.create_session(
            app_name=_APP_NAME,
            user_id="scanner",
            session_id=session_id,
            state={
                "cropped_image_b64": cropped_image_b64,
                "bbox": bbox,
                "grid_id": grid_id,
            },
        )

        logger.info("[PIPELINE] ADK pipeline start (session=%s)", session.id)
        logger.info("[PIPELINE] Initial state keys: %s", list(session.state.keys()))
        event_count = 0
        try:
            async for event in self._runner.run_async(
                user_id="scanner",
                session_id=session.id,
                new_message=_TRIGGER,
            ):
                 event_count += 1
                 logger.info(f"[PIPELINE] Event #{event_count}: Agent {event.author} finished a step.")
                 
                 # Fetch the latest session state after each agent completes
                 current_session = await self._session_svc.get_session(
                     app_name=_APP_NAME,
                     user_id="scanner",
                     session_id=session.id,
                 )
                 logger.info(f"[PIPELINE] State keys after {event.author}: {list(current_session.state.keys())}")
        except Exception as e:
            logger.error("[PIPELINE] ADK execution error: %s", e, exc_info=True)
            
        logger.info("[PIPELINE] ADK pipeline done (session=%s), total events: %d", session.id, event_count)
        logger.info("[PIPELINE] Final session state keys: %s", list(session.state.keys()))
        logger.debug("[PIPELINE] Full session state: %s", session.state)

        # Try to get result from context variable (set by ReasoningAgent)
        result = _latest_scan_result.get()
        
        if result:
            logger.info("[PIPELINE] Retrieved scan_result from context variable")
            return result
        
        # Fallback: try to re-fetch from session service
        final_session = await self._session_svc.get_session(
            app_name=_APP_NAME,
            user_id="scanner",
            session_id=session.id,
        )
        
        logger.info("[PIPELINE] Re-fetched session state keys: %s", list(final_session.state.keys()))
        logger.debug("[PIPELINE] Re-fetched session state: %s", final_session.state)
        
        result = final_session.state.get("scan_result", {})
        if not result:
            logger.warning("[PIPELINE] WARNING: scan_result is still empty in session state!")
            logger.warning("[PIPELINE] Embedding present: %s", "embedding" in final_session.state)
            logger.warning("[PIPELINE] Candidates present: %s", "candidates" in final_session.state)
            # Generate fallback result
            result = {
                "cropType": "Unknown",
                "disease": "Healthy",
                "severity": "Low",
                "severityScore": 0.0,
                "treatmentPlan": "None",
                "survivalProb": 1.0,
                "is_abnormal": False,
                "recommendedPesticides": [],
                "recommendationSource": "fallback",
                "matchedPestName": None,
                "bbox": final_session.state.get("bbox", {}),
                "grid_id": final_session.state.get("grid_id"),
            }
            logger.warning("[PIPELINE] Generated fallback result")
            
        return result
