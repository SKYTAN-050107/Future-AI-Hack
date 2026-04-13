"""
Vector-Match Agent — Google ADK BaseAgent.

Queries Vertex AI Vector Search for top-K nearest neighbours.
Applies a confidence threshold to filter weak matches.
If the top result exceeds the fast-match threshold (default 0.85),
sets a ``fast_match`` flag so the Reasoning Agent can skip the
Gemini LLM call entirely.

State keys read:
    embedding   (list[float]) — from CropEmbedAgent

State keys written:
    candidates  (list[RetrievalCandidate])
    fast_match  (dict | None) — set when top score ≥ fast-match threshold
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from config import get_settings
from models.candidate import RetrievalCandidate
from services.vector_search_service import VectorSearchService

logger = logging.getLogger(__name__)


class VectorMatchAgent(BaseAgent):
    """Google ADK agent: Vertex AI Vector Search with confidence gating."""

    _search_svc: VectorSearchService = PrivateAttr(default_factory=VectorSearchService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        settings = get_settings()

        embedding: list[float] = state["embedding"]

        # ── Vertex AI Vector Search ──────────────────────────────────
        candidates: list[RetrievalCandidate] = await self._search_svc.search(
            embedding, settings.DEFAULT_TOP_K,
        )

        # ── Confidence threshold filter ──────────────────────────────
        threshold = settings.VECTOR_SEARCH_CONFIDENCE_THRESHOLD
        candidates = [c for c in candidates if c.score >= threshold]
        state["candidates"] = candidates

        # ── Fast-match gate ──────────────────────────────────────────
        # If the top result exceeds the fast-match threshold (default 0.85),
        # write a fast_match dict so ReasoningAgent can skip the LLM call.
        fast_threshold = settings.VECTOR_SEARCH_FAST_MATCH_THRESHOLD
        if candidates and candidates[0].score >= fast_threshold:
            top = candidates[0]
            state["fast_match"] = {
                "id": top.id,
                "score": top.score,
                "metadata": top.metadata,
            }
            logger.info(
                "[%s] ⚡ FAST MATCH: score=%.3f ≥ %.2f — LLM will be skipped",
                self.name, top.score, fast_threshold,
            )
        else:
            state["fast_match"] = None

        logger.info(
            "[%s] %d candidate(s) after threshold=%.2f",
            self.name, len(candidates), threshold,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
