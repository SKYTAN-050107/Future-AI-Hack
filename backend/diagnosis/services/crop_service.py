"""Crop service for user-scoped crop profiles and inventory-linked usage."""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging

from google.cloud import firestore

from config import get_settings
from services.firebase_admin_service import get_firestore_client
from services.inventory_service import InventoryService

logger = logging.getLogger(__name__)


class CropService:
    """Read and update crop documents under users/{user_id}/crops."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = get_firestore_client()
        self._crop_collection = settings.FIRESTORE_CROP_COLLECTION
        self._inventory_svc = InventoryService()

    async def list_crops(self, *, user_id: str) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        return await asyncio.to_thread(self._list_crops_sync, user_id)

    async def get_crop(self, *, user_id: str, crop_id: str) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not crop_id:
            raise ValueError("crop_id is required")
        return await asyncio.to_thread(self._get_crop_sync, user_id, crop_id)

    async def create_crop(
        self,
        *,
        user_id: str,
        name: str,
        expected_yield_kg: float,
        area_hectares: float,
        planting_date: str | None,
        status: str,
        crop_inventory_usage: list[dict],
        labor_cost_rm: float,
        other_costs_rm: float,
    ) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not name.strip():
            raise ValueError("name is required")
        if expected_yield_kg < 0:
            raise ValueError("expected_yield_kg must be >= 0")
        if area_hectares < 0:
            raise ValueError("area_hectares must be >= 0")

        return await asyncio.to_thread(
            self._create_crop_sync,
            user_id,
            name.strip(),
            float(expected_yield_kg),
            float(area_hectares),
            (planting_date or "").strip() or None,
            self._normalize_status(status),
            crop_inventory_usage,
            max(0.0, float(labor_cost_rm)),
            max(0.0, float(other_costs_rm)),
        )

    async def update_crop(
        self,
        *,
        user_id: str,
        crop_id: str,
        name: str | None,
        expected_yield_kg: float | None,
        area_hectares: float | None,
        planting_date: str | None,
        status: str | None,
        crop_inventory_usage: list[dict] | None,
        labor_cost_rm: float | None,
        other_costs_rm: float | None,
    ) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not crop_id:
            raise ValueError("crop_id is required")

        return await asyncio.to_thread(
            self._update_crop_sync,
            user_id,
            crop_id,
            name,
            expected_yield_kg,
            area_hectares,
            planting_date,
            status,
            crop_inventory_usage,
            labor_cost_rm,
            other_costs_rm,
        )

    async def record_price_snapshot(
        self,
        *,
        user_id: str,
        crop_id: str,
        last_price_rm_per_kg: float,
        price_date: str,
    ) -> None:
        if not user_id or not crop_id:
            return

        await asyncio.to_thread(
            self._record_price_snapshot_sync,
            user_id,
            crop_id,
            max(0.0, float(last_price_rm_per_kg)),
            price_date,
        )

    async def calculate_inventory_cost(
        self,
        *,
        user_id: str,
        crop_inventory_usage: list[dict],
    ) -> dict:
        usage_lines = self._normalize_usage_lines(crop_inventory_usage)
        if not usage_lines:
            return {
                "inventory_cost_rm": 0.0,
                "breakdown": [],
            }

        inventory = await self._inventory_svc.list_items(user_id=user_id)
        items = inventory.get("items") or []

        item_by_id: dict[str, dict] = {
            str(item.get("id") or ""): item
            for item in items
        }

        breakdown: list[dict] = []
        total_cost = 0.0

        for line in usage_lines:
            inventory_id = line["inventory_id"]
            quantity_used = float(line["quantity_used"])
            inventory_item = item_by_id.get(inventory_id, {})
            cost_per_unit = self._safe_float(
                inventory_item.get("unit_cost_rm")
                if inventory_item else None,
                default=0.0,
            )
            line_cost = quantity_used * cost_per_unit
            total_cost += line_cost

            breakdown.append(
                {
                    "inventory_id": inventory_id,
                    "name": str(inventory_item.get("name") or inventory_id),
                    "quantity_used": round(quantity_used, 3),
                    "cost_per_unit_rm": round(cost_per_unit, 4),
                    "line_cost_rm": round(line_cost, 2),
                }
            )

        return {
            "inventory_cost_rm": round(total_cost, 2),
            "breakdown": breakdown,
        }

    def _user_crops_collection(self, user_id: str):
        return (
            self._db.collection("users")
            .document(user_id)
            .collection(self._crop_collection)
        )

    def _list_crops_sync(self, user_id: str) -> dict:
        docs = self._user_crops_collection(user_id).stream()

        items: list[dict] = []
        for doc in docs:
            data = doc.to_dict() or {}
            items.append(self._to_crop_item(doc.id, data))

        items.sort(
            key=lambda item: self._iso_sort_key(item.get("updated_at")),
            reverse=True,
        )

        logger.info("Firestore crops list read: user_id=%s count=%d", user_id, len(items))
        return {"items": items}

    def _get_crop_sync(self, user_id: str, crop_id: str) -> dict:
        ref = self._user_crops_collection(user_id).document(crop_id)
        snapshot = ref.get()
        if not snapshot.exists:
            raise ValueError(f"Crop not found: {crop_id}")

        return self._to_crop_item(snapshot.id, snapshot.to_dict() or {})

    def _create_crop_sync(
        self,
        user_id: str,
        name: str,
        expected_yield_kg: float,
        area_hectares: float,
        planting_date: str | None,
        status: str,
        crop_inventory_usage: list[dict],
        labor_cost_rm: float,
        other_costs_rm: float,
    ) -> dict:
        ref = self._user_crops_collection(user_id).document()
        usage_lines = self._normalize_usage_lines(crop_inventory_usage)

        payload = {
            "name": name,
            "expected_yield_kg": expected_yield_kg,
            "area_hectares": area_hectares,
            "planting_date": planting_date,
            "status": status,
            "crop_inventory_usage": usage_lines,
            "labor_cost_rm": labor_cost_rm,
            "other_costs_rm": other_costs_rm,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            # Compatibility aliases for existing and future clients.
            "expectedYieldKg": expected_yield_kg,
            "areaHectares": area_hectares,
            "plantingDate": planting_date,
            "cropInventoryUsage": usage_lines,
            "laborCostRm": labor_cost_rm,
            "otherCostsRm": other_costs_rm,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }

        ref.set(payload, merge=True)
        created = ref.get()

        logger.info("Firestore crop created: user_id=%s crop_id=%s", user_id, ref.id)
        return self._to_crop_item(created.id, created.to_dict() or {})

    def _update_crop_sync(
        self,
        user_id: str,
        crop_id: str,
        name: str | None,
        expected_yield_kg: float | None,
        area_hectares: float | None,
        planting_date: str | None,
        status: str | None,
        crop_inventory_usage: list[dict] | None,
        labor_cost_rm: float | None,
        other_costs_rm: float | None,
    ) -> dict:
        ref = self._user_crops_collection(user_id).document(crop_id)
        snapshot = ref.get()
        if not snapshot.exists:
            raise ValueError(f"Crop not found: {crop_id}")

        payload: dict = {
            "updated_at": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }

        if name is not None:
            payload["name"] = str(name).strip() or "Unnamed Crop"

        if expected_yield_kg is not None:
            safe_value = max(0.0, float(expected_yield_kg))
            payload["expected_yield_kg"] = safe_value
            payload["expectedYieldKg"] = safe_value

        if area_hectares is not None:
            safe_value = max(0.0, float(area_hectares))
            payload["area_hectares"] = safe_value
            payload["areaHectares"] = safe_value

        if planting_date is not None:
            safe_value = str(planting_date).strip() or None
            payload["planting_date"] = safe_value
            payload["plantingDate"] = safe_value

        if status is not None:
            safe_status = self._normalize_status(status)
            payload["status"] = safe_status

        if crop_inventory_usage is not None:
            safe_usage = self._normalize_usage_lines(crop_inventory_usage)
            payload["crop_inventory_usage"] = safe_usage
            payload["cropInventoryUsage"] = safe_usage

        if labor_cost_rm is not None:
            safe_value = max(0.0, float(labor_cost_rm))
            payload["labor_cost_rm"] = safe_value
            payload["laborCostRm"] = safe_value

        if other_costs_rm is not None:
            safe_value = max(0.0, float(other_costs_rm))
            payload["other_costs_rm"] = safe_value
            payload["otherCostsRm"] = safe_value

        ref.set(payload, merge=True)
        updated = ref.get()

        logger.info("Firestore crop updated: user_id=%s crop_id=%s", user_id, crop_id)
        return self._to_crop_item(updated.id, updated.to_dict() or {})

    def _record_price_snapshot_sync(
        self,
        user_id: str,
        crop_id: str,
        last_price_rm_per_kg: float,
        price_date: str,
    ) -> None:
        ref = self._user_crops_collection(user_id).document(crop_id)
        ref.set(
            {
                "last_price_rm_per_kg": last_price_rm_per_kg,
                "price_date": price_date,
                "lastPriceRmPerKg": last_price_rm_per_kg,
                "priceDate": price_date,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def _to_crop_item(self, crop_id: str, data: dict) -> dict:
        created_at = data.get("created_at") or data.get("createdAt")
        updated_at = data.get("updated_at") or data.get("updatedAt")

        return {
            "id": crop_id,
            "name": str(data.get("name") or "Unnamed Crop"),
            "expected_yield_kg": self._safe_float(
                data.get("expected_yield_kg", data.get("expectedYieldKg")),
                default=0.0,
            ),
            "area_hectares": self._safe_float(
                data.get("area_hectares", data.get("areaHectares")),
                default=0.0,
            ),
            "planting_date": self._safe_str_or_none(data.get("planting_date", data.get("plantingDate"))),
            "status": self._normalize_status(data.get("status")),
            "crop_inventory_usage": self._normalize_usage_lines(
                data.get("crop_inventory_usage", data.get("cropInventoryUsage"))
            ),
            "labor_cost_rm": self._safe_float(data.get("labor_cost_rm", data.get("laborCostRm")), default=0.0),
            "other_costs_rm": self._safe_float(data.get("other_costs_rm", data.get("otherCostsRm")), default=0.0),
            "last_price_rm_per_kg": self._safe_nullable_float(
                data.get("last_price_rm_per_kg", data.get("lastPriceRmPerKg"))
            ),
            "price_date": self._safe_str_or_none(data.get("price_date", data.get("priceDate"))),
            "created_at": self._timestamp_to_iso(created_at),
            "updated_at": self._timestamp_to_iso(updated_at),
        }

    @staticmethod
    def _normalize_usage_lines(raw_usage: object) -> list[dict]:
        safe_usage: list[dict] = []
        if not isinstance(raw_usage, list):
            return safe_usage

        for item in raw_usage:
            if not isinstance(item, dict):
                continue
            inventory_id = str(item.get("inventory_id") or item.get("inventoryId") or "").strip()
            if not inventory_id:
                continue

            quantity_raw = item.get("quantity_used")
            if quantity_raw is None:
                quantity_raw = item.get("quantityUsed")

            try:
                quantity_used = max(0.0, float(quantity_raw or 0.0))
            except (TypeError, ValueError):
                quantity_used = 0.0

            safe_usage.append(
                {
                    "inventory_id": inventory_id,
                    "quantity_used": round(quantity_used, 3),
                }
            )

        return safe_usage

    @staticmethod
    def _normalize_status(raw_status: object) -> str:
        normalized = str(raw_status or "growing").strip().lower()
        if normalized not in {"growing", "harvested"}:
            return "growing"
        return normalized

    @staticmethod
    def _safe_float(value: object, default: float) -> float:
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_nullable_float(value: object) -> float | None:
        try:
            if value is None or value == "":
                return None
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_str_or_none(value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _parse_iso_datetime(value: object) -> datetime | None:
        if not value or not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    @staticmethod
    def _iso_sort_key(value: object) -> float:
        parsed = CropService._parse_iso_datetime(value)
        if parsed is None:
            return 0.0
        return parsed.timestamp()

    @staticmethod
    def _timestamp_to_iso(value: object) -> str | None:
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if isinstance(value, str):
            return value
        return None
