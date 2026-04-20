from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from services.weather_service import WeatherService


def _reset_weather_service_cache() -> None:
    WeatherService._cache.clear()
    WeatherService._rate_limit_cooldowns.clear()
    WeatherService._key_locks.clear()


def _build_weather_payload(days: int = 2) -> dict:
    start = datetime(2026, 4, 18, 0, 0, tzinfo=timezone.utc)
    hourly: list[dict] = []

    for index in range(days * 24):
        timestamp = start + timedelta(hours=index)
        hourly.append(
            {
                "time": timestamp.isoformat().replace("+00:00", "Z"),
                "values": {
                    "temperature": 29 + (index % 3),
                    "humidity": 80,
                    "windSpeed": 2.0,
                    "windDirection": 90,
                    "precipitationProbability": 20,
                    "weatherCode": 1000,
                },
            }
        )

    daily: list[dict] = []
    for index in range(days):
        day = start + timedelta(days=index)
        daily.append(
            {
                "time": day.isoformat().replace("+00:00", "Z"),
                "values": {
                    "precipitationProbabilityAvg": 20 if index == 0 else 60,
                    "windSpeedAvg": 2.0,
                    "windDirectionAvg": 90,
                    "weatherCodeMax": 1000,
                    "temperatureMax": 31,
                    "temperatureMin": 24,
                },
            }
        )

    return {"timelines": {"hourly": hourly, "daily": daily}}


def test_get_outlook_reuses_cached_payload_across_day_windows():
    _reset_weather_service_cache()

    service = WeatherService()
    service._api_key = "test-key"
    service._base_url = "https://example.com/weather"

    calls = {"count": 0}

    async def fake_fetch_weather_payload(lat: float, lng: float) -> dict:
        calls["count"] += 1
        return _build_weather_payload(days=2)

    async def fake_recommendation(snapshot) -> str:
        return f"Advisory for {snapshot.condition}"

    service._fetch_weather_payload = fake_fetch_weather_payload
    service._generate_recommendation = fake_recommendation

    async def scenario() -> tuple[dict, dict]:
        first = await service.get_outlook(lat=3.1, lng=101.6, days=7)
        second = await service.get_outlook(lat=3.1, lng=101.6, days=1)
        return first, second

    first, second = asyncio.run(scenario())

    assert calls["count"] == 1
    assert len(first["forecast"]) == 2
    assert len(second["forecast"]) == 1
    assert first["condition"] == "Clear"
    assert "serviceWarning" not in first
    assert "serviceWarning" not in second


def test_get_outlook_returns_cached_data_on_429():
    _reset_weather_service_cache()

    service = WeatherService()
    service._api_key = "test-key"
    service._base_url = "https://example.com/weather"

    async def fake_fetch_weather_payload(lat: float, lng: float) -> dict:
        return _build_weather_payload(days=2)

    async def fake_recommendation(snapshot) -> str:
        return f"Advisory for {snapshot.condition}"

    service._fetch_weather_payload = fake_fetch_weather_payload
    service._generate_recommendation = fake_recommendation

    async def warm_cache() -> None:
        await service.get_outlook(lat=3.1, lng=101.6, days=7)

    asyncio.run(warm_cache())

    cache_key = service._cache_key(lat=3.1, lng=101.6)
    WeatherService._cache[cache_key].fetched_at = datetime.now(timezone.utc) - timedelta(minutes=45)

    async def rate_limited_fetch_weather_payload(lat: float, lng: float) -> dict:
        request = httpx.Request("GET", "https://api.tomorrow.io/v4/weather/forecast")
        response = httpx.Response(429, request=request, headers={"Retry-After": "30"})
        raise httpx.HTTPStatusError("Too Many Requests", request=request, response=response)

    service._fetch_weather_payload = rate_limited_fetch_weather_payload

    async def scenario() -> dict:
        return await service.get_outlook(lat=3.1, lng=101.6, days=7)

    result = asyncio.run(scenario())

    assert result["condition"] == "Clear"
    assert result["safeToSpray"] is True
    assert result["forecast"]
    assert "cached weather data" in str(result["serviceWarning"]).lower()


def test_get_outlook_falls_back_when_rate_limited_without_cache():
    _reset_weather_service_cache()

    service = WeatherService()
    service._api_key = "test-key"
    service._base_url = "https://example.com/weather"

    async def rate_limited_fetch_weather_payload(lat: float, lng: float) -> dict:
        request = httpx.Request("GET", "https://api.tomorrow.io/v4/weather/forecast")
        response = httpx.Response(429, request=request, headers={"Retry-After": "15"})
        raise httpx.HTTPStatusError("Too Many Requests", request=request, response=response)

    service._fetch_weather_payload = rate_limited_fetch_weather_payload

    async def scenario() -> dict:
        return await service.get_outlook(lat=3.1, lng=101.6, days=7)

    result = asyncio.run(scenario())

    assert result["condition"] == "Weather service temporarily unavailable"
    assert result["safeToSpray"] is False
    assert result["forecast"] == []
    assert "rate limited" in str(result["serviceWarning"]).lower()