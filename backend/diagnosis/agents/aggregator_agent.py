"""
Aggregator Agent — Assembles the final structured response.

Combines outputs from all previous agents into the canonical
``AnalyzeResponse`` format.  Handles edge cases such as:
- No candidates found
- Low confidence results
- Missing validation fields

State keys read  (from ctx.session.state):
- ``validation_result``: dict from Validation Agent
- ``candidates``:        list[RetrievalCandidate] (for fallback data)

State keys written (to ctx.session.state):
- ``response``:  dict matching AnalyzeResponse schema
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

logger = logging.getLogger(__name__)


class AggregatorAgent(BaseAgent):
    """Produces the final structured response from pipeline session state."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        validation = state.get("validation_result", {})

        result = validation.get("result", "Unknown")
        confidence = validation.get("confidence", 0.0)
        reason = validation.get("reason", "No reasoning provided.")
        alternatives = validation.get("alternatives", [])

        # Clamp confidence to [0.0, 1.0]
        confidence = max(0.0, min(1.0, float(confidence)))

        # Ensure alternatives is a list of strings
        if not isinstance(alternatives, list):
            alternatives = []
        alternatives = [str(a) for a in alternatives]

        state["response"] = {
            "result": str(result),
            "confidence": confidence,
            "reason": str(reason),
            "alternatives": alternatives,
        }

        logger.info(
            "[%s] Final response assembled — result=%s, confidence=%.2f",
            self.name,
            result,
            confidence,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
