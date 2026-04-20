"""Agent 4: The Universal Spatial Propagation Agent — Buffer Zone Parameters."""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel
from genkit.ai import Genkit
from schemas.context import AgentContext, SpatialContext
from schemas.spatial import PredictedBufferZone


class SpatialInput(BaseModel):
    lat: float
    lng: float
    grid_id: str | None = None
    crop_type: str
    disease: str
    severity_score: float
    wind_speed_kmh: float
    wind_direction: str
    humidity_percent: float | None = None
    grid_density: float | None = None
    context: AgentContext | None = None


SpatialInput.model_rebuild()


_DISEASE_PROFILES = {
    "blast": {"base_radius": 120, "spread_rate": 18.0, "spread_type": "airborne"},
    "rice blast": {"base_radius": 120, "spread_rate": 18.0, "spread_type": "airborne"},
    "blight": {"base_radius": 95, "spread_rate": 14.0, "spread_type": "airborne"},
    "smut": {"base_radius": 105, "spread_rate": 15.0, "spread_type": "airborne"},
    "wilt": {"base_radius": 85, "spread_rate": 11.0, "spread_type": "soil"},
    "rot": {"base_radius": 80, "spread_rate": 10.0, "spread_type": "soil"},
    "bacterial": {"base_radius": 90, "spread_rate": 12.0, "spread_type": "water"},
    "pest": {"base_radius": 70, "spread_rate": 9.0, "spread_type": "insect"},
}


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _wind_direction_to_degrees(direction: str | None) -> int:
    mapping = {
        "N": 0,
        "NNE": 22,
        "NE": 45,
        "ENE": 67,
        "E": 90,
        "ESE": 112,
        "SE": 135,
        "SSE": 157,
        "S": 180,
        "SSW": 202,
        "SW": 225,
        "WSW": 247,
        "W": 270,
        "WNW": 292,
        "NW": 315,
        "NNW": 337,
    }

    text = str(direction or "").strip().upper()
    if text in mapping:
        return mapping[text]

    try:
        return int(round(float(text))) % 360
    except (TypeError, ValueError):
        return 0


def _normalize_disease_profile(disease: str) -> dict[str, object]:
    disease_text = str(disease or "").strip().lower()
    for keyword, profile in _DISEASE_PROFILES.items():
        if keyword in disease_text:
            return profile

    return {"base_radius": 75, "spread_rate": 9.5, "spread_type": "generic"}


def _weather_factor(spread_type: str, humidity_percent: float | None, wind_speed_kmh: float) -> tuple[float, float]:
    humidity_factor = 1.0
    if humidity_percent is not None:
        if humidity_percent >= 90:
            humidity_factor = 1.22 if spread_type == "airborne" else 1.1
        elif humidity_percent >= 80:
            humidity_factor = 1.14 if spread_type == "airborne" else 1.05
        elif humidity_percent >= 65:
            humidity_factor = 1.05
        else:
            humidity_factor = 0.96

    if spread_type == "airborne":
        wind_factor = 1.0 + _clamp(wind_speed_kmh / 28.0, 0.0, 1.25)
    elif spread_type == "insect":
        wind_factor = 1.0 + _clamp(wind_speed_kmh / 45.0, 0.0, 0.85)
    elif spread_type in {"water", "soil"}:
        wind_factor = 1.0 + _clamp(wind_speed_kmh / 90.0, 0.0, 0.25)
    else:
        wind_factor = 1.0 + _clamp(wind_speed_kmh / 60.0, 0.0, 0.45)

    return humidity_factor, wind_factor


def _grid_density_factor(grid_density: float | None) -> float:
    if grid_density is None:
        return 1.0

    return _clamp(1.0 + (grid_density / 15.0), 1.0, 1.35)


def _risk_level(severity_score: float, spread_rate_meters_per_day: float, humidity_factor: float, wind_factor: float) -> str:
    risk_index = (severity_score * 100.0 * humidity_factor * wind_factor) + spread_rate_meters_per_day / 4.0
    if risk_index >= 120:
        return "high"
    if risk_index >= 70:
        return "medium"
    return "low"


def _neighboring_zones(grid_id: str | None, radius_km: float) -> list[str]:
    if not grid_id:
        return []

    match = re.search(r"^(.*?)(\d+)$", str(grid_id).strip())
    if not match:
        return []

    prefix, number_text = match.groups()
    try:
        number = int(number_text)
    except ValueError:
        return []

    offset = max(1, int(round(radius_km)))
    neighbors = []
    if number - offset > 0:
        neighbors.append(f"{prefix}{number - offset}")
    neighbors.append(f"{prefix}{number + offset}")
    return neighbors


