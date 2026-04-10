"""
Diagnosis Pipeline — ADK SequentialAgent orchestrator.

Chains all five agents in strict order via Google ADK:
    PlannerAgent → EmbeddingAgent → RetrievalAgent → ValidationAgent → AggregatorAgent

The pipeline enforces that:
- Retrieval ALWAYS runs before Validation (never skipped).
- State is shared via ADK's ``InvocationContext.session.state``
  (a mutable dict passed through every agent automatically).
- Agents are independent and communicate only through session state keys.

Architecture:
    DiagnosisPipeline           (this class — thin FastAPI-facing wrapper)
      └── SequentialAgent       (ADK orchestrator)
            ├── PlannerAgent
            ├── EmbeddingAgent
            ├── RetrievalAgent
            ├── ValidationAgent
            └── AggregatorAgent

Run lifecycle per request:
    1. A temporary ADK Session is created with the request payload as
       initial state (image_bytes, image_filename, text).
    2. ADK Runner drives the SequentialAgent to completion.
    3. The final session state is read to extract the assembled response.
    4. Session is discarded — the pipeline is stateless across requests.
"""

from __future__ import annotations

import logging
import uuid

from google.adk.agents import SequentialAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from agents.planner_agent import PlannerAgent
from agents.embedding_agent import EmbeddingAgent
from agents.retrieval_agent import RetrievalAgent
from agents.validation_agent import ValidationAgent
from agents.aggregator_agent import AggregatorAgent
from models.request import AnalyzeRequest
from models.response import AnalyzeResponse

logger = logging.getLogger(__name__)

_APP_NAME = "padiguard_diagnosis"

# Dummy trigger message — our agents read from session state,
# not from the user message, so we just need a non-empty Content.
_TRIGGER = genai_types.Content(
    parts=[genai_types.Part(text="analyze")]
)


class DiagnosisPipeline:
    """Orchestrates the multi-agent diagnosis workflow via ADK SequentialAgent.

    Provides the same ``run()`` interface as before so ``api/router.py``
    requires zero changes.
    """

    def __init__(self) -> None:
        # ── Build the ADK SequentialAgent with all five sub-agents ──
        self._pipeline_agent = SequentialAgent(
            name="DiagnosisPipeline",
            description=(
                "Sequential multi-agent pipeline for plant disease diagnosis. "
                "Runs Planner → Embedding → Retrieval → Validation → Aggregator."
            ),
            sub_agents=[
                PlannerAgent(
                    name="PlannerAgent",
                    description="Inspects input and determines input_type + top_k.",
                ),
                EmbeddingAgent(
                    name="EmbeddingAgent",
                    description=(
                        "Uploads image to GCS (if present) and generates "
                        "a 1408-dim multimodal embedding vector."
                    ),
                ),
                RetrievalAgent(
                    name="RetrievalAgent",
                    description="Queries Vertex AI Vector Search for Top-K candidates.",
                ),
                ValidationAgent(
                    name="ValidationAgent",
                    description=(
                        "Uses Gemini 2 Flash to validate and rank retrieval "
                        "candidates against the user's input."
                    ),
                ),
                AggregatorAgent(
                    name="AggregatorAgent",
                    description="Assembles the final structured AnalyzeResponse.",
                ),
            ],
        )

        # ── ADK session and runner ───────────────────────────────────
        self._session_service = InMemorySessionService()
        self._runner = Runner(
            agent=self._pipeline_agent,
            app_name=_APP_NAME,
            session_service=self._session_service,
        )

    async def run(self, request: AnalyzeRequest) -> AnalyzeResponse:
        """Execute the full diagnosis pipeline.

        Args:
            request: Validated inbound request with image and/or text.

        Returns:
            Structured ``AnalyzeResponse`` with result, confidence,
            reason, and alternatives.
        """
        # ── Create a fresh session with the request payload as state ─
        session_id = uuid.uuid4().hex
        session = self._session_service.create_session(
            app_name=_APP_NAME,
            user_id="system",
            session_id=session_id,
            state={
                "image_bytes": request.image_bytes,
                "image_filename": request.image_filename,
                "text": request.text,
            },
        )

        # ── Drive the ADK SequentialAgent to completion ──────────────
        logger.info("▶ Starting ADK pipeline (session=%s)", session.id)
        async for event in self._runner.run_async(
            user_id="system",
            session_id=session.id,
            new_message=_TRIGGER,
        ):
            logger.debug("  ADK event: author=%s", event.author)

        logger.info("✓ ADK pipeline complete (session=%s)", session.id)

        # ── Extract the assembled response from final session state ──
        final_session = self._session_service.get_session(
            app_name=_APP_NAME,
            user_id="system",
            session_id=session.id,
        )
        response_data = final_session.state.get("response", {})
        return AnalyzeResponse(**response_data)
