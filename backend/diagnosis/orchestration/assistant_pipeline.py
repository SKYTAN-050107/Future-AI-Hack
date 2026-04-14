"""
Assistant pipeline for chatbot responses based on diagnosis output.

Runs one ADK agent:
    AssistantReplyAgent

Input state:
    scan_result, user_prompt
Output state:
    assistant_reply
"""

from __future__ import annotations

from contextvars import ContextVar
import logging
import uuid

from google.adk.agents import SequentialAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from agents.assistant_reply_agent import AssistantReplyAgent

logger = logging.getLogger(__name__)

_ASSISTANT_APP_NAME = "padiguard_assistant"
_ASSISTANT_TRIGGER = genai_types.Content(parts=[genai_types.Part(text="assistant")])
_latest_assistant_reply: ContextVar[str | None] = ContextVar("_latest_assistant_reply", default=None)


class AssistantPipeline:
    """Run AssistantReplyAgent to turn diagnosis into dialogue."""

    def __init__(self) -> None:
        self._pipeline = SequentialAgent(
            name="AssistantPipeline",
            description="Generate chatbot reply from ReasoningAgent output.",
            sub_agents=[
                AssistantReplyAgent(
                    name="AssistantReplyAgent",
                    description="Converts diagnosis result into farmer-facing dialogue.",
                ),
            ],
        )

        self._session_svc = InMemorySessionService()
        self._runner = Runner(
            agent=self._pipeline,
            app_name=_ASSISTANT_APP_NAME,
            session_service=self._session_svc,
        )

    async def run(self, scan_result: dict, user_prompt: str) -> str:
        """Generate chatbot text from diagnosis output."""
        token = _latest_assistant_reply.set(None)
        fallback_reply = (
            "这是什么\n"
            f"{scan_result.get('disease', 'Inconclusive')}（作物类型：{scan_result.get('cropType', 'Unknown')}）\n\n"
            "治疗方案\n"
            f"{scan_result.get('treatmentPlan', '请根据复扫结果决定下一步处理。')}\n\n"
            "立即行动\n"
            "1. 保留病斑近照并记录位置。\n"
            "2. 先隔离可疑植株或叶片，避免扩散。\n\n"
            "复查时间\n24-48小时内复扫同一区域。"
        )
        session = await self._session_svc.create_session(
            app_name=_ASSISTANT_APP_NAME,
            user_id="assistant",
            session_id=uuid.uuid4().hex,
            state={
                "scan_result": scan_result,
                "user_prompt": user_prompt,
            },
        )

        async for _ in self._runner.run_async(
            user_id="assistant",
            session_id=session.id,
            new_message=_ASSISTANT_TRIGGER,
        ):
            pass

        reply_from_context = _latest_assistant_reply.get()
        _latest_assistant_reply.reset(token)
        if reply_from_context:
            logger.info("[AssistantPipeline] Reply generated from context (%d chars)", len(reply_from_context))
            return reply_from_context

        final_session = await self._session_svc.get_session(
            app_name=_ASSISTANT_APP_NAME,
            user_id="assistant",
            session_id=session.id,
        )
        reply = str(
            final_session.state.get(
                "assistant_reply",
                fallback_reply,
            ),
        )
        logger.info("[AssistantPipeline] Reply generated (%d chars)", len(reply))
        return reply
