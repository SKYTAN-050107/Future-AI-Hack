"""Schemas for the Resource Manager Agent."""

from pydantic import BaseModel, Field
from typing import Optional


class InventoryStatus(BaseModel):
    """Current inventory status from Firestore."""

    treatment_plan: str
    quantity_in_stock: int = Field(..., ge=0)
    low_stock: bool = Field(
        ..., description="True if quantity < 5"
    )
    sufficient_for_treatment: bool


class StockAlert(BaseModel):
    """FCM alert payload for low stock."""

    user_id: str
    treatment_plan: str
    current_stock: int
    alert_sent: bool
    message: Optional[str] = None
