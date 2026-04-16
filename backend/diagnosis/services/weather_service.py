"""Weather intelligence service powered by Tomorrow.io forecast API."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import logging

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

_WEATHER_CODE_TO_LABEL = {
    1000: "Clear",
    1001: "Cloudy",
    1100: "Mostly Clear",
    1101: "Partly Cloudy",
    1102: "Mostly Cloudy",
    2000: "Fog",
    2100: "Light Fog",
    4000: "Drizzle",
    4001: "Rain",
    4200: "Light Rain",
    4201: "Heavy Rain",
    5000: "Snow",
    5100: "Light Snow",
    5101: "Heavy Snow",
    8000: "Thunderstorm",
}


@dataclass(slots=True)
class WeatherSnapshot:
    condition: str
    temperature_c: int
    wind_kmh: int
    wind_direction: str
    rain_in_hours: float | None
    safe_to_spray: bool
    rain_probability: int
    best_spray_window: str
    advisory: str


class WeatherService:
    """Fetch and normalize weather intelligence for frontend contracts."""

    def __init__(self) -> None:
        settings = get_settings()
        self._api_key = str(settings.TOMORROW_IO_API_KEY or "").strip()
        self._base_url = str(settings.TOMORROW_IO_BASE_URL or "").strip()

    async def get_outlook(self, lat: float, lng: float, days: int = 7) -> dict:
        if not self._api_key:
            raise RuntimeError("TOMORROW_IO_API_KEY is missing")
        if not self._base_url:
            raise RuntimeError("TOMORROW_IO_BASE_URL is missing")

        payload = await self._fetch_weather_payload(lat=lat, lng=lng)
        timelines = payload.get("timelines") or {}
        hourly = timelines.get("hourly") or []
        daily = timelines.get("daily") or []

        if not hourly:
            raise RuntimeError("Tomorrow.io returned no hourly timeline data")

        snapshot = self._build_snapshot(hourly=hourly)
        forecast = self._build_forecast(daily=daily, hourly=hourly, days=days)

        return {
            "rain_probability": snapshot.rain_probability,
            "best_spray_window": snapshot.best_spray_window,
            "advisory": snapshot.advisory,
            "condition": snapshot.condition,
            "temperatureC": snapshot.temperature_c,
            "windKmh": snapshot.wind_kmh,
            "windDirection": snapshot.wind_direction,
            "rainInHours": snapshot.rain_in_hours,
            "safeToSpray": snapshot.safe_to_spray,
            "forecast": forecast,
        }

    async def _fetch_weather_payload(self, lat: float, lng: float) -> dict:
        params = {
            "location": f"{lat},{lng}",
            "apikey": self._api_key,
            "units": "metric",
            "timesteps": "1h,1d",
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(self._base_url, params=params)
            response.raise_for_status()
            return response.json()

    def _build_snapshot(self, hourly: list[dict]) -> WeatherSnapshot:
        current = (hourly[0] or {}).get("values") or {}
        current_prob = int(round(float(current.get("precipitationProbability", 0.0))))
        wind_kmh = int(round(float(current.get("windSpeed", 0.0)) * 3.6))
        rain_in_hours = self._rain_expected_within_hours(hourly)
        condition = self._weather_code_to_label(current.get("weatherCode"))
        wind_direction = self._degrees_to_compass(int(round(float(current.get("windDirection", 0.0)))))

        spray_slot = self._best_spray_window(hourly)
        safe_to_spray = rain_in_hours is None and current_prob < 45 and wind_kmh < 18
        advisory = self._build_advisory(safe_to_spray=safe_to_spray, rain_in_hours=rain_in_hours, wind_kmh=wind_kmh)

        return WeatherSnapshot(
            condition=condition,
            temperature_c=int(round(float(current.get("temperature", 0.0)))),
            wind_kmh=wind_kmh,
            wind_direction=wind_direction,
            rain_in_hours=rain_in_hours,
            safe_to_spray=safe_to_spray,
            rain_probability=max(0, min(100, current_prob)),
            best_spray_window=spray_slot,
            advisory=advisory,
        )

    def _build_forecast(self, daily: list[dict], hourly: list[dict], days: int) -> list[dict]:
        target_days = max(1, min(days, 10))
        results: list[dict] = []

        for index, entry in enumerate(daily[:target_days]):
            values = (entry or {}).get("values") or {}
            start_time = str((entry or {}).get("time") or "")
            label = self._day_label(start_time=start_time, index=index)

            rain_chance = int(round(float(
                values.get("precipitationProbabilityAvg")
                or values.get("precipitationProbability")
                or 0.0
            )))
            wind_speed = float(values.get("windSpeedAvg") or values.get("windSpeed") or 0.0) * 3.6
            wind_dir = int(round(float(values.get("windDirectionAvg") or values.get("windDirection") or 0.0)))
            condition = self._weather_code_to_label(
                values.get("weatherCodeMax")
                or values.get("weatherCode")
            )
            safe = rain_chance < 55 and wind_speed < 20

            spray_window = self._spray_window_for_day(
                safe=safe,
                day_iso=start_time,
                hourly=hourly,
            )

            # Temperature high/low from daily values
            temp_high = self._safe_int(values.get("temperatureMax") or values.get("temperatureApparentMax"))
            temp_low = self._safe_int(values.get("temperatureMin") or values.get("temperatureApparentMin"))

            # Extract hourly entries for this day
            hourly_detail = self._hourly_for_day(day_iso=start_time, hourly=hourly)

            results.append(
                {
                    "day": label,
                    "condition": condition,
                    "rainChance": max(0, min(100, rain_chance)),
                    "wind": f"{int(round(wind_speed))} km/h {self._degrees_to_compass(wind_dir)}",
                    "sprayWindow": spray_window,
                    "safe": safe,
                    "temperature_high": temp_high,
                    "temperature_low": temp_low,
                    "hourly": hourly_detail,
                }
            )

        return results

    def _hourly_for_day(self, day_iso: str, hourly: list[dict]) -> list[dict]:
        """Extract hourly weather entries that belong to the given day."""
        target_date = self._parse_iso_datetime(day_iso)
        if target_date is None:
            return []

        entries: list[dict] = []
        for entry in hourly:
            stamp = self._parse_iso_datetime(str((entry or {}).get("time") or ""))
            if stamp is None or stamp.date() != target_date.date():
                continue
            values = (entry or {}).get("values") or {}
            prob = int(round(float(values.get("precipitationProbability", 0.0))))
            wind_kmh = int(round(float(values.get("windSpeed", 0.0)) * 3.6))
            condition = self._weather_code_to_label(values.get("weatherCode"))
            safe = prob < 35 and wind_kmh < 18

            entries.append({
                "time": stamp.strftime("%I:%M %p").lstrip("0"),
                "temperature_c": int(round(float(values.get("temperature", 0.0)))),
                "rain_chance": max(0, min(100, prob)),
                "wind_kmh": wind_kmh,
                "condition": condition,
                "safe_to_spray": safe,
            })

        return entries

    @staticmethod
    def _safe_int(value: object) -> int | None:
        """Convert a value to int, returning None on failure."""
        if value is None:
            return None
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _rain_expected_within_hours(hourly: list[dict]) -> float | None:
        for index, entry in enumerate(hourly[:12]):
            values = (entry or {}).get("values") or {}
            probability = float(values.get("precipitationProbability", 0.0))
            if probability >= 50.0:
                return float(index + 1)
        return None

    def _best_spray_window(self, hourly: list[dict]) -> str:
        for entry in hourly[:24]:
            values = (entry or {}).get("values") or {}
            probability = float(values.get("precipitationProbability", 0.0))
            wind_kmh = float(values.get("windSpeed", 0.0)) * 3.6
            if probability < 35.0 and wind_kmh < 18.0:
                dt = self._parse_iso_datetime(str(entry.get("time") or ""))
                if dt is None:
                    continue
                start = dt.strftime("%I:%M %p").lstrip("0")
                end = dt.replace(minute=0, second=0, microsecond=0)
                end = end.replace(hour=(end.hour + 2) % 24)
                end_label = end.strftime("%I:%M %p").lstrip("0")
                return f"{self._day_label_from_datetime(dt)} {start} - {end_label}"
        return "Delay spraying"

    def _spray_window_for_day(self, safe: bool, day_iso: str, hourly: list[dict]) -> str:
        if not safe:
            return "Delay spraying"

        target_date = self._parse_iso_datetime(day_iso)
        if target_date is None:
            return "After 3:00 PM"

        for entry in hourly:
            stamp = self._parse_iso_datetime(str((entry or {}).get("time") or ""))
            if stamp is None or stamp.date() != target_date.date():
                continue
            values = (entry or {}).get("values") or {}
            probability = float(values.get("precipitationProbability", 0.0))
            wind_kmh = float(values.get("windSpeed", 0.0)) * 3.6
            if probability < 35.0 and wind_kmh < 18.0:
                return f"After {stamp.strftime('%I:%M %p').lstrip('0')}"

        return "After 3:00 PM"

    @staticmethod
    def _build_advisory(safe_to_spray: bool, rain_in_hours: float | None, wind_kmh: int) -> str:
        if safe_to_spray:
            return "Conditions are suitable for spraying now. Continue monitoring wind and rain shifts."
        if rain_in_hours is not None:
            return f"Rain is likely within {rain_in_hours:.0f} hour(s). Delay spraying to avoid wash-off losses."
        if wind_kmh >= 18:
            return "Winds are elevated. Delay spraying to reduce drift risk and improve treatment accuracy."
        return "Weather is unstable for spraying. Recheck conditions in the next cycle."

    @staticmethod
    def _weather_code_to_label(value: object) -> str:
        try:
            code = int(value)
        except (TypeError, ValueError):
            return "Unknown"
        return _WEATHER_CODE_TO_LABEL.get(code, "Unknown")

    @staticmethod
    def _day_label(start_time: str, index: int) -> str:
        parsed = WeatherService._parse_iso_datetime(start_time)
        if parsed is None:
            return "Today" if index == 0 else f"Day {index + 1}"
        if index == 0:
            return "Today"
        if index == 1:
            return "Tomorrow"
        return parsed.strftime("%A")

    @staticmethod
    def _day_label_from_datetime(value: datetime) -> str:
        now = datetime.now(value.tzinfo)
        delta_days = (value.date() - now.date()).days
        if delta_days <= 0:
            return "Today"
        if delta_days == 1:
            return "Tomorrow"
        return value.strftime("%A")

    @staticmethod
    def _degrees_to_compass(degrees: int) -> str:
        directions = [
            "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
        ]
        index = int((degrees / 22.5) + 0.5) % 16
        return directions[index]

    @staticmethod
    def _parse_iso_datetime(value: str) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("Failed to parse weather datetime: %s", value)
            return None
