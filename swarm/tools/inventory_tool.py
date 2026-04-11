"""Tool: Firestore inventory queries."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.firebase_admin import get_firestore_client
from schemas.economy import InventoryCost
from schemas.resources import InventoryStatus

class InventoryInput(BaseModel):
    user_id: str
    treatment_plan: str


async def fetch_inventory_cost(input_data: InventoryInput) -> dict:
    """
    Query the user's Firestore inventory collection
    to get the actual cost of the treatment plan.
    """
    db = get_firestore_client()
    inventory_ref = (
        db.collection("users")
        .document(input_data.user_id)
        .collection("inventory")
        .where("name", "==", input_data.treatment_plan)
        .limit(1)
    )
    docs = inventory_ref.stream()

    for doc in docs:
        data = doc.to_dict()
        cost = InventoryCost(
            treatment_plan=input_data.treatment_plan,
            unit_cost=float(data.get("unitCost", 0)),
            quantity_available=int(data.get("quantity", 0)),
            total_cost=float(data.get("unitCost", 0))
            * int(data.get("quantity", 0)),
        )
        return cost.model_dump()

    # Not found — return zero-cost
    return InventoryCost(
        treatment_plan=input_data.treatment_plan,
        unit_cost=0.0,
        quantity_available=0,
        total_cost=0.0,
    ).model_dump()


async def manage_inventory(input_data: InventoryInput) -> dict:
    """
    Check Firestore stock levels for the treatment plan.
    Returns inventory status with low-stock flag.
    """
    db = get_firestore_client()
    inventory_ref = (
        db.collection("users")
        .document(input_data.user_id)
        .collection("inventory")
        .where("name", "==", input_data.treatment_plan)
        .limit(1)
    )
    docs = inventory_ref.stream()

    for doc in docs:
        data = doc.to_dict()
        qty = int(data.get("quantity", 0))
        return InventoryStatus(
            treatment_plan=input_data.treatment_plan,
            quantity_in_stock=qty,
            low_stock=qty < 5,
            sufficient_for_treatment=qty > 0,
        ).model_dump()

    return InventoryStatus(
        treatment_plan=input_data.treatment_plan,
        quantity_in_stock=0,
        low_stock=True,
        sufficient_for_treatment=False,
    ).model_dump()


def register_inventory_tools(ai: Genkit):
    """Register inventory-related tools with the Genkit instance."""
    ai.tool("fetch_inventory_cost")(fetch_inventory_cost)
    ai.tool("manage_inventory")(manage_inventory)
