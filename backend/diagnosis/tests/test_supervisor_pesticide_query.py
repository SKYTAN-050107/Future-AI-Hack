"""Tests for supervisor pesticide-catalog query routing."""

from __future__ import annotations

from unittest.mock import AsyncMock
from typing import Any

import pytest

from orchestration.supervisor import InteractionSupervisor


def test_extract_catalog_pest_query_handles_plain_request() -> None:
    parsed = InteractionSupervisor._extract_catalog_pest_query(
        "suggest pesticide for Adristyrannus",
    )

    assert parsed == "Adristyrannus"


def test_extract_catalog_pest_query_ignores_inventory_prompt() -> None:
    parsed = InteractionSupervisor._extract_catalog_pest_query(
        "check my pesticide inventory",
    )

    assert parsed is None


def test_extract_catalog_pest_query_handles_alternate_word_order() -> None:
    parsed = InteractionSupervisor._extract_catalog_pest_query(
        "what pesticides suggest for rice pest",
    )

    assert parsed == "rice pest"


def test_detect_intents_marks_recent_scan_history_as_diagnosis() -> None:
    intents = InteractionSupervisor._detect_intents("Show my recent scan history")
    assert "diagnosis" in intents


def test_build_effective_prompt_uses_recent_topic_for_brief_follow_up() -> None:
    effective = InteractionSupervisor._build_effective_prompt(
        user_prompt="yes",
        recent_messages=[
            {"role": "user", "text": "how can I treat padi blast"},
            {"role": "ai", "text": "Do you need prevention or treatment guidance?"},
        ],
    )

    assert "Conversation context" in effective
    assert "padi blast" in effective


def test_build_effective_prompt_keeps_normal_prompt_without_context_expansion() -> None:
    effective = InteractionSupervisor._build_effective_prompt(
        user_prompt="how to plant apple",
        recent_messages=[{"role": "user", "text": "padi blast"}],
    )

    assert effective == "how to plant apple"


@pytest.mark.asyncio
async def test_build_text_reply_prefers_catalog_branch_over_inventory() -> None:
    supervisor = InteractionSupervisor()

    catalog_lookup = AsyncMock(
        return_value={
            "matchedPestName": "Adristyrannus",
            "recommendedPesticides": ["Acephate", "Malathion", "Permethrin"],
            "recommendationSource": "pesticideCatalog",
        }
    )
    inventory_lookup = AsyncMock(side_effect=AssertionError("inventory branch should not be called"))

    supervisor._load_pesticide_catalog_recommendation = catalog_lookup
    supervisor._load_inventory_summary = inventory_lookup

    reply = await supervisor.build_text_reply(
        user_prompt="i mean pesticide for Adristyrannus,not my inventory",
        user_id="u1",
    )

    assert "Adristyrannus" in reply
    assert "Acephate" in reply
    assert "inventory" not in reply.lower()
    catalog_lookup.assert_awaited_once()
    inventory_lookup.assert_not_awaited()


@pytest.mark.asyncio
async def test_build_text_reply_catalog_miss_returns_clear_message() -> None:
    supervisor = InteractionSupervisor()

    supervisor._load_pesticide_catalog_recommendation = AsyncMock(return_value={})

    reply = await supervisor.build_text_reply(
        user_prompt="pesticide for UnknownPest",
        user_id="u1",
    )

    assert "specific treatment data" in reply.lower()
    assert "unknownpest" in reply.lower()


@pytest.mark.asyncio
async def test_build_text_reply_generic_pest_question_avoids_scan_context() -> None:
    supervisor = InteractionSupervisor()

    class _StubAgricultureAgent:
        def __init__(self) -> None:
            self.context: dict[str, Any] | None = None

        async def generate_reply(self, *, user_prompt: str, context: dict[str, Any] | None = None) -> str:
            self.context = context or {}
            return "General pest prevention guidance"

    stub_agent = _StubAgricultureAgent()
    supervisor._get_agriculture_advice_agent = lambda: stub_agent  # type: ignore[method-assign]
    supervisor._load_recent_scan_context = AsyncMock(
        side_effect=AssertionError("recent scan context should not be loaded for generic pest prompt")
    )
    supervisor._finalize_response = AsyncMock(
        side_effect=lambda **kwargs: kwargs["draft_reply"]
    )

    reply = await supervisor.build_text_reply(
        user_prompt="how to prevent pest",
        user_id="u1",
    )

    assert reply == "General pest prevention guidance"
    assert stub_agent.context is not None
    assert stub_agent.context.get("recent_scan") == {}
    supervisor._finalize_response.assert_awaited_once()
    assert supervisor._finalize_response.await_args.kwargs.get("validate") is True


@pytest.mark.asyncio
async def test_build_text_reply_recent_scan_history_returns_scan_summary() -> None:
    supervisor = InteractionSupervisor()

    supervisor._get_llm_service = lambda: None  # type: ignore[method-assign]
    supervisor._load_recent_scan_context = AsyncMock(
        return_value={
            "has_reports": True,
            "report_count": 2,
            "latest_report": {
                "cropType": "Padi",
                "disease": "Rice Blast",
                "severityScore": 72,
                "treatmentPlan": "Apply recommended fungicide",
            },
            "recent_reports": [],
            "trend": "Severity trend is stable; monitor closely and keep treatment discipline.",
        }
    )
    supervisor._finalize_response = AsyncMock(
        side_effect=lambda **kwargs: kwargs["draft_reply"]
    )

    reply = await supervisor.build_text_reply(
        user_prompt="Show my recent scan history",
        user_id="u1",
    )

    assert "latest scan" in reply.lower()
    assert "rice blast" in reply.lower()
    assert "acrezen" not in reply.lower()
    supervisor._load_recent_scan_context.assert_awaited_once()


@pytest.mark.asyncio
async def test_build_text_reply_brief_follow_up_uses_recent_user_topic() -> None:
    supervisor = InteractionSupervisor()

    class _StubAgricultureAgent:
        def __init__(self) -> None:
            self.user_prompt: str | None = None

        async def generate_reply(self, *, user_prompt: str, context: dict[str, Any] | None = None) -> str:
            self.user_prompt = user_prompt
            return "Follow-up guidance"

    stub_agent = _StubAgricultureAgent()
    supervisor._get_agriculture_advice_agent = lambda: stub_agent  # type: ignore[method-assign]
    supervisor._finalize_response = AsyncMock(side_effect=lambda **kwargs: kwargs["draft_reply"])

    reply = await supervisor.build_text_reply(
        user_prompt="yes",
        user_id="u1",
        recent_messages=[
            {"role": "user", "text": "padi blast"},
            {"role": "ai", "text": "Do you need prevention or treatment guidance?"},
        ],
    )

    assert reply == "Follow-up guidance"
    assert stub_agent.user_prompt is not None
    assert "Conversation context" in stub_agent.user_prompt
    assert "padi blast" in stub_agent.user_prompt