def compute_spatial_propagation(input_data: SpatialInput) -> PredictedBufferZone:
    context = input_data.context
    if context is None:
        context = AgentContext.from_swarm_input(
            type("_SwarmInputProxy", (), {
                "grid_id": input_data.grid_id,
                "crop_type": input_data.crop_type,
                "growth_stage": None,
                "severity": None,
                "severity_score": input_data.severity_score,
                "confidence": None,
                "treatment_plan": None,
                "wind_speed_kmh": input_data.wind_speed_kmh,
                "wind_direction": input_data.wind_direction,
                "grid_density": input_data.grid_density,
                "disease": input_data.disease,
                "farm_size": None,
                "survival_prob": None,
            })()
        )

    disease_profile = _normalize_disease_profile(input_data.disease)
    base_radius = int(disease_profile["base_radius"])
    base_spread_rate = float(disease_profile["spread_rate"])
    spread_type = str(disease_profile["spread_type"])

    severity_score = _clamp(float(input_data.severity_score), 0.0, 1.0)
    humidity_source = input_data.humidity_percent
    if humidity_source is None and context.weather.humidity_percent is not None:
        humidity_source = context.weather.humidity_percent

    humidity_factor, wind_factor = _weather_factor(spread_type, humidity_source, float(input_data.wind_speed_kmh))
    grid_density_factor = _grid_density_factor(input_data.grid_density if input_data.grid_density is not None else context.spatial.grid_density_factor)
    severity_factor = _clamp(0.8 + severity_score * 0.9, 0.8, 1.75)

    spread_rate = base_spread_rate * severity_factor * humidity_factor * wind_factor * grid_density_factor
    spread_rate = max(1.0, round(spread_rate, 2))

    wind_stretch_factor = max(1.0, round(wind_factor * (1.0 + severity_score * 0.35), 2))
    predicted_radius_km = max(0.1, round((base_radius * severity_factor * humidity_factor * grid_density_factor) / 1000.0, 2))
    risk_level = _risk_level(severity_score, spread_rate, humidity_factor, wind_factor)
    at_risk_zones = _neighboring_zones(input_data.grid_id or context.zone_id, predicted_radius_km)
    advisory_message = (
        f"{input_data.disease} is likely to spread {risk_level} risk. "
        f"Keep a buffer of about {predicted_radius_km:.2f} km and inspect nearby zones first. "
        f"Wind direction is {input_data.wind_direction} ({_wind_direction_to_degrees(input_data.wind_direction)}°)."
    )

    result = PredictedBufferZone(
        base_radius_meters=base_radius,
        wind_direction_degrees=_wind_direction_to_degrees(input_data.wind_direction),
        wind_stretch_factor=wind_stretch_factor,
        spread_rate_meters_per_day=spread_rate,
        advisory_message=advisory_message,
        predicted_spread_radius_km=predicted_radius_km,
        at_risk_zones=at_risk_zones,
        risk_level=risk_level,
        disease_profile=str(disease_profile["spread_type"]),
        severity_factor=round(severity_factor, 2),
        humidity_factor=round(humidity_factor, 2),
        wind_factor=round(wind_factor, 2),
        grid_density_factor=round(grid_density_factor, 2),
    )

    if input_data.context is not None:
        input_data.context.spatial = SpatialContext(
            base_radius_meters=result.base_radius_meters,
            predicted_spread_radius_km=result.predicted_spread_radius_km,
            at_risk_zones=list(result.at_risk_zones),
            risk_level=result.risk_level,
            wind_stretch_factor=result.wind_stretch_factor,
            spread_rate_meters_per_day=result.spread_rate_meters_per_day,
            advisory_message=result.advisory_message,
            disease_profile=result.disease_profile,
            severity_factor=result.severity_factor,
            humidity_factor=result.humidity_factor,
            wind_factor=result.wind_factor,
            grid_density_factor=result.grid_density_factor,
        )

    return result


def register_spatial_agent(ai: Genkit):
    """Register the spatial propagation flow with Genkit."""

    @ai.flow("dynamic_spatial_propagation_flow")
    async def dynamic_spatial_propagation_flow(input_data: Any) -> dict:
        spatial_input = (
            input_data
            if isinstance(input_data, SpatialInput)
            else SpatialInput.model_validate(input_data)
        )
        buffer_zone = compute_spatial_propagation(spatial_input)
        return buffer_zone.model_dump()

    return dynamic_spatial_propagation_flow
