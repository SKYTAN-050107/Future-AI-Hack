"""Agent 1: The Meteorologist — Weather & Spray Safety Advisory."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.llm import llm_generate


class MeteorologistInput(BaseModel):
    lat: float
    lng: float
    crop_type: str


def register_meteorologist_agent(ai: Genkit):
    """Register the meteorologist flow with Genkit."""

    @ai.flow("meteorologist_flow")
    async def meteorologist_flow(input_data: MeteorologistInput) -> str:
        """
        Analyze weather conditions and determine spray safety.
        Uses the fetch_weather tool, then LLM reasons over the data.
        """
        # Step 1: Fetch weather data using the deterministic tool
        from tools.weather_tool import WeatherInput
        weather_result = await ai.run_action(
            key="tool/fetch_weather",
            input=WeatherInput(
                lat=input_data.lat,
                lng=input_data.lng,
            ),
        )

        # Step 2: LLM analyzes the weather data for the farmer
        prompt = f"""You are PadiGuard's Meteorologist Agent. Analyze the following weather data
for a {input_data.crop_type} farm at coordinates ({input_data.lat}, {input_data.lng}).

Weather Data:
{weather_result}

Provide a clear, actionable advisory for the farmer including:
1. Current conditions summary
2. Whether it is SAFE or UNSAFE to spray chemicals right now
3. If unsafe, when the next clear window is
4. Any wind-related spraying precautions
5. If rain is expected within 4 hours, issue a "DELAY" advisory

Keep the response concise and farmer-friendly. Use emojis for readability."""

        response = await llm_generate(prompt)
        return response
