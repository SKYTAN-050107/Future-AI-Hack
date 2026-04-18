"""Agent 2: The Universal Economist — Financial Command Center."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate
from schemas.context import AgentContext, EconomyContext


class EconomistInput(BaseModel):
    user_id: str
    crop_type: str
    treatment_plan: str
    survival_prob: float
    farm_size: float
    context: AgentContext | None = None


def register_economist_agent(ai: Genkit):
    """Register the economist flow with Genkit."""

    @ai.flow("economist_flow")
    async def economist_flow(input_data: EconomistInput) -> str:
        """
        Full financial analysis: MCP market price -> inventory cost -> ROI.
        Explicitly explains retail-to-farmgate markdown to the farmer.
        """
        from tools.mcp_client import fetch_mcp_market_price, McpMarketPriceInput
        from tools.inventory_tool import fetch_inventory_cost, InventoryInput
        from tools.roi_tool import calculate_roi_deterministic, RoiInput

        # Step 1: Fetch market price from ManaMurah MCP (direct call)
        market_data = await fetch_mcp_market_price(
            McpMarketPriceInput(crop_type=input_data.crop_type)
        )

        # Step 2: Fetch treatment cost from Firestore inventory (direct call)
        cost_data = await fetch_inventory_cost(
            InventoryInput(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
            )
        )

        yield_forecast = None
        if input_data.context is not None and input_data.context.yield_forecast is not None:
            yield_forecast = input_data.context.yield_forecast

        # Step 3: Calculate ROI deterministically (direct call)
        roi_data = await calculate_roi_deterministic(
            RoiInput(
                retail_price=market_data.get("retail_price_per_kg", 0)
                    if isinstance(market_data, dict)
                    else 0,
                survival_prob=input_data.survival_prob,
                treatment_cost=cost_data.get("total_cost", 0)
                    if isinstance(cost_data, dict)
                    else 0,
                crop_type=input_data.crop_type,
                farm_size_hectares=input_data.farm_size,
                predicted_yield_kg=yield_forecast.predicted_yield_kg if yield_forecast is not None else None,
                yield_loss_percent=yield_forecast.yield_loss_percent if yield_forecast is not None else None,
                yield_confidence=yield_forecast.confidence if yield_forecast is not None else None,
                yield_source="yield_forecast" if yield_forecast is not None else "baseline",
            )
        )

        # Step 4: LLM generates farmer-friendly financial breakdown
        prompt = f"""You are PadiGuard's Economist Agent. Produce a clear financial analysis for a farmer.

Market Data: {market_data}
Treatment Cost: {cost_data}
ROI Analysis: {roi_data}
Yield Forecast: {yield_forecast.model_dump() if yield_forecast is not None else 'No forecast available'}

IMPORTANT: You MUST explicitly explain the retail-to-farmgate price markdown:
- Retail price is what consumers pay in shops.
- Farm gate price is what the farmer actually receives (typically 45% of retail).
- This 55% markdown covers middlemen, transport, processing, and market fees.

Provide:
1. Market price summary (retail vs farm gate)
2. Treatment cost breakdown
3. ROI calculation with clear explanation
4. Final recommendation (treat or don't treat)

Keep it concise and use numbers. Farmers need clarity, not jargon."""

        try:
            response = await llm_generate(prompt)
        except Exception:
            response = (
                f"Market price is RM{float(market_data.get('retail_price_per_kg', 0)):.2f}/kg if available. "
                f"Treatment cost is RM{float(roi_data.get('treatment_cost', 0)):.2f}. "
                f"ROI is {float(roi_data.get('roi', 0)) * 100:.1f}% and predicted yield is "
                f"{float(roi_data.get('predicted_yield_kg', roi_data.get('estimated_yield_gain_kg', 0))):.0f} kg."
            )

        if input_data.context is not None:
            input_data.context.economy = EconomyContext(
                market_price_per_kg=market_data.get("retail_price_per_kg") if isinstance(market_data, dict) else None,
                farm_gate_price_per_kg=roi_data.get("farm_gate_price") if isinstance(roi_data, dict) else None,
                treatment_cost_rm=roi_data.get("treatment_cost") if isinstance(roi_data, dict) else None,
                farm_size_hectares=input_data.farm_size,
                survival_probability=input_data.survival_prob,
                roi=roi_data.get("roi") if isinstance(roi_data, dict) else None,
                profitable=roi_data.get("profitable") if isinstance(roi_data, dict) else None,
                predicted_yield_kg=roi_data.get("predicted_yield_kg") if isinstance(roi_data, dict) else None,
                yield_loss_percent=roi_data.get("yield_loss_percent") if isinstance(roi_data, dict) else None,
                yield_confidence=roi_data.get("yield_confidence") if isinstance(roi_data, dict) else None,
                summary=response,
            )

        return response

    return economist_flow
