"""Schemas for the Spatial Propagation Agent."""

from pydantic import BaseModel, Field


class EpidemiologistInput(BaseModel):
    """Input for the spatial propagation agent."""

    lat: float = Field(..., description="Latitude of the infected grid")
    lng: float = Field(..., description="Longitude of the infected grid")
    crop_type: str = Field(..., description="e.g., 'Rice', 'Oil Palm'")
    disease: str = Field(..., description="e.g., 'Rice Blast', 'Ganoderma'")
    severity_score: float = Field(
        ..., ge=0.0, le=1.0, description="Severity from 0.0 to 1.0"
    )
    wind_speed_kmh: float = Field(..., ge=0.0, description="Wind speed in km/h")
    wind_direction: str = Field(
        ..., description="Compass direction e.g., 'NE', 'SW'"
    )


class PredictedBufferZone(BaseModel):
    """Output: mathematical parameters for Turf.js polygon rendering."""

    base_radius_meters: int = Field(
        ..., gt=0, description="Base buffer radius in meters"
    )
    wind_direction_degrees: int = Field(
        ..., ge=0, le=360, description="Wind direction in degrees (0-360)"
    )
    wind_stretch_factor: float = Field(
        ..., ge=1.0, description="Elongation factor in wind direction"
    )
    spread_rate_meters_per_day: float = Field(
        ..., gt=0, description="Estimated daily spread rate"
    )
    advisory_message: str = Field(
        ..., description="Human-readable advisory for the farmer"
    )
