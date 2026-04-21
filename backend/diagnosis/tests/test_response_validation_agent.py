"""Tests for ResponseValidationAgent rewrite-selection behavior."""

from __future__ import annotations

import pytest

from agents.response_validation_agent import ResponseValidationAgent


class _FakeLLMService:
    def __init__(self, *, initial_validation: dict, rewritten_text: str, post_validation: dict) -> None:
        self.initial_validation = initial_validation
        self.rewritten_text = rewritten_text
        self.post_validation = post_validation
        self._validate_calls = 0

    async def validate_assistant_reply(self, *, user_prompt: str, assistant_reply: str, context: dict):
        self._validate_calls += 1
        if self._validate_calls == 1:
            return dict(self.initial_validation)
        return dict(self.post_validation)

    async def rewrite_assistant_reply(self, *, user_prompt: str, assistant_reply: str, context: dict, validation_result: dict):
        return self.rewritten_text


@pytest.mark.asyncio
async def test_validate_and_repair_keeps_original_when_rewrite_still_truncated() -> None:
    agent = ResponseValidationAgent(name="ResponseValidationAgent", description="test")
    fake_llm = _FakeLLMService(
        initial_validation={"verdict": "rewrite", "truncated": False},
        rewritten_text="You are asking about padi blast. To help you best, are",
        post_validation={"verdict": "rewrite", "truncated": True},
    )
    agent._llm_svc = fake_llm

    result = await agent.validate_and_repair_reply(
        user_prompt="I dont understand",
        draft_reply="Please clarify if you need prevention or treatment guidance for padi blast.",
        context={"intents": []},
    )

    assert result["final_reply"] == "Please clarify if you need prevention or treatment guidance for padi blast."


@pytest.mark.asyncio
async def test_validate_and_repair_uses_rewrite_when_post_validation_passes() -> None:
    agent = ResponseValidationAgent(name="ResponseValidationAgent", description="test")
    fake_llm = _FakeLLMService(
        initial_validation={"verdict": "rewrite", "truncated": False},
        rewritten_text="Please confirm whether you want prevention steps or treatment steps for padi blast.",
        post_validation={"verdict": "pass", "truncated": False},
    )
    agent._llm_svc = fake_llm

    result = await agent.validate_and_repair_reply(
        user_prompt="yes",
        draft_reply="I can help with padi blast.",
        context={"intents": []},
    )

    assert result["final_reply"].startswith("Please confirm whether you want prevention steps")
