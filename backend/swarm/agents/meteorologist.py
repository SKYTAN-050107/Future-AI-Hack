"""Agent 1: The Meteorologist — Weather & Spray Safety Advisory."""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate
from schemas.context import AgentContext, WeatherContext


logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _AdvisoryCacheEntry:
    weather_result: dict
    advisory: str
    fetched_at: datetime


class MeteorologistInput(BaseModel):
    lat: float
    lng: float
    crop_type: str
    context: AgentContext | None = None


MeteorologistInput.model_rebuild()


_ADVISORY_CACHE: dict[str, _AdvisoryCacheEntry] = {}
_ADVISORY_CACHE_LOCK = Lock()
_ADVISORY_CACHE_TTL_SECONDS = 15 * 60


def _cache_key(lat: float, lng: float, crop_type: str) -> str:
    return f"{lat:.4f}:{lng:.4f}:{str(crop_type or '').strip().lower()}"


def _get_cached_advisory(cache_key: str) -> _AdvisoryCacheEntry | None:
    with _ADVISORY_CACHE_LOCK:
        entry = _ADVISORY_CACHE.get(cache_key)
        if entry is None:
            return None

        age_seconds = (datetime.now(timezone.utc) - entry.fetched_at).total_seconds()
        if age_seconds > _ADVISORY_CACHE_TTL_SECONDS:
            _ADVISORY_CACHE.pop(cache_key, None)
            return None

        return entry


def _store_cached_advisory(cache_key: str, weather_result: dict, advisory: str) -> None:
    with _ADVISORY_CACHE_LOCK:
        _ADVISORY_CACHE[cache_key] = _AdvisoryCacheEntry(
            weather_result=deepcopy(weather_result),
            advisory=advisory,
            fetched_at=datetime.now(timezone.utc),
        )


def _update_context(context: AgentContext | None, weather_result: dict, advisory: str) -> None:
    if context is None:
        return

    weather = weather_result.get("weather") or {}
    context.weather = WeatherContext(
        temperature_c=weather.get("temperature_c"),
        humidity_percent=weather.get("humidity_percent"),
        wind_speed_kmh=weather.get("wind_speed_kmh"),
        wind_direction_degrees=weather.get("wind_direction_degrees"),
        precipitation_probability=weather.get("precipitation_probability"),
        rainfall_mm=weather.get("rainfall_mm"),
        rain_expected_within_hours=weather.get("rain_expected_within_hours"),
        safe_to_spray=weather_result.get("safe_to_spray"),
        next_clear_window=weather_result.get("next_clear_window"),
        advisory=advisory,
    )


def _build_fallback_advisory(weather_result: dict, crop_type: str) -> str:
    weather = weather_result.get("weather") or {}
    safe_to_spray = bool(weather_result.get("safe_to_spray"))
    next_clear_window = str(weather_result.get("next_clear_window") or "").strip() or "later"
    rain_expected_within_hours = weather.get("rain_expected_within_hours")
    wind_speed_kmh = weather.get("wind_speed_kmh")
    humidity_percent = weather.get("humidity_percent")

    parts = [f"{crop_type} spray advisory: "]
    if safe_to_spray:
        parts.append("Safe to spray now.")
    else:
        parts.append(f"Delay spraying; next clear window looks to be {next_clear_window}.")

    if rain_expected_within_hours is not None:
        parts.append(f"Rain may arrive in about {rain_expected_within_hours} hour(s).")

    if wind_speed_kmh is not None:
        parts.append(f"Wind is around {float(wind_speed_kmh):.0f} km/h.")

    if humidity_percent is not None:
        parts.append(f"Humidity is around {float(humidity_percent):.0f}%.")

    return " ".join(parts).strip()


async def compute_meteorologist_advisory(input_data: MeteorologistInput) -> str:
    """Generate a cached spray advisory for the given location."""
    cache_key = _cache_key(input_data.lat, input_data.lng, input_data.crop_type)
    cached_entry = _get_cached_advisory(cache_key)
    if cached_entry is not None:
        _update_context(input_data.context, cached_entry.weather_result, cached_entry.advisory)
        return cached_entry.advisory

    from tools.weather_tool import fetch_weather, WeatherInput

    try:
        weather_result = await fetch_weather(
            WeatherInput(
                lat=input_data.lat,
                lng=input_data.lng,
            )
        )
    except Exception as exc:
        logger.warning("Weather fetch failed for meteorologist advisory: %s", exc)
        fallback_weather_result = {
            "weather": {},
            "safe_to_spray": False,
            "next_clear_window": "later",
        }
        response = _build_fallback_advisory(fallback_weather_result, input_data.crop_type)
        _store_cached_advisory(cache_key, fallback_weather_result, response)
        _update_context(input_data.context, fallback_weather_result, response)
        return response

    _update_context(input_data.context, weather_result, "")

    prompt = f"""You are PadiGuard's Meteorologist Agent. Analyze the following weather data
for a {input_data.crop_type} farm at coordinates ({input_data.lat}, {input_data.lng}).

Weather Data:
{weather_result}

Provide a clear, actionable advisory for the farmer including:
1. Current conditions summary
2. Whether it is SAFE or UNSAFE to spray chemicals right now
3. If unsafe, when the next clear window is
4. Any wind-related spraying precautions
5. If rain is expected within 4 hours, issue a "DELAY" advisory

Keep the response concise and farmer-friendly. Use emojis for readability."""

    try:
        response = await llm_generate(prompt)
    except Exception as exc:
        logger.warning("Meteorologist advisory generation failed, using fallback advisory: %s", exc)
        response = _build_fallback_advisory(weather_result, input_data.crop_type)

    _store_cached_advisory(cache_key, weather_result, response)
    _update_context(input_data.context, weather_result, response)

    return response


def register_meteorologist_agent(ai: Genkit):
    """Register the meteorologist flow with Genkit."""

    @ai.flow("meteorologist_flow")
    async def meteorologist_flow(input_data: Any) -> str:
        meteorologist_input = (
            input_data
            if isinstance(input_data, MeteorologistInput)
            else MeteorologistInput.model_validate(input_data)
        )
        return await compute_meteorologist_advisory(meteorologist_input)

    return meteorologist_flow
