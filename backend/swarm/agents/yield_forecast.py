"""Agent 5: Yield Forecast Agent — deterministic yield planning."""

from __future__ import annotations

from typing import Any

from genkit.ai import Genkit
from pydantic import BaseModel

from schemas.context import AgentContext, YieldForecastResult
from tools.roi_tool import DEFAULT_YIELD, YIELD_ESTIMATES


class YieldForecastInput(BaseModel):
    user_id: str
    crop_type: str
    farm_size_hectares: float
    treatment_plan: str
    severity_score: float
    growth_stage: str | None = None
    grid_id: str | None = None
    context: AgentContext | None = None


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip().lower()


def _get_base_yield_per_hectare(crop_type: str) -> float:
    return float(YIELD_ESTIMATES.get(crop_type, DEFAULT_YIELD))


def _growth_stage_factor(growth_stage: str | None) -> float:
    stage = _normalize_text(growth_stage)
    if stage in {"vegetative", "tillering"}:
        return 0.96
    if stage in {"reproductive", "booting", "flowering"}:
        return 1.0
    if stage in {"maturity", "harvest", "ripening"}:
        return 0.9
    return 0.98


def _weather_factor(context: AgentContext | None) -> float:
    weather = context.weather if context is not None else None
    factor = 1.0

    if weather is None:
        return factor

    humidity = weather.humidity_percent
    if humidity is not None:
        if humidity >= 90:
            factor *= 0.9
        elif humidity >= 80:
            factor *= 0.94
        elif humidity >= 60:
            factor *= 1.02

    precipitation = weather.precipitation_probability
    if precipitation is not None:
        if precipitation >= 70:
            factor *= 0.9
        elif precipitation >= 40:
            factor *= 0.96

    temperature = weather.temperature_c
    if temperature is not None:
        if temperature < 22 or temperature > 35:
            factor *= 0.93
        elif 26 <= temperature <= 32:
            factor *= 1.03

    wind_speed = weather.wind_speed_kmh
    if wind_speed is not None:
        if wind_speed >= 25:
            factor *= 0.95
        elif wind_speed <= 12:
            factor *= 1.01

    return _clamp(factor, 0.75, 1.08)


def _treatment_factor(context: AgentContext | None, treatment_plan: str | None) -> float:
    inventory = context.inventory if context is not None else None
    factor = 1.0

    if inventory is not None:
        if inventory.low_stock is True and inventory.sufficient_for_treatment is False:
            factor *= 0.86
        elif inventory.low_stock is True:
            factor *= 0.92
        elif inventory.sufficient_for_treatment is False:
            factor *= 0.9

    if not _normalize_text(treatment_plan):
        factor *= 0.95

    return _clamp(factor, 0.7, 1.0)


def _risk_factor(context: AgentContext | None, treatment_plan: str | None) -> str:
    disease = _normalize_text(context.scan.disease if context is not None else None)
    if not disease:
        disease = _normalize_text(treatment_plan)

    if any(keyword in disease for keyword in ("blast", "blight", "fungal", "fungus", "smut")):
        return "fungal infection"
    if any(keyword in disease for keyword in ("bacterial", "rot", "wilt")):
        return "bacterial stress"
    if any(keyword in disease for keyword in ("pest", "insect", "borer", "hopper")):
        return "pest pressure"

    weather = context.weather if context is not None else None
    if weather is not None and weather.precipitation_probability is not None and weather.precipitation_probability >= 70:
        return "wet weather pressure"
    if weather is not None and weather.humidity_percent is not None and weather.humidity_percent >= 85:
        return "humid conditions"

    return "crop stress"


def compute_yield_forecast(input_data: YieldForecastInput) -> YieldForecastResult:
    context = input_data.context
    if context is None:
        context = AgentContext(
            zone_id=input_data.grid_id,
            crop_type=input_data.crop_type,
            growth_stage=input_data.growth_stage,
        )

    base_yield_per_hectare = _get_base_yield_per_hectare(input_data.crop_type)
    baseline_total_yield = base_yield_per_hectare * float(input_data.farm_size_hectares)

    severity = _clamp(float(input_data.severity_score), 0.0, 1.0)
    health_factor = _clamp(1.0 - (severity * 0.55), 0.35, 1.0)
    weather_factor = _weather_factor(context)
    treatment_factor = _treatment_factor(context, input_data.treatment_plan)
    stage_factor = _growth_stage_factor(input_data.growth_stage or context.growth_stage)

    predicted_yield_kg = baseline_total_yield * health_factor * weather_factor * treatment_factor * stage_factor
    predicted_yield_kg = max(0.0, round(predicted_yield_kg, 2))

    yield_loss_percent = 0.0
    if baseline_total_yield > 0:
        yield_loss_percent = _clamp((1.0 - (predicted_yield_kg / baseline_total_yield)) * 100.0, 0.0, 100.0)

    confidence = 0.55
    confidence += 0.1 if context.weather.humidity_percent is not None else 0.0
    confidence += 0.1 if context.weather.precipitation_probability is not None else 0.0
    confidence += 0.1 if context.scan.confidence is not None else 0.0
    confidence += 0.08 if context.inventory.sufficient_for_treatment is not None else 0.0
    confidence += 0.07 if input_data.growth_stage else 0.0
    confidence = _clamp(confidence, 0.45, 0.95)

    if confidence < 0.7:
        spread = max(predicted_yield_kg * 0.15, 1.0)
        predicted_yield_range_kg = [round(max(0.0, predicted_yield_kg - spread), 2), round(predicted_yield_kg + spread, 2)]
    else:
        predicted_yield_range_kg = None

    forecast = YieldForecastResult(
        base_yield_per_hectare_kg=round(base_yield_per_hectare, 2),
        predicted_yield_kg=predicted_yield_kg,
        yield_loss_percent=round(yield_loss_percent, 2),
        confidence=round(confidence, 2),
        risk_factor=_risk_factor(context, input_data.treatment_plan),
        predicted_yield_range_kg=predicted_yield_range_kg,
    )

    return forecast


def register_yield_forecast_agent(ai: Genkit):
    """Register the yield forecast flow with Genkit."""

    @ai.flow("yield_forecast_flow")
    async def yield_forecast_flow(input_data: Any) -> dict:
        yield_input = (
            input_data
            if isinstance(input_data, YieldForecastInput)
            else YieldForecastInput.model_validate(input_data)
        )
        forecast = compute_yield_forecast(yield_input)

        if yield_input.context is not None:
            yield_input.context.zone_id = yield_input.context.zone_id or yield_input.grid_id
            yield_input.context.crop_type = yield_input.context.crop_type or yield_input.crop_type
            yield_input.context.growth_stage = yield_input.context.growth_stage or yield_input.growth_stage
            yield_input.context.yield_forecast = forecast
            yield_input.context.economy.predicted_yield_kg = forecast.predicted_yield_kg
            yield_input.context.economy.yield_loss_percent = forecast.yield_loss_percent
            yield_input.context.economy.yield_confidence = forecast.confidence

        return forecast.model_dump()

    return yield_forecast_flow