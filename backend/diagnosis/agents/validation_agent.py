"""
Validation Agent — Uses Gemini 2 Flash to validate retrieved candidates.

RESPONSIBILITIES:
- Compare semantic relevance between user input and candidates
- Filter out irrelevant candidates
- Select the best match
- Provide reasoning and confidence score

MUST:
- Output structured JSON

MUST NOT:
- Perform retrieval (candidates are already provided)
- Process raw images (receives text + metadata only)

State keys read  (from ctx.session.state):
- ``text``:        original user text (may be None for image-only)
- ``candidates``:  list[RetrievalCandidate] from Retrieval Agent

State keys written (to ctx.session.state):
- ``validation_result``:  dict with best_match_id, result,
                          confidence, reason, alternatives
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from models.candidate import RetrievalCandidate
from services.llm_service import LLMService

logger = logging.getLogger(__name__)


class ValidationAgent(BaseAgent):
    """Validates retrieval candidates using LLM reasoning."""

    _llm_service: LLMService = PrivateAttr(default_factory=LLMService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        candidates: list[RetrievalCandidate] = state.get("candidates", [])
        user_text: str | None = state.get("text")

        if not candidates:
            logger.warning("[%s] No candidates to validate", self.name)
            state["validation_result"] = {
                "best_match_id": None,
                "result": "No candidates retrieved",
                "confidence": 0.0,
                "reason": "Vector search returned zero results.",
                "alternatives": [],
            }
        else:
            # Build the LLM input — text description only, NO raw image
            user_input = {"text": user_text}

            # Serialize candidates as plain dicts for the LLM
            candidate_dicts = [c.model_dump() for c in candidates]

            validation_result = await self._llm_service.validate_candidates(
                user_input=user_input,
                candidates=candidate_dicts,
            )

            state["validation_result"] = validation_result
            logger.info(
                "[%s] Validation complete — best_match=%s, confidence=%.2f",
                self.name,
                validation_result.get("best_match_id"),
                validation_result.get("confidence", 0.0),
            )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
