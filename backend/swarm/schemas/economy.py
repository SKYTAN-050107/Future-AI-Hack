"""Schemas for the Economist Agent."""

from pydantic import BaseModel, Field


class MarketPrice(BaseModel):
    """Market price data from ManaMurah MCP."""

    crop_type: str
    retail_price_per_kg: float = Field(..., gt=0)
    currency: str = Field(default="MYR")
    source: str = Field(default="ManaMurah MCP")


class InventoryCost(BaseModel):
    """Treatment cost from user's Firestore inventory."""

    treatment_plan: str
    unit_cost: float = Field(..., ge=0)
    quantity_available: int = Field(..., ge=0)
    total_cost: float = Field(..., ge=0)


class ROIResult(BaseModel):
    """Return on Investment calculation result."""

    retail_price: float
    farm_gate_price: float = Field(
        ..., description="Retail price * 0.45 markdown"
    )
    estimated_yield_gain_kg: float
    survival_probability: float
    treatment_cost: float
    roi: float = Field(
        ..., description="((yieldGain * survProb * farmGatePrice) - cost) / cost"
    )
    profitable: bool
    explanation: str
    predicted_yield_kg: float | None = None
    yield_loss_percent: float | None = None
    yield_confidence: float | None = None
    yield_source: str | None = None
