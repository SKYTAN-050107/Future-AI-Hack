"""Tests for ChatToolAgent with a mocked LLM client.

Each test constructs a ChatToolAgent with mock services and a FakeLLM that
returns pre-scripted Gemini-style responses (function calls, then text).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock

import pytest

from agents.chat_tool_agent import ChatToolAgent, ChatToolAgentError


# ── Fake Gemini response objects ─────────────────────────────────────────

@dataclass
class _FakeFunctionCall:
    name: str
    args: dict[str, Any]


@dataclass
class _FakePart:
    text: str | None = None
    function_call: _FakeFunctionCall | None = None
    function_response: dict | None = None

    @classmethod
    def from_text(cls, *, text: str) -> "_FakePart":
        return cls(text=text)

    @classmethod
    def from_function_response(cls, *, name: str, response: dict) -> "_FakePart":
        return cls(function_response={"name": name, "response": response})


@dataclass
class _FakeContent:
    role: str = "model"
    parts: list[_FakePart] = field(default_factory=list)


@dataclass
class _FakeCandidate:
    content: _FakeContent


@dataclass
class _FakeResponse:
    candidates: list[_FakeCandidate]


def _tool_call_response(*calls: tuple[str, dict[str, Any]]) -> _FakeResponse:
    """Build a fake Gemini response containing one or more function calls."""
    parts = [_FakePart(function_call=_FakeFunctionCall(name=n, args=a)) for n, a in calls]
    return _FakeResponse(candidates=[_FakeCandidate(content=_FakeContent(parts=parts))])


def _text_response(text: str) -> _FakeResponse:
    """Build a fake Gemini response containing plain text."""
    return _FakeResponse(candidates=[_FakeCandidate(content=_FakeContent(parts=[_FakePart(text=text)]))])


# ── Helpers ──────────────────────────────────────────────────────────────

def _make_agent(
    *,
    llm_responses: list[_FakeResponse],
    scan_reports: list[dict[str, Any]] | None = None,
    inventory_payload: dict[str, Any] | None = None,
    weather_payload: dict[str, Any] | None = None,
    crop_payload: dict[str, Any] | None = None,
    treatment_payload: dict[str, Any] | None = None,
    catalog_payload: dict[str, Any] | None = None,
    swarm_payload: dict[str, Any] | None = None,
) -> ChatToolAgent:
    """Create a ChatToolAgent with all services mocked."""
    # LLM service with scripted responses
    call_index = {"i": 0}

    async def _generate_with_tools(_self, **kwargs):
        idx = call_index["i"]
        call_index["i"] += 1
        if idx < len(llm_responses):
            return llm_responses[idx]
        return _text_response("Fallback answer from AcreZen.")

    llm_service = type("FakeLLM", (), {"generate_with_tools": _generate_with_tools})()

    # Scan reports loader
    async def _load_scan_reports(user_id: str, zone: str | None) -> list[dict[str, Any]]:
        return scan_reports or []

    # Inventory service
    inventory_svc = type("FakeInventory", (), {
        "list_items": AsyncMock(return_value=inventory_payload or {"items": [], "total_items": 0, "low_stock_count": 0}),
    })()

    # Crop service
    crop_svc = type("FakeCrop", (), {
        "list_crops": AsyncMock(return_value=crop_payload or {"items": [], "count": 0}),
    })()

    # Weather service
    weather_svc = None
    if weather_payload is not None:
        weather_svc = type("FakeWeather", (), {
            "get_outlook": AsyncMock(return_value=weather_payload),
        })()

    # Treatment service
    treatment_svc = None
    if treatment_payload is not None:
        treatment_svc = type("FakeTreatment", (), {
            "build_plan": AsyncMock(return_value=treatment_payload),
        })()

    # Firestore service
    firestore_svc = None
    if catalog_payload is not None:
        firestore_svc = type("FakeFirestore", (), {
            "get_pesticide_catalog_recommendation": AsyncMock(return_value=catalog_payload),
        })()

    # Swarm client
    swarm_client = None
    if swarm_payload is not None:
        swarm_client = type("FakeSwarm", (), {
            "is_configured": True,
            "run_orchestrator": AsyncMock(return_value=swarm_payload),
        })()

    return ChatToolAgent(
        llm_service=llm_service,
        crop_service=crop_svc,
        inventory_service=inventory_svc,
        weather_service=weather_svc,
        treatment_service=treatment_svc,
        firestore_service=firestore_svc,
        swarm_client=swarm_client,
        load_scan_reports=_load_scan_reports,
    )


# ── Tests ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_only_question() -> None:
    """LLM calls get_scan_history once, then returns a reply citing the scan."""
    agent = _make_agent(
        scan_reports=[
            {
                "gridId": "A",
                "cropType": "Padi",
                "disease": "Rice Blast",
                "severity": "Moderate",
                "severityScore": 0.72,
                "treatmentPlan": "Apply Tricyclazole",
                "survivalProb": 0.6,
                "timestamp": 1700000000,
            }
        ],
        llm_responses=[
            _tool_call_response(("get_scan_history", {"limit": 3})),
            _text_response(
                "Finding\n"
                "- Your latest scan shows moderate Rice Blast on Padi in zone A.\n\n"
                "Actions\n"
                "- Apply Tricyclazole immediately.\n\n"
                "Treatment\n"
                "- Tricyclazole 75 WP at recommended rate.\n\n"
                "Recheck\n"
                "- Recheck in 48 hours."
            ),
        ],
    )

    reply = await agent.run(
        effective_user_prompt="What's my latest scan?",
        user_id="uid1",
        zone="A",
        lat=None,
        lng=None,
        location=None,
        recent_messages=[],
    )

    assert "Rice Blast" in reply
    assert "Tricyclazole" in reply


@pytest.mark.asyncio
async def test_inventory_only_question() -> None:
    """LLM calls get_inventory once, reply mentions stock levels."""
    agent = _make_agent(
        inventory_payload={
            "items": [
                {"id": "1", "name": "Urea", "quantity": 20, "unit": "kg", "low_stock": False},
                {"id": "2", "name": "Malathion", "quantity": 0.5, "unit": "L", "low_stock": True},
            ],
            "total_items": 2,
            "low_stock_count": 1,
        },
        llm_responses=[
            _tool_call_response(("get_inventory", {})),
            _text_response(
                "Finding\n"
                "- You have 2 items in stock. Malathion is running low.\n\n"
                "Actions\n"
                "- Restock Malathion before next spray.\n"
                "- Check Urea usage rate.\n\n"
                "Treatment\n"
                "- No treatment needed at this time.\n\n"
                "Recheck\n"
                "- Recheck stock after next spray cycle."
            ),
        ],
    )

    reply = await agent.run(
        effective_user_prompt="Do I have enough urea?",
        user_id="uid1",
        zone=None,
        lat=None,
        lng=None,
        location=None,
        recent_messages=[],
    )

    assert "Malathion" in reply
    assert "low" in reply.lower() or "running" in reply.lower()


@pytest.mark.asyncio
async def test_multi_tool_chain() -> None:
    """LLM calls scan → weather → treatment across multiple iterations."""
    agent = _make_agent(
        scan_reports=[
            {
                "gridId": "B",
                "cropType": "Padi",
                "disease": "Brown Spot",
                "severity": "High",
                "severityScore": 0.88,
                "treatmentPlan": "Mancozeb spray",
                "survivalProb": 0.5,
                "timestamp": 1700000000,
            }
        ],
        weather_payload={
            "condition": "Partly Cloudy",
            "temperatureC": 30,
            "windKmh": 8,
            "humidity": 78,
            "safeToSpray": True,
            "rainInHours": None,
            "forecast": [],
        },
        treatment_payload={
            "recommendation": "Apply Mancozeb",
            "estimated_cost_rm": 45.0,
            "expected_gain_rm": 250.0,
            "profit_rm": 205.0,
            "roi_percent": 455.0,
            "yield_kg": 500,
        },
        llm_responses=[
            _tool_call_response(("get_scan_history", {})),
            _tool_call_response(("get_weather_outlook", {"days": 3})),
            _tool_call_response(("get_treatment_plan", {})),
            _text_response(
                "Finding\n"
                "- Severe Brown Spot detected on Padi zone B, 88% severity.\n\n"
                "Actions\n"
                "- Treat immediately; weather is safe to spray.\n"
                "- Budget RM45 for treatment; expected return RM250.\n\n"
                "Treatment\n"
                "- Mancozeb spray at recommended rate. ROI 455%.\n\n"
                "Recheck\n"
                "- Recheck in 24 hours."
            ),
        ],
    )

    reply = await agent.run(
        effective_user_prompt="Should I treat zone B today? What's the ROI?",
        user_id="uid1",
        zone="B",
        lat=3.13,
        lng=101.68,
        location="Sungai Besar",
        recent_messages=[],
    )

    assert "Brown Spot" in reply
    assert "Mancozeb" in reply
    assert "455" in reply or "ROI" in reply


@pytest.mark.asyncio
async def test_swarm_advisory() -> None:
    """LLM calls run_swarm_advisory, swarm client mocked with payload."""
    agent = _make_agent(
        scan_reports=[
            {
                "gridId": "C",
                "cropType": "Padi",
                "disease": "Sheath Blight",
                "severity": "High",
                "severityScore": 0.9,
                "treatmentPlan": "Hexaconazole",
                "survivalProb": 0.45,
                "timestamp": 1700000000,
            }
        ],
        weather_payload={
            "condition": "Clear",
            "temperatureC": 32,
            "windKmh": 6,
            "windDirection": "NE",
            "humidity": 70,
            "safeToSpray": True,
        },
        swarm_payload={
            "weather": {"summary": "Clear skies, safe to spray"},
            "economy": {"roi_percent": 320, "recommendation": "Treat now"},
            "resources": {"status": "adequate"},
            "spatial_risk": {"risk_zones": ["D", "E"]},
            "yield_forecast": {"expected_yield_kg": 400},
            "chatbot_reply": "Full advisory: treat immediately, isolate zone D and E.",
        },
        llm_responses=[
            _tool_call_response(("run_swarm_advisory", {})),
            _text_response(
                "Finding\n"
                "- Severe Sheath Blight in zone C. Zones D and E are at risk.\n\n"
                "Actions\n"
                "- Treat zone C immediately with Hexaconazole.\n"
                "- Monitor zones D and E for spread.\n\n"
                "Treatment\n"
                "- Hexaconazole at recommended dosage. ROI 320%.\n\n"
                "Recheck\n"
                "- Recheck all three zones within 24 hours."
            ),
        ],
    )

    reply = await agent.run(
        effective_user_prompt="Give me a full risk advisory for my farm",
        user_id="uid1",
        zone="C",
        lat=3.13,
        lng=101.68,
        location="Sungai Besar",
        recent_messages=[],
    )

    assert "Sheath Blight" in reply
    assert "D" in reply and "E" in reply  # spatial risk zones


@pytest.mark.asyncio
async def test_tool_failure_fallback() -> None:
    """When a tool raises, the loop continues with an error dict injected."""
    # Create agent where inventory will raise, but LLM still produces a reply
    agent = _make_agent(
        llm_responses=[
            _tool_call_response(("get_inventory", {})),
            _text_response(
                "Finding\n"
                "- I was unable to retrieve your inventory data.\n\n"
                "Actions\n"
                "- Please check that your inventory is set up in the app.\n\n"
                "Treatment\n"
                "- No treatment action needed.\n\n"
                "Recheck\n"
                "- Try again in a few minutes."
            ),
        ],
    )

    # Force inventory service to raise
    agent._inventory_service.list_items = AsyncMock(
        side_effect=RuntimeError("Firestore connection timeout")
    )

    reply = await agent.run(
        effective_user_prompt="What's in my inventory?",
        user_id="uid1",
        zone=None,
        lat=None,
        lng=None,
        location=None,
        recent_messages=[],
    )

    # Agent should still return a reply (not crash)
    assert reply
    assert "inventory" in reply.lower()


@pytest.mark.asyncio
async def test_empty_prompt_raises() -> None:
    """Empty user prompt raises ChatToolAgentError."""
    agent = _make_agent(llm_responses=[_text_response("hi")])

    with pytest.raises(ChatToolAgentError, match="effective_user_prompt is required"):
        await agent.run(
            effective_user_prompt="",
            user_id="uid1",
            zone=None,
            lat=None,
            lng=None,
            location=None,
            recent_messages=[],
        )


@pytest.mark.asyncio
async def test_gemini_failure_raises_agent_error() -> None:
    """When LLM generate_with_tools raises, ChatToolAgentError is raised."""

    async def _exploding_generate(_self, **kwargs):
        raise RuntimeError("quota exceeded")

    llm_service = type("BrokenLLM", (), {"generate_with_tools": _exploding_generate})()

    agent = ChatToolAgent(
        llm_service=llm_service,
        crop_service=type("C", (), {"list_crops": AsyncMock()})(),
        inventory_service=type("I", (), {"list_items": AsyncMock()})(),
        weather_service=None,
        treatment_service=None,
        firestore_service=None,
        swarm_client=None,
        load_scan_reports=AsyncMock(return_value=[]),
    )

    with pytest.raises(ChatToolAgentError, match="Gemini call failed"):
        await agent.run(
            effective_user_prompt="What should I do?",
            user_id="uid1",
            zone=None,
            lat=None,
            lng=None,
            location=None,
            recent_messages=[],
        )


@pytest.mark.asyncio
async def test_disconnection_handling() -> None:
    """Simulate a transient network failure; verify retries produce a valid reply.

    The inventory service raises ConnectionError on the first call, then
    succeeds on the second (mimicking a brief network blip).  Because
    ``_dispatch_with_retry`` retries with exponential backoff, the tool
    should succeed on the second attempt.
    """
    call_count = {"n": 0}
    good_payload = {
        "items": [
            {"id": "1", "name": "Urea", "quantity": 20, "unit": "kg", "low_stock": False},
        ],
        "total_items": 1,
        "low_stock_count": 0,
    }

    async def _flaky_list_items(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ConnectionError("Connection reset by peer")
        return good_payload

    agent = _make_agent(
        inventory_payload=good_payload,
        llm_responses=[
            _tool_call_response(("get_inventory", {})),
            _text_response(
                "Finding\n"
                "- You have 1 item in stock. Urea at 20 kg.\n\n"
                "Actions\n"
                "- Monitor Urea usage rate.\n\n"
                "Treatment\n"
                "- No treatment needed.\n\n"
                "Recheck\n"
                "- Recheck after next application."
            ),
        ],
    )

    # Patch inventory service with flaky implementation
    agent._inventory_service.list_items = _flaky_list_items

    reply = await agent.run(
        effective_user_prompt="How much urea do I have?",
        user_id="uid1",
        zone=None,
        lat=None,
        lng=None,
        location=None,
        recent_messages=[],
    )

    # Should succeed despite the first call failing
    assert reply
    assert "Urea" in reply
    # Inventory was called twice (first failed, second succeeded)
    assert call_count["n"] == 2


@pytest.mark.asyncio
async def test_all_retries_exhausted_returns_error() -> None:
    """When all retry attempts fail, the tool returns an error dict (not crash).

    The LLM then gets the error and still produces a reply acknowledging
    the failure.
    """
    async def _always_fail(**kwargs):
        raise ConnectionError("Service permanently down")

    agent = _make_agent(
        llm_responses=[
            _tool_call_response(("get_inventory", {})),
            _text_response(
                "Finding\n"
                "- I could not reach your inventory service.\n\n"
                "Actions\n"
                "- Please try again later.\n\n"
                "Treatment\n"
                "- No action needed.\n\n"
                "Recheck\n"
                "- Try again in a few minutes."
            ),
        ],
    )
    agent._inventory_service.list_items = _always_fail

    reply = await agent.run(
        effective_user_prompt="Check my stock",
        user_id="uid1",
        zone=None,
        lat=None,
        lng=None,
        location=None,
        recent_messages=[],
    )

    # Agent should NOT crash — it should return the LLM's graceful reply
    assert reply
    assert "inventory" in reply.lower() or "try" in reply.lower()

