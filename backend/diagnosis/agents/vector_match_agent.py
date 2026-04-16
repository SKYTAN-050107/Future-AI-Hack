"""
Vector-Match Agent — Google ADK BaseAgent.

Queries Vertex AI Vector Search for top-K nearest neighbours.
Applies a distance threshold to filter weak matches.
If the top result is within the fast-match threshold,
sets a ``fast_match`` flag for downstream fast handling.

State keys read:
    embedding   (list[float]) — from CropEmbedAgent

State keys written:
    candidates  (list[RetrievalCandidate])
    fast_match  (dict | None) — set when top score ≤ fast-match threshold
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr, ConfigDict
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from config import get_settings
from models.candidate import RetrievalCandidate
from services.vector_search_service import VectorSearchService

logger = logging.getLogger(__name__)


class VectorMatchAgent(BaseAgent):
    """Google ADK agent: Vertex AI Vector Search with confidence gating."""

    model_config = ConfigDict(extra='ignore')

    _search_svc: VectorSearchService = PrivateAttr(default_factory=VectorSearchService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        logger.info("[%s] ENTRY: _run_async_impl called", self.name)
        state = ctx.session.state
        settings = get_settings()
        logger.info("[%s] State keys: %s", self.name, list(state.keys()))

        try:
            embedding: list[float] = state.get("embedding", [])
            logger.info("[%s] Embedding from state: %s", self.name, "present" if embedding else "MISSING")
            
            if not embedding:
                logger.warning("[%s] No embedding found in state, skipping vector search", self.name)
                state["candidates"] = []
                state["fast_match"] = None
                yield Event(
                    author=self.name,
                    invocation_id=ctx.invocation_id,
                    branch=ctx.branch,
                )
                return

            # ── Vertex AI Vector Search ──────────────────────────────────
            logger.info("[%s] Starting vector search...", self.name)
            candidates: list[RetrievalCandidate] = await self._search_svc.search(
                embedding, settings.DEFAULT_TOP_K,
            )
            logger.info("[%s] Vector search returned %d candidates", self.name, len(candidates))
            
            # Log detailed candidate information
            for i, cand in enumerate(candidates):
                logger.info("[%s] Candidate #%d: id=%s, score=%.4f, metadata=%s", 
                           self.name, i, cand.id, cand.score, cand.metadata)

            # ── Distance threshold filter ────────────────────────────────
            # Vertex MatchNeighbor.distance is a distance metric: lower is better.
            threshold = settings.VECTOR_SEARCH_CONFIDENCE_THRESHOLD
            candidates = [c for c in candidates if c.score <= threshold]
            candidates.sort(key=lambda c: c.score)
            state["candidates"] = candidates
            logger.info("[%s] After threshold filtering: %d candidates", self.name, len(candidates))
        except Exception as e:
            logger.error("[%s] Vector search failed: %s", self.name, e, exc_info=True)
            state["candidates"] = []
            state["fast_match"] = None
            yield Event(
                author=self.name,
                invocation_id=ctx.invocation_id,
                branch=ctx.branch,
            )
            return

        # ── Fast-match gate ──────────────────────────────────────────
        # If the top result is within the fast-match threshold,
        # write a fast_match dict so ReasoningAgent can skip the LLM call.
        fast_threshold = settings.VECTOR_SEARCH_FAST_MATCH_THRESHOLD
        if candidates and candidates[0].score <= fast_threshold:
            top = candidates[0]
            state["fast_match"] = {
                "id": top.id,
                "score": top.score,
                "metadata": top.metadata,
            }
            logger.info(
                "[%s] ⚡ FAST MATCH: distance=%.3f ≤ %.2f — high-confidence vector result",
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
