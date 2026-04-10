"""
Planner Agent — Determines input type and sets retrieval parameters.

This agent performs NO external service calls.  It inspects the
raw request data in the pipeline session state and writes a plan
that downstream agents use to decide their behaviour.

State keys read  (from ctx.session.state):
- ``image_bytes``:  bytes | None
- ``text``:         str | None

State keys written (to ctx.session.state):
- ``input_type``:  ``"image"`` | ``"text"`` | ``"multimodal"``
- ``top_k``:       int — number of candidates to retrieve
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from config import get_settings

logger = logging.getLogger(__name__)


class PlannerAgent(BaseAgent):
    """Analyzes raw input and creates the execution plan."""

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state

        has_image = state.get("image_bytes") is not None
        has_text = bool(state.get("text"))

        if has_image and has_text:
            input_type = "multimodal"
        elif has_image:
            input_type = "image"
        elif has_text:
            input_type = "text"
        else:
            raise ValueError("Planner received empty input — no image or text.")

        settings = get_settings()
        top_k = settings.DEFAULT_TOP_K

        state["input_type"] = input_type
        state["top_k"] = top_k

        logger.info(
            "[%s] input_type=%s, top_k=%d",
            self.name,
            input_type,
            top_k,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
