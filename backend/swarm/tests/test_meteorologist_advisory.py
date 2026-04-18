from __future__ import annotations

import asyncio

import agents.meteorologist as meteorologist_module
import tools.weather_tool as weather_tool_module
from agents.meteorologist import MeteorologistInput, compute_meteorologist_advisory


def _reset_advisory_cache() -> None:
    meteorologist_module._ADVISORY_CACHE.clear()


def test_meteorologist_advisory_is_cached_for_same_location(monkeypatch):
    _reset_advisory_cache()

    calls = {"weather": 0, "llm": 0}

    async def fake_fetch_weather(input_data):
        calls["weather"] += 1
        return {
            "weather": {
                "temperature_c": 30,
                "humidity_percent": 82,
                "wind_speed_kmh": 14,
                "wind_direction_degrees": 90,
                "precipitation_probability": 18,
                "rainfall_mm": 0,
                "rain_expected_within_hours": None,
            },
            "safe_to_spray": True,
            "next_clear_window": "Now",
        }

    async def fake_llm_generate(prompt: str) -> str:
        calls["llm"] += 1
        return "Cached meteorologist advisory"

    monkeypatch.setattr(weather_tool_module, "fetch_weather", fake_fetch_weather)
    monkeypatch.setattr(meteorologist_module, "llm_generate", fake_llm_generate)

    async def scenario() -> tuple[str, str]:
        first = await compute_meteorologist_advisory(
            MeteorologistInput(lat=3.1, lng=101.6, crop_type="Rice")
        )
        second = await compute_meteorologist_advisory(
            MeteorologistInput(lat=3.1, lng=101.6, crop_type="Rice")
        )
        return first, second

    first, second = asyncio.run(scenario())

    assert first == "Cached meteorologist advisory"
    assert second == "Cached meteorologist advisory"
    assert calls["weather"] == 1
    assert calls["llm"] == 1


def test_meteorologist_advisory_falls_back_when_llm_fails(monkeypatch):
    _reset_advisory_cache()

    async def fake_fetch_weather(input_data):
        return {
            "weather": {
                "temperature_c": 31,
                "humidity_percent": 91,
                "wind_speed_kmh": 22,
                "wind_direction_degrees": 135,
                "precipitation_probability": 64,
                "rainfall_mm": 3,
                "rain_expected_within_hours": 2,
            },
            "safe_to_spray": False,
            "next_clear_window": "After 2 hours",
        }

    async def failing_llm_generate(prompt: str) -> str:
        raise RuntimeError("llm unavailable")

    monkeypatch.setattr(weather_tool_module, "fetch_weather", fake_fetch_weather)
    monkeypatch.setattr(meteorologist_module, "llm_generate", failing_llm_generate)

    result = asyncio.run(
        compute_meteorologist_advisory(
            MeteorologistInput(lat=3.1, lng=101.6, crop_type="Rice")
        )
    )

    assert "Rice spray advisory" in result
    assert "Delay spraying" in result
    assert "After 2 hours" in result
