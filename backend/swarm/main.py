"""
PadiGuard AI — Multi-Agent Swarm Orchestrator
==============================================
Entrypoint for the standalone Python Genkit service.
Uses a shared AgentContext to coordinate the weather, resource,
spatial, yield, and economist agents.

Usage:
    cd swarm
    .\\.venv\\Scripts\\Activate.ps1
    python main.py
"""

import atexit
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# ── Load .env FIRST (before any config imports) ──────────────────
BACKEND_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=BACKEND_ENV_PATH)

from genkit.ai import Genkit
from genkit.ai import _server as genkit_server
from genkit.ai._server import ServerSpec

from config.llm import llm_generate
from schemas.context import AgentContext, YieldForecastResult
from schemas.orchestrator import SwarmInput, SwarmOutput
from schemas.spatial import PredictedBufferZone

# ── Tool registrations ────────────────────────────────────────────
from tools.weather_tool import register_weather_tools
from tools.mcp_client import register_mcp_tools
from tools.inventory_tool import register_inventory_tools
from tools.roi_tool import register_roi_tools
from tools.fcm_tool import register_fcm_tools

# ── Agent registrations ───────────────────────────────────────────
from agents.meteorologist import register_meteorologist_agent, MeteorologistInput
from agents.economist import register_economist_agent, EconomistInput
from agents.resource_manager import register_resource_manager_agent, ResourceManagerInput
from agents.spatial_propagation import register_spatial_agent, SpatialInput, compute_spatial_propagation
from agents.yield_forecast import register_yield_forecast_agent, YieldForecastInput, compute_yield_forecast


# ── Initialize Genkit (LLM calls go through config/llm.py) ───────
# Genkit reflection server only starts in dev mode.
os.environ.setdefault("GENKIT_ENV", "dev")


def _create_runtime_windows_safe(runtime_dir: str, reflection_server_spec: ServerSpec, at_exit_fn=None) -> Path:
    if not os.path.exists(runtime_dir):
        os.makedirs(runtime_dir)

    current_datetime = datetime.now()
    runtime_file_name = f"{current_datetime.isoformat().replace(':', '-')}.json"
    runtime_file_path = Path(os.path.join(runtime_dir, runtime_file_name))
    metadata = json.dumps(
        {
            "reflectionApiSpecVersion": 1,
            "id": f"{os.getpid()}",
            "pid": os.getpid(),
            "reflectionServerUrl": reflection_server_spec.url,
            "timestamp": f"{current_datetime.isoformat()}",
        }
    )
    runtime_file_path.write_text(metadata, encoding="utf-8")

    def cleanup_runtime() -> None:
        if at_exit_fn:
            at_exit_fn(runtime_file_path)

    if at_exit_fn:
        atexit.register(cleanup_runtime)

    return runtime_file_path


if os.name == "nt":
    genkit_server.create_runtime = _create_runtime_windows_safe

SWARM_HOST = "0.0.0.0"
SWARM_PORT = 3400

ai = Genkit(
    reflection_server_spec=ServerSpec(
        scheme="http",
        host=SWARM_HOST,
        port=SWARM_PORT,
    )
)


# ── Register all tools ────────────────────────────────────────────
register_weather_tools(ai)
register_mcp_tools(ai)
register_inventory_tools(ai)
register_roi_tools(ai)
register_fcm_tools(ai)

# ── Register all agent flows (returns the callable FlowWrapper) ──
meteorologist_flow = register_meteorologist_agent(ai)
economist_flow = register_economist_agent(ai)
resource_manager_flow = register_resource_manager_agent(ai)
spatial_flow = register_spatial_agent(ai)
yield_forecast_flow = register_yield_forecast_agent(ai)


def _safe_text(result, agent_name: str) -> str:
    if isinstance(result, Exception):
        return f"WARNING: {agent_name} encountered an error: {str(result)}"
    return str(result)


def _safe_resource_result(result) -> tuple[str, dict, dict | None]:
    if isinstance(result, Exception):
        return (
            f"WARNING: Resource Manager encountered an error: {str(result)}",
            {},
            None,
        )

    if not isinstance(result, dict):
        return (str(result), {}, None)

    summary = str(result.get("summary") or "").strip() or "Inventory summary unavailable."
    inventory_status = result.get("inventory_status") if isinstance(result.get("inventory_status"), dict) else {}
    alert_result = result.get("alert_result") if isinstance(result.get("alert_result"), dict) else None
    return summary, inventory_status, alert_result


