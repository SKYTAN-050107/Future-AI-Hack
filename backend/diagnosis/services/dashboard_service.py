"""Dashboard aggregate service for weather, zone health, and financial summary."""

from __future__ import annotations

import asyncio

from google.cloud import firestore

from config import get_settings
from services.inventory_service import InventoryService
from services.treatment_service import TreatmentService
from services.weather_service import WeatherService


class DashboardService:
    """Aggregate real backend signals for dashboard cards."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = firestore.Client(project=settings.GCP_PROJECT_ID)
        self._grid_collection = settings.FIRESTORE_GRID_COLLECTION
        self._inventory_svc = InventoryService()
        self._weather_svc = WeatherService()
        self._treatment_svc = TreatmentService()

    async def build_summary(
        self,
        *,
        user_id: str,
        crop_type: str,
        treatment_plan: str,
        farm_size_hectares: float,
        survival_prob: float,
        lat: float | None,
        lng: float | None,
    ) -> dict:
        if not user_id.strip():
            raise ValueError("user_id is required")

        if lat is None or lng is None:
            inferred = await asyncio.to_thread(self._infer_coordinates_sync, user_id)
            if inferred is None:
                raise ValueError("lat and lng are required when no grid centroid is available")
            lat, lng = inferred

        weather = await self._weather_svc.get_outlook(lat=lat, lng=lng, days=7)
        zone_health = await asyncio.to_thread(self._compute_zone_health_sync, user_id)

        treatment = await self._treatment_svc.build_plan(
            disease="Crop disease risk",
            crop_type=crop_type,
            treatment_plan=treatment_plan,
            user_id=user_id,
            farm_size_hectares=farm_size_hectares,
            survival_prob=survival_prob,
            lat=lat,
            lng=lng,
            treatment_cost_rm=None,
        )

        inventory = await self._inventory_svc.list_items(user_id=user_id)
        low_stock = next((item for item in inventory["items"] if item["liters"] < 5.0), None)

        return {
            "weatherSnapshot": {
                "condition": weather["condition"],
                "temperatureC": weather["temperatureC"],
                "windKmh": weather["windKmh"],
                "windDirection": weather["windDirection"],
                "rainInHours": weather["rainInHours"],
            },
            "zoneHealthSummary": zone_health,
            "financialSummary": {
                "roiPercent": round((float(treatment["roi_x"]) - 1.0) * 100.0, 2),
                "projectedRoiValueRm": round(float(treatment["expected_gain_rm"]) - float(treatment["estimated_cost_rm"]), 2),
                "projectedYieldGainRm": float(treatment["expected_gain_rm"]),
                "treatmentCostRm": float(treatment["estimated_cost_rm"]),
                "lowStockItem": (low_stock or {}).get("name"),
                "lowStockLiters": (low_stock or {}).get("liters"),
            },
        }

    def _compute_zone_health_sync(self, user_id: str) -> dict:
        docs = (
            self._db.collection(self._grid_collection)
            .where("ownerUid", "==", user_id)
            .stream()
        )

        grids = [doc.to_dict() or {} for doc in docs]
        if not grids:
            raise ValueError("No grid data found for user_id")

        total_area = 0.0
        healthy_area = 0.0
        at_risk_area = 0.0
        infected_area = 0.0
        zones_needing_attention = 0

        for grid in grids:
            area = self._safe_float(grid.get("areaHectares"), default=1.0)
            total_area += area

            state = str(grid.get("healthState") or grid.get("healthStatus") or "Healthy").strip().lower()
            if state in {"infected", "high", "critical"}:
                infected_area += area
                zones_needing_attention += 1
            elif state in {"at-risk", "at_risk", "risk", "warning"}:
                at_risk_area += area
                zones_needing_attention += 1
            else:
                healthy_area += area

        if total_area <= 0:
            raise ValueError("Invalid total area computed from user grids")

        healthy_pct = int(round((healthy_area / total_area) * 100.0))
        at_risk_pct = int(round((at_risk_area / total_area) * 100.0))
        infected_pct = max(0, 100 - healthy_pct - at_risk_pct)

        return {
            "totalAreaHectares": round(total_area, 2),
            "healthy": healthy_pct,
            "atRisk": at_risk_pct,
            "infected": infected_pct,
            "zonesNeedingAttention": zones_needing_attention,
        }

    def _infer_coordinates_sync(self, user_id: str) -> tuple[float, float] | None:
        docs = (
            self._db.collection(self._grid_collection)
            .where("ownerUid", "==", user_id)
            .limit(1)
            .stream()
        )

        for doc in docs:
            data = doc.to_dict() or {}
            centroid = data.get("centroid") or {}
            lat = centroid.get("lat")
            lng = centroid.get("lng")
            if lat is None or lng is None:
                continue
            return float(lat), float(lng)

        return None

    @staticmethod
    def _safe_float(value: object, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
