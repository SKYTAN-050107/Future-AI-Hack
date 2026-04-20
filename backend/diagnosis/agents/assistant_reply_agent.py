"""
Assistant Reply Agent — Google ADK BaseAgent.

Consumes ``scan_result`` produced by ReasoningAgent and uses Gemini
(via LLMService) to generate a conversational response for chatbot UI.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
from pydantic import ConfigDict, PrivateAttr

from services.llm_service import LLMService, build_farmer_fallback_dialogue

logger = logging.getLogger(__name__)


def _get_reply_setter():
    """Lazy import to avoid circular dependency."""
    try:
        from orchestration.assistant_pipeline import _latest_assistant_reply
        return _latest_assistant_reply
    except (ImportError, AttributeError):
        return None


class AssistantReplyAgent(BaseAgent):
    """Generate assistant dialogue from diagnosis output."""

    model_config = ConfigDict(extra="ignore")
    _llm_svc: LLMService | None = PrivateAttr(default=None)

    def _get_llm_service(self) -> LLMService:
        if self._llm_svc is None:
            self._llm_svc = LLMService()
        return self._llm_svc

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        scan_result = state.get("scan_result", {})
        user_prompt = str(
            state.get(
                "user_prompt",
                "I just took this photo. Please explain what was detected and what I should do next.",
            ),
        )

        try:
            assistant_reply = await self._get_llm_service().generate_assistant_dialogue(
                scan_result=scan_result,
                user_prompt=user_prompt,
            )
        except Exception as exc:
            logger.error("[%s] assistant reply generation failed: %s", self.name, exc, exc_info=True)
            assistant_reply = build_farmer_fallback_dialogue(
                scan_result=scan_result,
                user_prompt=user_prompt,
                reason=str(exc),
            )

        state["assistant_reply"] = assistant_reply
        reply_setter = _get_reply_setter()
        if reply_setter:
            reply_setter.set(assistant_reply)

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
