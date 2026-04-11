"""Schemas for the Meteorologist Agent."""

from pydantic import BaseModel, Field
from typing import Optional


class WeatherData(BaseModel):
    """Raw weather data from Tomorrow.io."""

    temperature_c: float
    humidity_percent: float
    wind_speed_kmh: float
    wind_direction_degrees: int
    precipitation_probability: float
    rain_expected_within_hours: Optional[float] = Field(
        None, description="Hours until rain, None if no rain expected"
    )


class SprayAdvisory(BaseModel):
    """Spray safety advisory from the Meteorologist."""

    safe_to_spray: bool = Field(
        ..., description="Whether it is safe to spray right now"
    )
    next_clear_window: Optional[str] = Field(
        None, description="Next clear window for spraying"
    )
    advisory: str = Field(..., description="Detailed weather advisory message")
