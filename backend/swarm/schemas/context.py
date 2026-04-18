"""Shared agent context for the swarm orchestrator."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _wind_direction_to_degrees(direction: str | None) -> int | None:
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
    if not text:
        return None

    if text in mapping:
        return mapping[text]

    try:
        return int(round(float(text))) % 360
    except (TypeError, ValueError):
        return None


class ScanContext(BaseModel):
    disease: str | None = None
    severity: float | None = None
    severity_label: str | None = None
    confidence: float | None = None
    crop_type: str | None = None
    grid_id: str | None = None
    treatment_plan: str | None = None


class WeatherContext(BaseModel):
    temperature_c: float | None = None
    humidity_percent: float | None = None
    wind_speed_kmh: float | None = None
    wind_direction: str | None = None
    wind_direction_degrees: int | None = None
    precipitation_probability: float | None = None
    rainfall_mm: float | None = None
    rain_expected_within_hours: float | None = None
    safe_to_spray: bool | None = None
    next_clear_window: str | None = None
    advisory: str | None = None


class InventoryContext(BaseModel):
    treatment_plan: str | None = None
    quantity_in_stock: int | None = None
    low_stock: bool | None = None
    sufficient_for_treatment: bool | None = None
    alert_sent: bool | None = None
    alert_message: str | None = None
    summary: str | None = None
    items: list[dict[str, Any]] = Field(default_factory=list)


class EconomyContext(BaseModel):
    market_price_per_kg: float | None = None
    farm_gate_price_per_kg: float | None = None
    treatment_cost_rm: float | None = None
    farm_size_hectares: float | None = None
    survival_probability: float | None = None
    roi: float | None = None
    profitable: bool | None = None
    predicted_yield_kg: float | None = None
    yield_loss_percent: float | None = None
    yield_confidence: float | None = None
    summary: str | None = None


class SpatialContext(BaseModel):
    base_radius_meters: int | None = None
    predicted_spread_radius_km: float | None = None
    at_risk_zones: list[str] = Field(default_factory=list)
    risk_level: str | None = None
    grid_density: float | None = None
    wind_stretch_factor: float | None = None
    spread_rate_meters_per_day: float | None = None
    advisory_message: str | None = None
    disease_profile: str | None = None
    severity_factor: float | None = None
    humidity_factor: float | None = None
    wind_factor: float | None = None
    grid_density_factor: float | None = None


class YieldForecastResult(BaseModel):
    base_yield_per_hectare_kg: float
    predicted_yield_kg: float
    yield_loss_percent: float
    confidence: float
    risk_factor: str
    predicted_yield_range_kg: list[float] | None = None


class AgentContext(BaseModel):
    zone_id: str | None = None
    crop_type: str | None = None
    growth_stage: str | None = None
    scan: ScanContext = Field(default_factory=ScanContext)
    weather: WeatherContext = Field(default_factory=WeatherContext)
    inventory: InventoryContext = Field(default_factory=InventoryContext)
    economy: EconomyContext = Field(default_factory=EconomyContext)
    spatial: SpatialContext = Field(default_factory=SpatialContext)
    yield_forecast: YieldForecastResult | None = None

    @classmethod
    def from_swarm_input(cls, input_data: Any) -> "AgentContext":
        crop_type = str(getattr(input_data, "crop_type", "") or "").strip() or None
        zone_id = str(getattr(input_data, "grid_id", "") or "").strip() or None
        growth_stage = str(getattr(input_data, "growth_stage", "") or "").strip() or None
        severity_label = str(getattr(input_data, "severity", "") or "").strip() or None

        severity_score = _as_float(getattr(input_data, "severity_score", None))
        survival_prob = _as_float(getattr(input_data, "survival_prob", None))
        farm_size = _as_float(getattr(input_data, "farm_size", None))
        confidence = _as_float(getattr(input_data, "confidence", None))
        wind_speed_kmh = _as_float(getattr(input_data, "wind_speed_kmh", None))
        wind_direction = str(getattr(input_data, "wind_direction", "") or "").strip() or None

        return cls(
            zone_id=zone_id,
            crop_type=crop_type,
            growth_stage=growth_stage,
            scan=ScanContext(
                disease=str(getattr(input_data, "disease", "") or "").strip() or None,
                severity=severity_score,
                severity_label=severity_label,
                confidence=confidence,
                crop_type=crop_type,
                grid_id=zone_id,
                treatment_plan=str(getattr(input_data, "treatment_plan", "") or "").strip() or None,
            ),
            weather=WeatherContext(
                wind_speed_kmh=wind_speed_kmh,
                wind_direction=wind_direction,
                wind_direction_degrees=_wind_direction_to_degrees(wind_direction),
            ),
            inventory=InventoryContext(
                treatment_plan=str(getattr(input_data, "treatment_plan", "") or "").strip() or None,
            ),
            economy=EconomyContext(
                farm_size_hectares=_as_float(getattr(input_data, "farm_size", None)),
                survival_probability=survival_prob,
                farm_gate_price_per_kg=None,
                predicted_yield_kg=None,
                yield_loss_percent=None,
                yield_confidence=None,
            ),
            spatial=SpatialContext(
                grid_density=_as_float(getattr(input_data, "grid_density", None)),
                grid_density_factor=_as_float(getattr(input_data, "grid_density", None)),
            ),
        )


YieldForecastResult.model_rebuild()
AgentContext.model_rebuild()