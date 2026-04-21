"""Dashboard aggregate service for weather, zone health, and financial summary."""

from __future__ import annotations

import asyncio
import logging

from config import get_settings
from services.crop_service import CropService
from services.firebase_admin_service import get_firestore_client
from services.inventory_service import InventoryService
from services.treatment_service import TreatmentService
from services.weather_service import WeatherService

logger = logging.getLogger(__name__)


class DashboardService:
    """Aggregate real backend signals for dashboard cards."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = get_firestore_client()
        self._grid_collection = settings.FIRESTORE_GRID_COLLECTION
        self._inventory_svc = InventoryService()
        self._crop_svc = CropService()
        self._weather_svc = WeatherService()
        self._treatment_svc = TreatmentService()

    async def build_summary(
        self,
        *,
        user_id: str,
        crop_type: str | None,
        treatment_plan: str | None,
        farm_size_hectares: float | None,
        survival_prob: float | None,
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

        weather_task = self._weather_svc.get_outlook(
            lat=lat,
            lng=lng,
            days=7,
            include_recommendation=False,
        )
        zone_health_task = asyncio.to_thread(self._compute_zone_health_sync, user_id)
        financial_summary_task = self._build_financial_summary(
            user_id=user_id,
            crop_type=crop_type,
            treatment_plan=treatment_plan,
            farm_size_hectares=farm_size_hectares,
            survival_prob=survival_prob,
        )
        inventory_task = self._inventory_svc.list_items(user_id=user_id)

        weather, zone_health, financial_summary, inventory = await asyncio.gather(
            weather_task,
            zone_health_task,
            financial_summary_task,
            inventory_task,
        )
        low_stock = next((item for item in inventory["items"] if item["liters"] < 5.0), None)

        financial_summary["lowStockItem"] = (low_stock or {}).get("name")
        financial_summary["lowStockLiters"] = (low_stock or {}).get("liters")

        return {
            "weatherSnapshot": {
                "condition": weather["condition"],
                "temperatureC": weather["temperatureC"],
                "windKmh": weather["windKmh"],
                "windDirection": weather["windDirection"],
                "rainInHours": weather["rainInHours"],
                "serviceWarning": weather.get("serviceWarning"),
            },
            "zoneHealthSummary": zone_health,
            "financialSummary": financial_summary,
        }

    async def _build_financial_summary(
        self,
        *,
        user_id: str,
        crop_type: str | None,
        treatment_plan: str | None,
        farm_size_hectares: float | None,
        survival_prob: float | None,
    ) -> dict:
        crops_payload = await self._crop_svc.list_crops(user_id=user_id)
        crop_items = crops_payload.get("items") or []

        if crop_items:
            crop_plans = await self._build_crop_financial_plans(user_id=user_id, crop_items=crop_items)
            if crop_plans:
                total_expected_gain = sum(self._safe_float(plan.get("expected_gain_rm"), default=0.0) for plan in crop_plans)
                total_treatment_cost = sum(self._safe_float(plan.get("estimated_cost_rm"), default=0.0) for plan in crop_plans)
                total_expected_roi_value = total_expected_gain - total_treatment_cost

                roi_percent = 0.0
                if total_treatment_cost > 0:
                    roi_percent = (total_expected_roi_value / total_treatment_cost) * 100.0

                return {
                    "roiPercent": round(roi_percent, 2),
                    "projectedRoiValueRm": round(total_expected_roi_value, 2),
                    "projectedYieldGainRm": round(total_expected_gain, 2),
                    "treatmentCostRm": round(total_treatment_cost, 2),
                }

        legacy_crop_type = str(crop_type or "").strip()
        legacy_treatment_plan = str(treatment_plan or "").strip()
        legacy_farm_size = self._safe_float(farm_size_hectares, default=0.0)
        legacy_survival_prob = self._safe_float(survival_prob, default=1.0)

        if (
            not legacy_crop_type
            or not legacy_treatment_plan
            or legacy_farm_size <= 0
            or legacy_survival_prob < 0
            or legacy_survival_prob > 1
        ):
            raise ValueError(
                "Dashboard summary requires at least one crop profile, or valid crop_type, treatment_plan, "
                "farm_size_hectares, and survival_prob fallback values."
            )

        treatment = await self._treatment_svc.build_plan(
            crop_id=None,
            user_id=user_id,
            disease="Crop disease risk",
            crop_type=legacy_crop_type,
            treatment_plan=legacy_treatment_plan,
            farm_size_hectares=legacy_farm_size,
            survival_prob=legacy_survival_prob,
            lat=None,
            lng=None,
            treatment_cost_rm=None,
            selling_channel="middleman",
            market_condition="normal",
            manual_price_override=None,
            yield_kg=None,
            actual_sold_kg=None,
            labor_cost_rm=None,
            other_costs_rm=None,
        )

        legacy_roi_x = treatment.get("roi_x")
        legacy_roi_percent = 0.0
        if legacy_roi_x is not None:
            legacy_roi_percent = (float(legacy_roi_x) - 1.0) * 100.0

        return {
            "roiPercent": round(legacy_roi_percent, 2),
            "projectedRoiValueRm": round(
                float(treatment["expected_gain_rm"]) - float(treatment["estimated_cost_rm"]),
                2,
            ),
            "projectedYieldGainRm": float(treatment["expected_gain_rm"]),
            "treatmentCostRm": float(treatment["estimated_cost_rm"]),
        }

    async def _build_crop_financial_plans(self, *, user_id: str, crop_items: list[dict]) -> list[dict]:
        crop_ids: list[str] = []
        tasks = []

        for crop in crop_items:
            crop_id = str(crop.get("id") or "").strip()
            if not crop_id:
                continue

            crop_ids.append(crop_id)
            tasks.append(
                self._treatment_svc.build_plan(
                    crop_id=crop_id,
                    user_id=user_id,
                    disease="Crop disease risk",
                    crop_type=None,
                    treatment_plan="recommended treatment",
                    farm_size_hectares=None,
                    survival_prob=1.0,
                    lat=None,
                    lng=None,
                    treatment_cost_rm=None,
                    selling_channel="middleman",
                    market_condition="normal",
                    manual_price_override=None,
                    yield_kg=None,
                    actual_sold_kg=None,
                    labor_cost_rm=None,
                    other_costs_rm=None,
                )
            )

        if not tasks:
            return []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        plans: list[dict] = []
        for index, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(
                    "Skipping crop in dashboard financial aggregation: user_id=%s crop_id=%s error=%s",
                    user_id,
                    crop_ids[index],
                    result,
                )
                continue

            plans.append(result)

        return plans

    async def get_zone_summary_counts(self, user_id: str | None = None) -> dict:
        """Return zone counters grouped into healthy, warning, unhealthy."""
        return await asyncio.to_thread(self._get_zone_summary_counts_sync, user_id)

    def _user_grids_collection(self, user_id: str):
        return (
            self._db.collection("users")
            .document(user_id)
            .collection(self._grid_collection)
        )

    def _get_zone_summary_counts_sync(self, user_id: str | None) -> dict:
        if user_id:
            docs = self._user_grids_collection(user_id).stream()
        else:
            docs = self._db.collection_group(self._grid_collection).stream()

        summary = {
            "total_zones": 0,
            "healthy": 0,
            "warning": 0,
            "unhealthy": 0,
        }

        for doc in docs:
            data = doc.to_dict() or {}
            status = self._normalize_zone_status(
                data.get("healthState") or data.get("healthStatus") or data.get("status")
            )

            summary["total_zones"] += 1
            summary[status] += 1

        logger.info(
            "Firestore zones summary read: user_id=%s total=%d healthy=%d warning=%d unhealthy=%d",
            user_id or "all",
            summary["total_zones"],
            summary["healthy"],
            summary["warning"],
            summary["unhealthy"],
        )
        return summary

    def _compute_zone_health_sync(self, user_id: str) -> dict:
        docs = self._user_grids_collection(user_id).stream()

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
        docs = self._user_grids_collection(user_id).limit(1).stream()

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

    @staticmethod
    def _normalize_zone_status(raw: object) -> str:
        normalized = str(raw or "").strip().lower()

        if normalized in {"infected", "critical", "high", "unhealthy"}:
            return "unhealthy"
        if normalized in {"at-risk", "at_risk", "risk", "warning", "moderate"}:
            return "warning"
        return "healthy"
