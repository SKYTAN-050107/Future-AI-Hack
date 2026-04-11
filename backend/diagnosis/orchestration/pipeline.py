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
            └── ReasoningAgent      (Vertex AI Gemini 2 Flash)

Lifecycle:
    1. Temporary ADK Session created with region data as initial state.
    2. ADK Runner drives SequentialAgent to completion.
    3. ``scan_result`` read from final session state.
    4. Session discarded — stateless across requests.
"""

from __future__ import annotations

import logging
import uuid

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
                "Reasoning (Vertex AI Gemini Flash)."
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
                    description="Fast-path label or Vertex AI Gemini Flash reasoning.",
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
        session = self._session_svc.create_session(
            app_name=_APP_NAME,
            user_id="scanner",
            session_id=session_id,
            state={
                "cropped_image_b64": cropped_image_b64,
                "bbox": bbox,
                "grid_id": grid_id,
            },
        )

        logger.info("▶ ADK pipeline start (session=%s)", session.id)
        async for event in self._runner.run_async(
            user_id="scanner",
            session_id=session.id,
            new_message=_TRIGGER,
        ):
            logger.debug("  ADK event: %s", event.author)
        logger.info("✓ ADK pipeline done (session=%s)", session.id)

        final = self._session_svc.get_session(
            app_name=_APP_NAME,
            user_id="scanner",
            session_id=session.id,
        )
        return final.state.get("scan_result", {})
