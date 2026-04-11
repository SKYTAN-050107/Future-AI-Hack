"""Agent 3: The Resource Manager — Inventory & Supply Chain Alerts."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate


class ResourceManagerInput(BaseModel):
    user_id: str
    treatment_plan: str


def register_resource_manager_agent(ai: Genkit):
    """Register the resource manager flow with Genkit."""

    @ai.flow("resource_manager_flow")
    async def resource_manager_flow(input_data: ResourceManagerInput) -> str:
        """
        Check inventory stock and trigger FCM alerts if low.
        Summarizes whether the treatment plan is executable.
        """
        from tools.inventory_tool import InventoryInput
        from tools.fcm_tool import FcmInput

        # Step 1: Check current inventory levels
        inventory_status = await ai.run_action(
            key="tool/manage_inventory",
            input=InventoryInput(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
            ),
        )

        # Step 2: If low stock, trigger FCM alert
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
            alert_result = await ai.run_action(
                key="tool/send_low_stock_alert",
                input=FcmInput(
                    user_id=input_data.user_id,
                    treatment_plan=input_data.treatment_plan,
                    current_stock=current_stock,
                ),
            )

        # Step 3: LLM summarizes inventory status
        prompt = f"""You are PadiGuard's Resource Manager Agent. Summarize the inventory status.

Inventory Status: {inventory_status}
Alert Result: {alert_result if alert_result else "No alert triggered (stock sufficient)"}

Provide:
1. 📦 Current stock level for '{input_data.treatment_plan}'
2. ✅ or ❌ Whether the treatment plan can be executed with current stock
3. 🔔 Whether a low-stock alert was sent to the farmer's device
4. 🛒 If low stock, suggest procurement action

Keep the response short and actionable."""

        response = await llm_generate(prompt)
        return response
