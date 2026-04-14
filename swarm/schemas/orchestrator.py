"""Top-level schemas for the Swarm Orchestrator."""

from pydantic import BaseModel, Field
from typing import Optional
from schemas.spatial import PredictedBufferZone


class SwarmInput(BaseModel):
    """Master input contract from the upstream Diagnostic Engine."""

    user_id: str = Field(..., description="Firebase Auth UID")
    grid_id: str = Field(..., description="Firestore grid document ID")
    lat: float
    lng: float
    crop_type: str = Field(..., description="e.g., 'Rice', 'Oil Palm'")
    disease: str = Field(..., description="e.g., 'Rice Blast'")
    severity: str = Field(..., description="e.g., 'High', 'Medium', 'Low'")
    severity_score: float = Field(..., ge=0.0, le=1.0)
    survival_prob: float = Field(..., ge=0.0, le=1.0)
    farm_size: float = Field(..., gt=0, description="Farm size in hectares")
    treatment_plan: str = Field(
        ..., description="Recommended treatment chemical name"
    )
    wind_speed_kmh: float = Field(..., ge=0.0)
    wind_direction: str = Field(..., description="Compass direction e.g., 'NE'")


class SwarmOutput(BaseModel):
    """Master output: combined results from all four agents."""

    weather: str = Field(..., description="Meteorologist advisory text")
    economy: str = Field(..., description="Economist analysis text")
    resources: str = Field(..., description="Resource Manager summary text")
    spatial_risk: Optional[PredictedBufferZone] = Field(
        None, description="Predicted buffer zone parameters"
    )
