"""Schemas for the Yield Forecast Agent."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from schemas.context import AgentContext


class YieldForecastInput(BaseModel):
    user_id: str
    crop_type: str
    farm_size_hectares: float
    treatment_plan: str
    severity_score: float
    growth_stage: str | None = None
    grid_id: str | None = None
    context: AgentContext | None = None


class YieldForecastResult(BaseModel):
    base_yield_per_hectare_kg: float
    predicted_yield_kg: float
    yield_loss_percent: float
    confidence: float
    risk_factor: str
    predicted_yield_range_kg: list[float] | None = None


def build_yield_context(result: YieldForecastResult) -> dict[str, Any]:
    return result.model_dump()


YieldForecastInput.model_rebuild()
YieldForecastResult.model_rebuild()