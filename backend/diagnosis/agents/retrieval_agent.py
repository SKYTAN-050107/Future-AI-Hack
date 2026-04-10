"""
Retrieval Agent — Performs Top-K vector similarity search.

This agent MUST execute before the Validation Agent.  The ADK
SequentialAgent pipeline enforces this ordering automatically.

State keys read  (from ctx.session.state):
- ``embedding``:  list[float] from Embedding Agent
- ``top_k``:      int from Planner Agent

State keys written (to ctx.session.state):
- ``candidates``:  list[RetrievalCandidate] — ranked by similarity score
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from models.candidate import RetrievalCandidate
from services.vector_search_service import VectorSearchService

logger = logging.getLogger(__name__)


class RetrievalAgent(BaseAgent):
    """Performs vector similarity search to find Top-K candidates."""

    _search_service: VectorSearchService = PrivateAttr(
        default_factory=VectorSearchService
    )

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        embedding: list[float] = state["embedding"]
        top_k: int = state["top_k"]

        candidates: list[RetrievalCandidate] = (
            await self._search_service.search(embedding, top_k)
        )

        state["candidates"] = candidates
        logger.info(
            "[%s] Retrieved %d candidate(s) from vector search",
            self.name,
            len(candidates),
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