def _safe_spatial_result(result, input_data: SwarmInput, context: AgentContext) -> dict:
    if isinstance(result, Exception):
        return compute_spatial_propagation(
            SpatialInput(
                lat=input_data.lat,
                lng=input_data.lng,
                grid_id=input_data.grid_id,
                crop_type=input_data.crop_type,
                disease=input_data.disease,
                severity_score=input_data.severity_score,
                wind_speed_kmh=input_data.wind_speed_kmh,
                wind_direction=input_data.wind_direction,
                humidity_percent=context.weather.humidity_percent,
                grid_density=input_data.grid_density,
                context=context,
            )
        ).model_dump()

    if isinstance(result, dict):
        return result

    return compute_spatial_propagation(
        SpatialInput(
            lat=input_data.lat,
            lng=input_data.lng,
            grid_id=input_data.grid_id,
            crop_type=input_data.crop_type,
            disease=input_data.disease,
            severity_score=input_data.severity_score,
            wind_speed_kmh=input_data.wind_speed_kmh,
            wind_direction=input_data.wind_direction,
            humidity_percent=context.weather.humidity_percent,
            grid_density=input_data.grid_density,
            context=context,
        )
    ).model_dump()


def _safe_yield_result(result, input_data: SwarmInput, context: AgentContext) -> dict:
    if isinstance(result, Exception):
        return compute_yield_forecast(
            YieldForecastInput(
                user_id=input_data.user_id,
                crop_type=input_data.crop_type,
                farm_size_hectares=input_data.farm_size,
                treatment_plan=input_data.treatment_plan,
                severity_score=input_data.severity_score,
                growth_stage=input_data.growth_stage,
                grid_id=input_data.grid_id,
                context=context,
            )
        ).model_dump()

    if isinstance(result, dict):
        return result

    return compute_yield_forecast(
        YieldForecastInput(
            user_id=input_data.user_id,
            crop_type=input_data.crop_type,
            farm_size_hectares=input_data.farm_size,
            treatment_plan=input_data.treatment_plan,
            severity_score=input_data.severity_score,
            growth_stage=input_data.growth_stage,
            grid_id=input_data.grid_id,
            context=context,
        )
    ).model_dump()


async def _build_chatbot_reply(
    *,
    context: AgentContext,
    weather_text: str,
    economy_text: str,
    resources_text: str,
    spatial_payload: dict | None,
    yield_payload: dict | None,
) -> str:
    payload = json.dumps(
        {
            "context": context.model_dump(exclude_none=True),
            "weather": weather_text,
            "economy": economy_text,
            "resources": resources_text,
            "spatial": spatial_payload or {},
            "yield": yield_payload or {},
        },
        indent=2,
        ensure_ascii=True,
        default=str,
    )

    prompt = (
        "Use the merged farm context below to answer the farmer in one concise response. "
        "Mention the highest-priority action first, then summarize yield, spray safety, inventory, and spread risk.\n\n"
        f"Merged Context:\n{payload}"
    )

    try:
        return await llm_generate(
            prompt,
            system=(
                "You are PadiGuard's final Genkit chatbot orchestrator. "
                "Use only the provided context and summaries. "
                "Do not invent data. Keep the answer concise and farmer-friendly."
            ),
        )
    except Exception as exc:
        logger.warning("Chatbot reply generation failed, using fallback summary: %s", exc)

    yield_forecast = context.yield_forecast
    yield_text = (
        f"Expected yield is about {yield_forecast.predicted_yield_kg:.0f} kg"
        if yield_forecast is not None
        else "Yield forecast is unavailable"
    )
    risk_text = (
        f"spatial risk is {context.spatial.risk_level or 'unknown'}"
        if context.spatial is not None
        else "spatial risk is unknown"
    )
    inventory_text = (
        f"inventory has {context.inventory.quantity_in_stock or 0} unit(s)"
        if context.inventory is not None
        else "inventory status is unavailable"
    )
    return f"{yield_text}. {risk_text}. {inventory_text}. {weather_text} {economy_text} {resources_text}".strip()


