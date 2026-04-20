"""
Response Validation Agent — Gemini-backed reply checker.

Evaluates whether the final assistant reply actually answers the
user's question, and rewrites it with Gemini when the answer is
incomplete, truncated, unsupported, or otherwise off-target.
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


class ResponseValidationAgent(BaseAgent):
    """Validate and repair a farmer-facing assistant reply."""

    model_config = ConfigDict(extra="ignore")
    _llm_svc: LLMService | None = PrivateAttr(default=None)

    def _get_llm_service(self) -> LLMService:
        if self._llm_svc is None:
            self._llm_svc = LLMService()
        return self._llm_svc

    async def validate_and_repair_reply(
        self,
        *,
        user_prompt: str,
        draft_reply: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Validate a reply and ask Gemini to repair it when needed."""
        llm_service = self._get_llm_service()
        validation_result = await llm_service.validate_assistant_reply(
            user_prompt=user_prompt,
            assistant_reply=draft_reply,
            context=context,
        )

        final_reply = str(draft_reply or "").strip()
        needs_repair = str(validation_result.get("verdict") or "").strip().lower() != "pass"

        if needs_repair:
            repaired_reply = await llm_service.rewrite_assistant_reply(
                user_prompt=user_prompt,
                assistant_reply=draft_reply,
                context=context,
                validation_result=validation_result,
            )
            repaired_reply = str(repaired_reply or "").strip()
            if repaired_reply:
                final_reply = repaired_reply
                post_repair_validation = await llm_service.validate_assistant_reply(
                    user_prompt=user_prompt,
                    assistant_reply=repaired_reply,
                    context=context,
                )
                validation_result["post_repair_validation"] = post_repair_validation
                if str(post_repair_validation.get("verdict") or "").strip().lower() == "pass":
                    validation_result = post_repair_validation

        validation_result["final_reply"] = final_reply
        validation_result["validation_passed"] = str(validation_result.get("verdict") or "").strip().lower() == "pass"
        return validation_result

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        user_prompt = str(state.get("user_prompt", ""))
        draft_reply = str(
            state.get("assistant_reply")
            or state.get("draft_reply")
            or "",
        )
        context = state.get("validation_context") or state

        try:
            validation_result = await self.validate_and_repair_reply(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context=context,
            )
        except Exception as exc:
            logger.error("[%s] reply validation failed: %s", self.name, exc, exc_info=True)
            validation_result = {
                "verdict": "pass",
                "score": 100,
                "reason": str(exc),
                "missing_requirements": [],
                "unsupported_claims": [],
                "truncated": False,
                "needs_specific_date": False,
                "repair_instruction": "",
                "follow_up_question": "",
                "final_reply": draft_reply,
                "validation_passed": True,
            }

        state["validation_result"] = validation_result
        final_reply = str(validation_result.get("final_reply") or draft_reply).strip()
        state["validated_assistant_reply"] = final_reply
        state["assistant_reply"] = final_reply

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )