"""Agent 2: The Universal Economist — Financial Command Center."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate


class EconomistInput(BaseModel):
    user_id: str
    crop_type: str
    treatment_plan: str
    survival_prob: float
    farm_size: float


def register_economist_agent(ai: Genkit):
    """Register the economist flow with Genkit."""

    @ai.flow("economist_flow")
    async def economist_flow(input_data: EconomistInput) -> str:
        """
        Full financial analysis: MCP market price → inventory cost → ROI.
        Explicitly explains retail-to-farmgate markdown to the farmer.
        """
        from tools.mcp_client import McpMarketPriceInput
        from tools.inventory_tool import InventoryInput
        from tools.roi_tool import RoiInput

        # Step 1: Fetch market price from ManaMurah MCP
        market_data = await ai.run_action(
            key="tool/fetch_mcp_market_price",
            input=McpMarketPriceInput(crop_type=input_data.crop_type),
        )

        # Step 2: Fetch treatment cost from Firestore inventory
        cost_data = await ai.run_action(
            key="tool/fetch_inventory_cost",
            input=InventoryInput(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
            ),
        )

        # Step 3: Calculate ROI deterministically
        roi_data = await ai.run_action(
            key="tool/calculate_roi_deterministic",
            input=RoiInput(
                retail_price=market_data.get("retail_price_per_kg", 0)
                    if isinstance(market_data, dict)
                    else 0,
                survival_prob=input_data.survival_prob,
                treatment_cost=cost_data.get("total_cost", 0)
                    if isinstance(cost_data, dict)
                    else 0,
                crop_type=input_data.crop_type,
                farm_size_hectares=input_data.farm_size,
            ),
        )

        # Step 4: LLM generates farmer-friendly financial breakdown
        prompt = f"""You are PadiGuard's Economist Agent. Produce a clear financial analysis for a farmer.

Market Data: {market_data}
Treatment Cost: {cost_data}
ROI Analysis: {roi_data}

IMPORTANT: You MUST explicitly explain the retail-to-farmgate price markdown:
- Retail price is what consumers pay in shops.
- Farm gate price is what the farmer actually receives (typically 45% of retail).
- This 55% markdown covers middlemen, transport, processing, and market fees.

Provide:
1. 💰 Market price summary (retail vs farm gate)
2. 💊 Treatment cost breakdown
3. 📊 ROI calculation with clear explanation
4. ✅ or ⚠️ Final recommendation (treat or don't treat)

Keep it concise and use numbers. Farmers need clarity, not jargon."""

        response = await llm_generate(prompt)
        return response
