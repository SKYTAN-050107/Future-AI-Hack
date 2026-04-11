"""Tool: Deterministic ROI calculation — pure math, no LLM, no I/O."""

from pydantic import BaseModel
from genkit.ai import Genkit
from schemas.economy import ROIResult


# Default yield gain estimates per hectare (kg)
YIELD_ESTIMATES = {
    "Rice": 4000,
    "Oil Palm": 18000,
    "Rubber": 1500,
    "Cocoa": 800,
}
DEFAULT_YIELD = 3000

class RoiInput(BaseModel):
    retail_price: float
    survival_prob: float
    treatment_cost: float
    crop_type: str
    farm_size_hectares: float

def register_roi_tools(ai: Genkit):
    """Register ROI calculation tool with the Genkit instance."""

    @ai.tool("calculate_roi_deterministic")
    async def calculate_roi_deterministic(input_data: RoiInput) -> dict:
        """
        Strict deterministic ROI calculation.
        1. farmGatePrice = retailPrice * 0.45
        2. yieldGain = estimated yield per hectare * farmSize
        3. roi = ((yieldGain * survivalProb * farmGatePrice) - cost) / cost
        """
        # Step 1: Economic markdown (retail → farm gate)
        farm_gate_price = input_data.retail_price * 0.45

        # Step 2: Estimate yield gain
        yield_per_ha = YIELD_ESTIMATES.get(input_data.crop_type, DEFAULT_YIELD)
        estimated_yield_gain = yield_per_ha * input_data.farm_size_hectares

        # Step 3: ROI calculation
        revenue = estimated_yield_gain * input_data.survival_prob * farm_gate_price
        if input_data.treatment_cost > 0:
            roi = (revenue - input_data.treatment_cost) / input_data.treatment_cost
        else:
            roi = 0.0

        return ROIResult(
            retail_price=input_data.retail_price,
            farm_gate_price=farm_gate_price,
            estimated_yield_gain_kg=estimated_yield_gain,
            survival_probability=input_data.survival_prob,
            treatment_cost=input_data.treatment_cost,
            roi=round(roi, 4),
            profitable=roi > 0,
            explanation=(
                f"Retail price: RM{input_data.retail_price:.2f}/kg → "
                f"Farm gate (45% markdown): RM{farm_gate_price:.2f}/kg. "
                f"Expected yield gain: {estimated_yield_gain:.0f} kg. "
                f"ROI: {roi * 100:.1f}%. "
                f"{'✅ Treatment is profitable.' if roi > 0 else '⚠️ Treatment may not be cost-effective.'}"
            ),
        ).model_dump()
