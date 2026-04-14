"""Tool: Fetch weather data from Tomorrow.io REST API."""

import httpx
from pydantic import BaseModel
from genkit.ai import Genkit
from schemas.weather import WeatherData
from config.settings import settings

class WeatherInput(BaseModel):
    lat: float
    lng: float


async def fetch_weather(input_data: WeatherInput) -> dict:
    """
    Fetch current weather and precipitation forecast
    from Tomorrow.io for the given coordinates.
    Returns weather data including spray safety assessment.
    """
    params = {
        "location": f"{input_data.lat},{input_data.lng}",
        "apikey": settings.tomorrow_io_api_key,
        "units": "metric",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            settings.tomorrow_io_base_url, params=params
        )
        response.raise_for_status()
        data = response.json()

    # Parse the Tomorrow.io response into our schema
    timelines = data.get("timelines", {})
    hourly = timelines.get("hourly", [])

    # Current conditions from first hourly entry
    current = hourly[0]["values"] if hourly else {}

    # Check for rain in the next 4 hours
    rain_within_4hrs = False
    rain_hour = None
    for i, entry in enumerate(hourly[:4]):
        precip_prob = entry["values"].get("precipitationProbability", 0)
        if precip_prob > 50:
            rain_within_4hrs = True
            rain_hour = i + 1
            break

    weather_data = WeatherData(
        temperature_c=current.get("temperature", 0),
        humidity_percent=current.get("humidity", 0),
        wind_speed_kmh=current.get("windSpeed", 0) * 3.6,  # m/s -> km/h
        wind_direction_degrees=int(current.get("windDirection", 0)),
        precipitation_probability=current.get("precipitationProbability", 0),
        rain_expected_within_hours=rain_hour if rain_within_4hrs else None,
    )

    return {
        "weather": weather_data.model_dump(),
        "safe_to_spray": not rain_within_4hrs,
        "next_clear_window": (
            f"After {rain_hour} hours" if rain_within_4hrs else "Now"
        ),
    }


def register_weather_tools(ai: Genkit):
    """Register weather-related tools with the Genkit instance."""
    # Register the tool for Genkit UI / LLM ai.generate(tools=[...]) usage
    ai.tool("fetch_weather")(fetch_weather)
