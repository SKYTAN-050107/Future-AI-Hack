"""
Agriculture Advice Agent — Gemini-backed fallback advisor.

Handles agriculture, horticulture, and farm-management questions when
no more specific specialist agent matches. If the user prompt is not
about agriculture, it returns a concise refusal.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
from pydantic import ConfigDict, PrivateAttr

from services.llm_service import LLMService

logger = logging.getLogger(__name__)


class AgricultureAdviceAgent(BaseAgent):
    """Generate agriculture-only fallback advice."""

    model_config = ConfigDict(extra="ignore")
    _llm_svc: LLMService | None = PrivateAttr(default=None)

    def _get_llm_service(self) -> LLMService:
        if self._llm_svc is None:
            self._llm_svc = LLMService()
        return self._llm_svc

    async def generate_reply(
        self,
        *,
        user_prompt: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Return a Gemini-generated agriculture answer or a refusal."""
        return await self._get_llm_service().generate_agriculture_reply(
            user_prompt=user_prompt,
            context=context or {},
        )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        user_prompt = str(state.get("user_prompt", ""))
        context = state.get("agriculture_context") or state

        try:
            reply = await self.generate_reply(user_prompt=user_prompt, context=context)
        except Exception as exc:
            logger.error("[%s] agriculture advice generation failed: %s", self.name, exc, exc_info=True)
            reply = "This assistant only answers agriculture-related questions. Please ask about crops, planting, soil, irrigation, pests, fertilizer, harvesting, or farm management."

        state["assistant_reply"] = reply
        state["agriculture_reply"] = reply

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )