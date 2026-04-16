"""Treatment recommendation and ROI service using real market and inventory data."""

from __future__ import annotations

import asyncio
import re
import uuid

import httpx

from config import get_settings
from services.inventory_service import InventoryService
from services.weather_service import WeatherService

_YIELD_ESTIMATES_KG_PER_HA = {
    "rice": 4000.0,
    "padi": 4000.0,
    "oil palm": 18000.0,
    "rubber": 1500.0,
    "cocoa": 800.0,
}
_DEFAULT_YIELD_KG_PER_HA = 3000.0


class TreatmentService:
    """Compute treatment and ROI using external live data sources."""

    def __init__(self) -> None:
        settings = get_settings()
        self._mcp_server_url = str(settings.MCP_SERVER_URL or "").strip()
        self._inventory_svc = InventoryService()
        self._weather_svc = WeatherService()

    async def build_plan(
        self,
        *,
        disease: str,
        crop_type: str,
        treatment_plan: str,
        user_id: str,
        farm_size_hectares: float,
        survival_prob: float,
        lat: float | None,
        lng: float | None,
        treatment_cost_rm: float | None,
    ) -> dict:
        if not disease.strip():
            raise ValueError("disease is required")
        if not crop_type.strip():
            raise ValueError("crop_type is required")
        if not treatment_plan.strip():
            raise ValueError("treatment_plan is required")
        if not user_id.strip():
            raise ValueError("user_id is required")
        if farm_size_hectares <= 0:
            raise ValueError("farm_size_hectares must be > 0")
        if not (0.0 <= survival_prob <= 1.0):
            raise ValueError("survival_prob must be between 0 and 1")

        retail_price = await self._fetch_market_price(crop_type)
        estimated_cost = await self._resolve_treatment_cost(
            user_id=user_id,
            treatment_plan=treatment_plan,
            explicit_cost=treatment_cost_rm,
        )

        if estimated_cost <= 0:
            raise ValueError(
                "Unable to calculate ROI because treatment cost is missing. "
                "Provide treatment_cost_rm or add unitCost in user inventory."
            )

        farm_gate_price = retail_price * 0.45
        yield_gain_kg = self._yield_per_hectare(crop_type) * farm_size_hectares
        projected_yield_gain_rm = yield_gain_kg * survival_prob * farm_gate_price
        roi_ratio = projected_yield_gain_rm / estimated_cost

        weather_suffix = ""
        if lat is not None and lng is not None:
            weather = await self._weather_svc.get_outlook(lat=lat, lng=lng, days=1)
            weather_suffix = f" Best spray window: {weather['best_spray_window']}."

        recommendation = (
            f"Apply {treatment_plan} for {disease} management and complete field coverage in one cycle."
            f"{weather_suffix}"
        )

        return {
            "recommendation": recommendation,
            "estimated_cost_rm": round(estimated_cost, 2),
            "expected_gain_rm": round(projected_yield_gain_rm, 2),
            "roi_x": round(roi_ratio, 2),
            "organic_alternative": "No verified organic alternative available from current connected data sources.",
        }

    async def _resolve_treatment_cost(
        self,
        *,
        user_id: str,
        treatment_plan: str,
        explicit_cost: float | None,
    ) -> float:
        if explicit_cost is not None:
            return max(0.0, float(explicit_cost))

        inventory = await self._inventory_svc.list_items(user_id=user_id)
        item = next(
            (
                candidate
                for candidate in inventory["items"]
                if str(candidate.get("name", "")).strip().lower() == treatment_plan.strip().lower()
            ),
            None,
        )
        if item is None:
            return 0.0

        return max(0.0, float(item.get("unit_cost_rm", 0.0) or 0.0))

    async def _fetch_market_price(self, crop_type: str) -> float:
        if not self._mcp_server_url:
            raise RuntimeError("MCP_SERVER_URL is missing")

        post_url = self._mcp_server_url.replace("/sse", "/mcp")
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "get_malaysian_prices",
                "arguments": {"query": f"{crop_type} prices"},
            },
        }

        headers = {"x-session-id": str(uuid.uuid4())}

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(post_url, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()

        result_text = ""
        content = ((body.get("result") or {}).get("content") or [])
        if content and isinstance(content, list):
            result_text = str(content[0].get("text") or "")

        if not result_text:
            raise RuntimeError(f"Market data unavailable for crop_type={crop_type}")

        match = re.search(r"Average[^\d:]*?:\s*RM\s*([\d.]+)", result_text, re.IGNORECASE)
        if not match:
            match = re.search(r"RM\s*([\d.]+)", result_text, re.IGNORECASE)
        if not match:
            raise RuntimeError("Unable to parse market price from MCP response")

        return float(match.group(1))

    @staticmethod
    def _yield_per_hectare(crop_type: str) -> float:
        normalized = crop_type.strip().lower()
        return _YIELD_ESTIMATES_KG_PER_HA.get(normalized, _DEFAULT_YIELD_KG_PER_HA)
