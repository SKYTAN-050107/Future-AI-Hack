"""Agent 4: The Universal Spatial Propagation Agent — Buffer Zone Parameters."""

import json
from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate_json
from schemas.spatial import PredictedBufferZone


class SpatialInput(BaseModel):
    lat: float
    lng: float
    crop_type: str
    disease: str
    severity_score: float
    wind_speed_kmh: float
    wind_direction: str


def register_spatial_agent(ai: Genkit):
    """Register the spatial propagation flow with Genkit."""

    @ai.flow("dynamic_spatial_propagation_flow")
    async def dynamic_spatial_propagation_flow(input_data: SpatialInput) -> dict:
        """
        Brain-to-Hands architecture:
        - LLM generates the epidemiological parameters (Brain)
        - Frontend Turf.js renders the polygon (Hands)
        """
        system_prompt = (
            "You are a highly advanced Agricultural Epidemiologist Agent. "
            f"A farm grid growing {input_data.crop_type} at coordinates "
            f"({input_data.lat}, {input_data.lng}) "
            f"has been infected with {input_data.disease} "
            f"(Severity: {input_data.severity_score}). "
            f"Current weather conditions: Wind is blowing "
            f"{input_data.wind_speed_kmh} km/h "
            f"towards the {input_data.wind_direction}.\n\n"
            "Calculate the epidemiological spread parameters.\n\n"
            "Rules:\n"
            f"- Dynamically analyze the biological spread vector of "
            f"{input_data.disease} specifically affecting "
            f"{input_data.crop_type}.\n"
            "- If it spreads via airborne spores or insects, high wind "
            "drastically increases spread rate and the wind_stretch_factor.\n"
            "- If it is soil or water-borne, wind has less effect "
            "(stretch factor closer to 1.0).\n"
            "- Convert the wind direction into degrees (0-360).\n"
            "- Output the required mathematical parameters so our mapping "
            "software can draw the containment ring.\n\n"
            "You MUST respond with ONLY valid JSON matching this exact schema:\n"
            "{\n"
            '  "base_radius_meters": <int>,\n'
            '  "wind_direction_degrees": <int 0-360>,\n'
            '  "wind_stretch_factor": <float >= 1.0>,\n'
            '  "spread_rate_meters_per_day": <float>,\n'
            '  "advisory_message": "<string>"\n'
            "}\n\n"
            "No additional text. Only the JSON object."
        )

        response_text = await llm_generate_json(
            prompt=system_prompt,
            system="You are an agricultural epidemiologist. Respond only with JSON.",
        )

        raw = json.loads(response_text)

        # Validate against Pydantic schema — strict enforcement
        buffer_zone = PredictedBufferZone(**raw)
        return buffer_zone.model_dump()

    return dynamic_spatial_propagation_flow
