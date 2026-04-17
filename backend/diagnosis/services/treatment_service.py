"""Treatment recommendation and ROI service using real market and inventory data."""

from __future__ import annotations

from datetime import datetime, timezone
import re
import uuid

import httpx

from config import get_settings
from services.crop_service import CropService
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

_CHANNEL_FACTORS = {
    "middleman": 0.5,
    "direct": 0.8,
    "contract": 0.9,
}

_MARKET_FACTORS = {
    "weak": 0.9,
    "normal": 1.0,
    "strong": 1.1,
    "bullish": 1.1,
    "bearish": 0.9,
}

_MIN_FARM_PRICE_RM_PER_KG = 0.3


class TreatmentService:
    """Compute treatment and ROI using external live data sources."""

    def __init__(self) -> None:
        settings = get_settings()
        self._mcp_server_url = str(settings.MCP_SERVER_URL or "").strip()
        self._inventory_svc = InventoryService()
        self._crop_svc = CropService()
        self._weather_svc = WeatherService()

    async def build_plan(
        self,
        *,
        user_id: str,
        crop_id: str | None,
        disease: str,
        crop_type: str | None,
        treatment_plan: str | None,
        farm_size_hectares: float | None,
        survival_prob: float,
        lat: float | None,
        lng: float | None,
        treatment_cost_rm: float | None,
        selling_channel: str,
        market_condition: str,
        manual_price_override: float | None,
        yield_kg: float | None,
        actual_sold_kg: float | None,
        labor_cost_rm: float | None,
        other_costs_rm: float | None,
    ) -> dict:
        if not user_id.strip():
            raise ValueError("user_id is required")
        if not (0.0 <= survival_prob <= 1.0):
            raise ValueError("survival_prob must be between 0 and 1")

        if crop_id:
            return await self._build_plan_from_crop(
                crop_id=crop_id,
                user_id=user_id,
                disease=disease,
                treatment_plan=treatment_plan,
                selling_channel=selling_channel,
                market_condition=market_condition,
                manual_price_override=manual_price_override,
                yield_kg=yield_kg,
                actual_sold_kg=actual_sold_kg,
                labor_cost_rm=labor_cost_rm,
                other_costs_rm=other_costs_rm,
                lat=lat,
                lng=lng,
            )

        return await self._build_plan_legacy(
            disease=disease,
            crop_type=crop_type,
            treatment_plan=treatment_plan,
            user_id=user_id,
            farm_size_hectares=farm_size_hectares,
            survival_prob=survival_prob,
            lat=lat,
            lng=lng,
            treatment_cost_rm=treatment_cost_rm,
            selling_channel=selling_channel,
            market_condition=market_condition,
        )

    async def _build_plan_from_crop(
        self,
        *,
        crop_id: str,
        user_id: str,
        disease: str,
        treatment_plan: str | None,
        selling_channel: str,
        market_condition: str,
        manual_price_override: float | None,
        yield_kg: float | None,
        actual_sold_kg: float | None,
        labor_cost_rm: float | None,
        other_costs_rm: float | None,
        lat: float | None,
        lng: float | None,
    ) -> dict:
        crop = await self._crop_svc.get_crop(user_id=user_id, crop_id=crop_id)
        crop_name = str(crop.get("name") or "Unknown crop").strip()
        price_date_iso = datetime.now(timezone.utc).isoformat()
        channel = self._normalize_channel(selling_channel)
        market = self._normalize_market(market_condition)

        expected_yield = self._resolve_expected_yield(
            crop=crop,
            manual_yield_kg=yield_kg,
        )
        sold_kg = max(0.0, float(actual_sold_kg) if actual_sold_kg is not None else expected_yield)
        sold_kg = min(sold_kg, expected_yield)

        used_manual = False
        if channel == "contract":
            if manual_price_override is None or float(manual_price_override) <= 0:
                raise ValueError("manual_price_override is required for contract selling channel")
            farm_price = max(0.0, float(manual_price_override))
            retail_price = crop.get("last_price_rm_per_kg") or farm_price
            used_manual = True
        elif manual_price_override is not None and float(manual_price_override) > 0:
            farm_price = max(0.0, float(manual_price_override))
            retail_price = crop.get("last_price_rm_per_kg") or farm_price
            used_manual = True
        else:
            retail_price, price_date_iso = await self._resolve_retail_price(crop_name, crop)
            farm_price = self._apply_channel_market_factors(
                retail_price=retail_price,
                selling_channel=channel,
                market_condition=market,
            )
            await self._crop_svc.record_price_snapshot(
                user_id=user_id,
                crop_id=crop_id,
                last_price_rm_per_kg=retail_price,
                price_date=price_date_iso,
            )

        inventory_cost_info = await self._crop_svc.calculate_inventory_cost(
            user_id=user_id,
            crop_inventory_usage=crop.get("crop_inventory_usage") or [],
        )
        inventory_cost = max(0.0, float(inventory_cost_info.get("inventory_cost_rm") or 0.0))

        labor_cost = max(
            0.0,
            float(labor_cost_rm)
            if labor_cost_rm is not None
            else float(crop.get("labor_cost_rm") or 0.0),
        )
        other_cost = max(
            0.0,
            float(other_costs_rm)
            if other_costs_rm is not None
            else float(crop.get("other_costs_rm") or 0.0),
        )

        total_cost = inventory_cost + labor_cost + other_cost
        revenue = sold_kg * farm_price
        profit = revenue - total_cost

        roi_x: float | None
        roi_percent: float | None
        roi_note: str | None = None
        if total_cost <= 0:
            roi_x = None
            roi_percent = None
            roi_note = "infinite" if revenue > 0 else "undefined"
        else:
            roi_x = revenue / total_cost
            roi_percent = (profit / total_cost) * 100.0

        weather_suffix = ""
        if lat is not None and lng is not None:
            weather = await self._weather_svc.get_outlook(lat=lat, lng=lng, days=1)
            weather_suffix = f" Best spray window: {weather['best_spray_window']}."

        disease_label = str(disease or "crop disease risk").strip() or "crop disease risk"
        recommendation = (
            f"For {crop_name}, apply {str(treatment_plan or 'recommended treatment').strip()} "
            f"to manage {disease_label}.{weather_suffix}"
        )

        return {
            "recommendation": recommendation,
            "estimated_cost_rm": round(total_cost, 2),
            "expected_gain_rm": round(revenue, 2),
            "roi_x": round(roi_x, 2) if roi_x is not None else None,
            "organic_alternative": "No verified organic alternative available from current connected data sources.",
            "retail_price_rm_per_kg": round(float(retail_price), 4),
            "farm_price_rm_per_kg": round(float(farm_price), 4),
            "price_date": price_date_iso,
            "yield_kg": round(expected_yield, 2),
            "actual_sold_kg": round(sold_kg, 2),
            "inventory_cost_rm": round(inventory_cost, 2),
            "inventory_breakdown": inventory_cost_info.get("breakdown") or [],
            "labor_cost_rm": round(labor_cost, 2),
            "other_costs_rm": round(other_cost, 2),
            "profit_rm": round(profit, 2),
            "roi_percent": round(roi_percent, 2) if roi_percent is not None else None,
            "roi_note": roi_note,
            "selling_channel": channel,
            "market_condition": market,
            "used_manual_price_override": used_manual,
        }

    async def _build_plan_legacy(
        self,
        *,
        disease: str,
        crop_type: str | None,
        treatment_plan: str | None,
        user_id: str,
        farm_size_hectares: float | None,
        survival_prob: float,
        lat: float | None,
        lng: float | None,
        treatment_cost_rm: float | None,
        selling_channel: str,
        market_condition: str,
    ) -> dict:
        if not disease.strip():
            raise ValueError("disease is required")
        if not crop_type or not crop_type.strip():
            raise ValueError("crop_type is required when crop_id is not provided")
        if not treatment_plan or not treatment_plan.strip():
            raise ValueError("treatment_plan is required when crop_id is not provided")
        if farm_size_hectares is None or farm_size_hectares <= 0:
            raise ValueError("farm_size_hectares must be > 0")

        channel = self._normalize_channel(selling_channel)
        market = self._normalize_market(market_condition)

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

        farm_gate_price = self._apply_channel_market_factors(
            retail_price=retail_price,
            selling_channel=channel,
            market_condition=market,
        )
        yield_gain_kg = self._yield_per_hectare(crop_type) * farm_size_hectares
        projected_yield_gain_rm = yield_gain_kg * survival_prob * farm_gate_price
        profit = projected_yield_gain_rm - estimated_cost
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
            "retail_price_rm_per_kg": round(retail_price, 4),
            "farm_price_rm_per_kg": round(farm_gate_price, 4),
            "price_date": datetime.now(timezone.utc).isoformat(),
            "yield_kg": round(yield_gain_kg * survival_prob, 2),
            "actual_sold_kg": round(yield_gain_kg * survival_prob, 2),
            "inventory_cost_rm": round(estimated_cost, 2),
            "inventory_breakdown": [],
            "labor_cost_rm": 0.0,
            "other_costs_rm": 0.0,
            "profit_rm": round(profit, 2),
            "roi_percent": round((profit / estimated_cost) * 100.0, 2),
            "roi_note": None,
            "selling_channel": channel,
            "market_condition": market,
            "used_manual_price_override": False,
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

    async def _resolve_retail_price(self, crop_name: str, crop: dict) -> tuple[float, str]:
        now_iso = datetime.now(timezone.utc).isoformat()

        try:
            live_price = await self._fetch_market_price(crop_name)
            return live_price, now_iso
        except Exception:
            cached_price = crop.get("last_price_rm_per_kg")
            cached_date = crop.get("price_date")
            if cached_price is None:
                raise

            return max(0.0, float(cached_price)), str(cached_date or now_iso)

    @staticmethod
    def _apply_channel_market_factors(
        *,
        retail_price: float,
        selling_channel: str,
        market_condition: str,
    ) -> float:
        channel_factor = _CHANNEL_FACTORS.get(selling_channel, _CHANNEL_FACTORS["middleman"])
        market_factor = _MARKET_FACTORS.get(market_condition, _MARKET_FACTORS["normal"])
        adjusted = retail_price * channel_factor * market_factor
        return max(_MIN_FARM_PRICE_RM_PER_KG, adjusted)

    @staticmethod
    def _normalize_channel(raw: str) -> str:
        normalized = str(raw or "middleman").strip().lower()
        if normalized not in _CHANNEL_FACTORS:
            return "middleman"
        return normalized

    @staticmethod
    def _normalize_market(raw: str) -> str:
        normalized = str(raw or "normal").strip().lower()
        if normalized not in _MARKET_FACTORS:
            return "normal"
        return normalized

    def _resolve_expected_yield(self, *, crop: dict, manual_yield_kg: float | None) -> float:
        if manual_yield_kg is not None:
            return max(0.0, float(manual_yield_kg))

        expected_yield_kg = crop.get("expected_yield_kg")
        if expected_yield_kg is not None:
            return max(0.0, float(expected_yield_kg))

        area_hectares = max(0.0, float(crop.get("area_hectares") or 0.0))
        if area_hectares > 0:
            return self._yield_per_hectare(str(crop.get("name") or "")) * area_hectares

        return 0.0

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
