"""Agent 3: The Resource Manager — Inventory & Supply Chain Alerts."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate
from schemas.context import AgentContext, InventoryContext
from schemas.resources import InventoryStatus, ResourceManagerResult, StockAlert


class ResourceManagerInput(BaseModel):
    user_id: str
    treatment_plan: str
    context: AgentContext | None = None


def _build_inventory_summary(
    *,
    inventory_status: InventoryStatus,
    alert_result: StockAlert | None,
) -> str:
    stock_note = (
        "stock is sufficient"
        if inventory_status.sufficient_for_treatment
        else "stock is not sufficient"
    )
    alert_note = (
        "alert sent" if alert_result and alert_result.alert_sent else "no alert sent"
    )
    return (
        f"Inventory status: {inventory_status.quantity_in_stock} unit(s) of {inventory_status.treatment_plan}. "
        f"{stock_note}. {alert_note}."
    )


def register_resource_manager_agent(ai: Genkit):
    """Register the resource manager flow with Genkit."""

    @ai.flow("resource_manager_flow")
    async def resource_manager_flow(input_data: ResourceManagerInput) -> str:
        """
        Check inventory stock and trigger FCM alerts if low.
        Summarizes whether the treatment plan is executable.
        """
        from tools.inventory_tool import manage_inventory, InventoryInput
        from tools.fcm_tool import send_low_stock_alert, FcmInput

        # Step 1: Check current inventory levels (direct call)
        inventory_status = await manage_inventory(
            InventoryInput(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
            )
        )

        # Step 2: If low stock, trigger FCM alert (direct call)
        alert_result = None
        is_low = (
            inventory_status.get("low_stock", False)
            if isinstance(inventory_status, dict)
            else False
        )
        if is_low:
            current_stock = (
                inventory_status.get("quantity_in_stock", 0)
                if isinstance(inventory_status, dict)
                else 0
            )
            alert_result = await send_low_stock_alert(
                FcmInput(
                    user_id=input_data.user_id,
                    treatment_plan=input_data.treatment_plan,
                    current_stock=current_stock,
                )
            )

        # Step 3: LLM summarizes inventory status
        prompt = f"""You are PadiGuard's Resource Manager Agent. Summarize the inventory status.

Inventory Status: {inventory_status}
Alert Result: {alert_result if alert_result else "No alert triggered (stock sufficient)"}

Provide:
1. Current stock level for '{input_data.treatment_plan}'
2. Whether the treatment plan can be executed with current stock
3. Whether a low-stock alert was sent to the farmer's device
4. If low stock, suggest procurement action

Keep the response short and actionable."""

        try:
            response = await llm_generate(prompt)
        except Exception:
            response = _build_inventory_summary(
                inventory_status=InventoryStatus(**inventory_status),
                alert_result=StockAlert(**alert_result) if isinstance(alert_result, dict) else None,
            )

        result = ResourceManagerResult(
            summary=response,
            inventory_status=InventoryStatus(**inventory_status),
            alert_result=StockAlert(**alert_result) if isinstance(alert_result, dict) else None,
        )

        if input_data.context is not None:
            alert_model = result.alert_result
            input_data.context.inventory = InventoryContext(
                treatment_plan=input_data.treatment_plan,
                quantity_in_stock=result.inventory_status.quantity_in_stock,
                low_stock=result.inventory_status.low_stock,
                sufficient_for_treatment=result.inventory_status.sufficient_for_treatment,
                alert_sent=alert_model.alert_sent if alert_model is not None else None,
                alert_message=alert_model.message if alert_model is not None else None,
                summary=result.summary,
                items=[result.inventory_status.model_dump()],
            )

        return result.model_dump()

    return resource_manager_flow
