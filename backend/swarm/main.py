"""
PadiGuard AI — Multi-Agent Swarm Orchestrator
==============================================
Entrypoint for the standalone Python Genkit service.
Uses asyncio.gather to run all four agents concurrently.

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
from agents.spatial_propagation import register_spatial_agent, SpatialInput


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


# ── Master Orchestrator Flow ──────────────────────────────────────
@ai.flow("swarm_orchestrator")
async def swarm_orchestrator(input_data: SwarmInput) -> dict:
    """
    Master flow: validates input via Pydantic, triggers all 4 agents
    concurrently via asyncio.gather, and combines results into SwarmOutput.

    This is the single entry-point that the frontend/upstream calls.
    It returns a complete "Swarm Analysis" covering:
      - Weather & spray safety (Meteorologist)
      - Financial ROI breakdown (Economist)
      - Inventory & supply chain status (Resource Manager)
      - Disease spread geometry (Spatial Propagation)
    """

    # ── Launch all 4 agent flows concurrently ─────────────────────
    weather_task = meteorologist_flow(
        MeteorologistInput(
            lat=input_data.lat,
            lng=input_data.lng,
            crop_type=input_data.crop_type,
        )
    )

    economy_task = economist_flow(
        EconomistInput(
            user_id=input_data.user_id,
            crop_type=input_data.crop_type,
            treatment_plan=input_data.treatment_plan,
            survival_prob=input_data.survival_prob,
            farm_size=input_data.farm_size,
        )
    )

    resource_task = resource_manager_flow(
        ResourceManagerInput(
            user_id=input_data.user_id,
            treatment_plan=input_data.treatment_plan,
        )
    )

    spatial_task = spatial_flow(
        SpatialInput(
            lat=input_data.lat,
            lng=input_data.lng,
            crop_type=input_data.crop_type,
            disease=input_data.disease,
            severity_score=input_data.severity_score,
            wind_speed_kmh=input_data.wind_speed_kmh,
            wind_direction=input_data.wind_direction,
        )
    )

    # ── Await all agents concurrently ─────────────────────────────
    weather_result, economy_result, resource_result, spatial_result = (
        await asyncio.gather(
            weather_task,
            economy_task,
            resource_task,
            spatial_task,
            return_exceptions=True,
        )
    )

    # ── Graceful error handling per agent ──────────────────────────
    def safe_result(result, agent_name: str) -> str:
        """Convert agent result to string, with error fallback."""
        if isinstance(result, Exception):
            return f"WARNING: {agent_name} encountered an error: {str(result)}"
        return str(result)

    def safe_spatial(result) -> dict | None:
        """Extract spatial dict or None on error."""
        if isinstance(result, Exception) or result is None:
            return None
        if isinstance(result, dict):
            return result
        return None

    # ── Build validated output ────────────────────────────────────
    spatial_data = safe_spatial(spatial_result)
    output = SwarmOutput(
        weather=safe_result(weather_result, "Meteorologist"),
        economy=safe_result(economy_result, "Economist"),
        resources=safe_result(resource_result, "Resource Manager"),
        spatial_risk=(
            PredictedBufferZone(**spatial_data)
            if spatial_data
            else None
        ),
    )

    return output.model_dump()


# ── Run the Genkit server ─────────────────────────────────────────
if __name__ == "__main__":
    ai.run_main()
