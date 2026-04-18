"""Schemas for the Spatial Propagation Agent."""

from pydantic import BaseModel, Field

from schemas.context import AgentContext


class EpidemiologistInput(BaseModel):
    """Input for the spatial propagation agent."""

    lat: float = Field(..., description="Latitude of the infected grid")
    lng: float = Field(..., description="Longitude of the infected grid")
    grid_id: str | None = Field(default=None, description="Grid document identifier")
    crop_type: str = Field(..., description="e.g., 'Rice', 'Oil Palm'")
    disease: str = Field(..., description="e.g., 'Rice Blast', 'Ganoderma'")
    severity_score: float = Field(
        ..., ge=0.0, le=1.0, description="Severity from 0.0 to 1.0"
    )
    wind_speed_kmh: float = Field(..., ge=0.0, description="Wind speed in km/h")
    wind_direction: str = Field(
        ..., description="Compass direction e.g., 'NE', 'SW'"
    )
    humidity_percent: float | None = Field(default=None, ge=0.0, le=100.0)
    grid_density: float | None = Field(default=None, ge=0.0, le=10.0)
    context: AgentContext | None = None


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
    predicted_spread_radius_km: float | None = Field(
        default=None, gt=0, description="Estimated spread radius in kilometers"
    )
    at_risk_zones: list[str] = Field(default_factory=list)
    risk_level: str | None = Field(default=None, description="low | medium | high")
    disease_profile: str | None = None
    severity_factor: float | None = None
    humidity_factor: float | None = None
    wind_factor: float | None = None
    grid_density_factor: float | None = None