# ── Master Orchestrator Flow ──────────────────────────────────────
@ai.flow("swarm_orchestrator")
async def swarm_orchestrator(input_data: SwarmInput) -> dict:
    """
    Master flow: validates input via Pydantic, coordinates the shared
    context across all swarm agents, and combines results into SwarmOutput.

    This is the single entry-point that the frontend/upstream calls.
    It returns a complete "Swarm Analysis" covering:
      - Weather & spray safety (Meteorologist)
      - Financial ROI breakdown (Economist)
      - Inventory & supply chain status (Resource Manager)
      - Yield forecast (Yield Forecast)
      - Disease spread geometry (Spatial Propagation)
    """

    context = AgentContext.from_swarm_input(input_data)

    # ── Launch independent agent flows ────────────────────────────
    weather_task = meteorologist_flow(
        MeteorologistInput(
            lat=input_data.lat,
            lng=input_data.lng,
            crop_type=input_data.crop_type,
            context=context,
        )
    )

    resource_task = resource_manager_flow(
        ResourceManagerInput(
            user_id=input_data.user_id,
            treatment_plan=input_data.treatment_plan,
            context=context,
        )
    )

    # ── Await all agents concurrently ─────────────────────────────
    weather_result, resource_result = (
        await asyncio.gather(
            weather_task,
            resource_task,
            return_exceptions=True,
        )
    )

    # ── Graceful error handling per agent ──────────────────────────
    weather_text = _safe_text(weather_result, "Meteorologist")
    resources_text, inventory_status, alert_result = _safe_resource_result(resource_result)

    if inventory_status:
        context.inventory.quantity_in_stock = inventory_status.get("quantity_in_stock")
        context.inventory.low_stock = inventory_status.get("low_stock")
        context.inventory.sufficient_for_treatment = inventory_status.get("sufficient_for_treatment")
        context.inventory.summary = resources_text
        context.inventory.items = [inventory_status]

    spatial_task = spatial_flow(
        SpatialInput(
            lat=input_data.lat,
            lng=input_data.lng,
            grid_id=input_data.grid_id,
            crop_type=input_data.crop_type,
            disease=input_data.disease,
            severity_score=input_data.severity_score,
            wind_speed_kmh=input_data.wind_speed_kmh,
            wind_direction=input_data.wind_direction,
            humidity_percent=context.weather.humidity_percent,
            grid_density=input_data.grid_density,
            context=context,
        ).model_dump()
    )

    yield_task = yield_forecast_flow(
        YieldForecastInput(
            user_id=input_data.user_id,
            crop_type=input_data.crop_type,
            farm_size_hectares=input_data.farm_size,
            treatment_plan=input_data.treatment_plan,
            severity_score=input_data.severity_score,
            growth_stage=input_data.growth_stage,
            grid_id=input_data.grid_id,
            context=context,
        ).model_dump()
    )

    spatial_result = await spatial_task
    spatial_payload = _safe_spatial_result(spatial_result, input_data, context)

    yield_result = await yield_task
    yield_payload = _safe_yield_result(yield_result, input_data, context)

    if yield_payload:
        context.yield_forecast = YieldForecastResult.model_validate(yield_payload)
        context.economy.predicted_yield_kg = context.yield_forecast.predicted_yield_kg
        context.economy.yield_loss_percent = context.yield_forecast.yield_loss_percent
        context.economy.yield_confidence = context.yield_forecast.confidence

    if spatial_payload:
        context.spatial.base_radius_meters = spatial_payload.get("base_radius_meters")
        context.spatial.predicted_spread_radius_km = spatial_payload.get("predicted_spread_radius_km")
        context.spatial.at_risk_zones = list(spatial_payload.get("at_risk_zones") or [])
        context.spatial.risk_level = spatial_payload.get("risk_level")
        context.spatial.wind_stretch_factor = spatial_payload.get("wind_stretch_factor")
        context.spatial.spread_rate_meters_per_day = spatial_payload.get("spread_rate_meters_per_day")
        context.spatial.advisory_message = spatial_payload.get("advisory_message")
        context.spatial.disease_profile = spatial_payload.get("disease_profile")
        context.spatial.severity_factor = spatial_payload.get("severity_factor")
        context.spatial.humidity_factor = spatial_payload.get("humidity_factor")
        context.spatial.wind_factor = spatial_payload.get("wind_factor")
        context.spatial.grid_density_factor = spatial_payload.get("grid_density_factor")

    if not context.weather.advisory:
        context.weather.advisory = weather_text

    economy_task = economist_flow(
        EconomistInput(
            user_id=input_data.user_id,
            crop_type=input_data.crop_type,
            treatment_plan=input_data.treatment_plan,
            survival_prob=input_data.survival_prob,
            farm_size=input_data.farm_size,
            context=context,
        )
    )

    try:
        economy_result = await economy_task
    except Exception as exc:
        economy_result = f"WARNING: Economist encountered an error: {str(exc)}"

    context.economy.summary = context.economy.summary or economy_result

    chatbot_reply = await _build_chatbot_reply(
        context=context,
        weather_text=weather_text,
        economy_text=str(economy_result),
        resources_text=resources_text,
        spatial_payload=spatial_payload,
        yield_payload=yield_payload,
    )

    # ── Build validated output ────────────────────────────────────
    output = SwarmOutput(
        weather=weather_text,
        economy=str(economy_result),
        resources=resources_text,
        spatial_risk=(
            PredictedBufferZone(**spatial_payload)
            if spatial_payload
            else None
        ),
        yield_forecast=(
            YieldForecastResult.model_validate(yield_payload)
            if yield_payload
            else None
        ),
        chatbot_reply=chatbot_reply,
        context=context,
    )

    return output.model_dump()


# ── Run the Genkit server ─────────────────────────────────────────
if __name__ == "__main__":
    ai.run_main()
