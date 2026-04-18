"""Tests for supervisor pesticide-catalog query routing."""

from __future__ import annotations

from unittest.mock import AsyncMock

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

    assert "could not find" in reply.lower()
    assert "unknownpest" in reply.lower()
