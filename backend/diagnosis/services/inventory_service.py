"""Inventory service for user-scoped chemical stock in Firestore."""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging

from google.cloud import firestore

from services.firebase_admin_service import get_firestore_client

logger = logging.getLogger(__name__)


class InventoryService:
    """Read and update inventory documents under users/{user_id}/inventory."""

    def __init__(self) -> None:
        self._db = get_firestore_client()

    async def list_items(self, user_id: str) -> dict:
        if not user_id:
            raise ValueError("user_id is required")

        return await asyncio.to_thread(self._list_items_sync, user_id)

    async def update_item_liters(self, user_id: str, item_id: str, liters: float) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not item_id:
            raise ValueError("item_id is required")
        if liters < 0:
            raise ValueError("liters must be >= 0")

        return await asyncio.to_thread(self._update_item_liters_sync, user_id, item_id, liters)

    async def create_item_v1(
        self,
        *,
        user_id: str,
        name: str,
        quantity: float,
        usage: str,
        unit: str,
    ) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not name.strip():
            raise ValueError("name is required")
        if quantity < 0:
            raise ValueError("quantity must be >= 0")
        if not usage.strip():
            raise ValueError("usage is required")
        if not unit.strip():
            raise ValueError("unit is required")

        return await asyncio.to_thread(
            self._create_item_v1_sync,
            user_id,
            name.strip(),
            float(quantity),
            usage.strip(),
            unit.strip(),
        )

    async def list_items_v1(self, user_id: str) -> dict:
        if not user_id:
            raise ValueError("user_id is required")

        return await asyncio.to_thread(self._list_items_v1_sync, user_id)

    async def update_item_quantity_delta_v1(
        self,
        *,
        user_id: str,
        item_id: str,
        quantity_change: float,
    ) -> dict:
        if not user_id:
            raise ValueError("user_id is required")
        if not item_id:
            raise ValueError("item_id is required")

        return await asyncio.to_thread(
            self._update_item_quantity_delta_v1_sync,
            user_id,
            item_id,
            float(quantity_change),
        )

    # ── Synchronous internals (Firestore SDK is sync) ─────────────────

    def _list_items_sync(self, user_id: str) -> dict:
        items_v1 = self._list_items_v1_sync(user_id)["items"]

        items: list[dict] = []
        latest_ts: datetime | None = None

        for item_v1 in items_v1:
            updated_iso = item_v1.get("updated_at")
            updated_at = self._parse_iso_datetime(updated_iso)
            if updated_at is not None and (latest_ts is None or updated_at > latest_ts):
                latest_ts = updated_at

            liters = float(item_v1.get("quantity") or 0.0)
            item = {
                "id": str(item_v1.get("id") or ""),
                "name": str(item_v1.get("name") or "Unnamed Item"),
                "category": str(item_v1.get("usage") or "Uncategorized").title(),
                "liters": liters,
                "unit_cost_rm": 0.0,
                "last_updated_iso": updated_iso,
            }
            items.append(item)

        items.sort(
            key=lambda item: self._iso_sort_key(item.get("last_updated_iso")),
            reverse=True,
        )
        low_stock_count = len([item for item in items if item["liters"] < 5.0])

        return {
            "items": items,
            "total_items": len(items),
            "low_stock_count": low_stock_count,
            "last_updated_iso": latest_ts.isoformat() if latest_ts else None,
        }

    def _create_item_v1_sync(
        self,
        user_id: str,
        name: str,
        quantity: float,
        usage: str,
        unit: str,
    ) -> dict:
        ref = (
            self._db.collection("users")
            .document(user_id)
            .collection("inventory")
            .document()
        )

        payload = {
            "name": name,
            "quantity": quantity,
            "usage": usage,
            "unit": unit,
            # Backward-compatible fields still used by current frontend displays.
            "liters": quantity,
            "category": usage.title(),
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "lastUpdated": firestore.SERVER_TIMESTAMP,
        }

        ref.set(payload, merge=True)
        snapshot = ref.get()
        item = self._to_inventory_v1_item(snapshot.id, snapshot.to_dict() or {})
        logger.info("Firestore inventory created: user_id=%s item_id=%s", user_id, snapshot.id)
        return item

    def _list_items_v1_sync(self, user_id: str) -> dict:
        docs = (
            self._db.collection("users")
            .document(user_id)
            .collection("inventory")
            .stream()
        )

        items: list[dict] = []
        for doc in docs:
            data = doc.to_dict() or {}
            items.append(self._to_inventory_v1_item(doc.id, data))

        items.sort(
            key=lambda item: self._iso_sort_key(item.get("updated_at")),
            reverse=True,
        )

        logger.info("Firestore inventory list read: user_id=%s count=%d", user_id, len(items))
        return {"items": items}

    def _update_item_quantity_delta_v1_sync(self, user_id: str, item_id: str, quantity_change: float) -> dict:
        ref = (
            self._db.collection("users")
            .document(user_id)
            .collection("inventory")
            .document(item_id)
        )

        transaction = self._db.transaction()

        @firestore.transactional
        def apply_delta(txn):
            snapshot = ref.get(transaction=txn)
            if not snapshot.exists:
                raise ValueError(f"Inventory item not found: {item_id}")

            current_data = snapshot.to_dict() or {}
            current_quantity = self._resolve_quantity(current_data)
            next_quantity = current_quantity + quantity_change

            if next_quantity < 0:
                raise ValueError("Cannot reduce stock below zero")

            txn.set(
                ref,
                {
                    "quantity": next_quantity,
                    "liters": next_quantity,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "lastUpdated": firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )

        apply_delta(transaction)
        updated_snapshot = ref.get()
        item = self._to_inventory_v1_item(updated_snapshot.id, updated_snapshot.to_dict() or {})
        logger.info(
            "Firestore inventory updated with delta: user_id=%s item_id=%s quantity_change=%.3f new_quantity=%.3f",
            user_id,
            item_id,
            quantity_change,
            float(item.get("quantity") or 0.0),
        )
        return item

    def _update_item_liters_sync(self, user_id: str, item_id: str, liters: float) -> dict:
        ref = (
            self._db.collection("users")
            .document(user_id)
            .collection("inventory")
            .document(item_id)
        )

        snapshot = ref.get()
        if not snapshot.exists:
            raise ValueError(f"Inventory item not found: {item_id}")

        ref.set(
            {
                "quantity": liters,
                "liters": liters,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "lastUpdated": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        logger.info("Firestore inventory absolute update: user_id=%s item_id=%s liters=%.3f", user_id, item_id, liters)

        return {
            "id": item_id,
            "liters": float(liters),
            "updated": True,
        }

    @staticmethod
    def _resolve_liters(data: dict) -> float:
        return InventoryService._resolve_quantity(data)

    @staticmethod
    def _resolve_quantity(data: dict) -> float:
        for key in ("quantity", "liters", "stockLiters"):
            value = data.get(key)
            if value is None:
                continue
            try:
                return max(0.0, float(value))
            except (TypeError, ValueError):
                continue
        return 0.0

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
        parsed = InventoryService._parse_iso_datetime(value)
        if parsed is None:
            return 0.0
        return parsed.timestamp()

    @staticmethod
    def _timestamp_to_iso(value: object) -> str | None:
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return None

    def _to_inventory_v1_item(self, item_id: str, data: dict) -> dict:
        created_at = data.get("created_at") or data.get("createdAt")
        updated_at = data.get("updated_at") or data.get("lastUpdated")

        return {
            "id": item_id,
            "name": str(data.get("name") or item_id),
            "quantity": self._resolve_quantity(data),
            "usage": str(data.get("usage") or data.get("category") or "general"),
            "unit": str(data.get("unit") or "liters"),
            "created_at": self._timestamp_to_iso(created_at),
            "updated_at": self._timestamp_to_iso(updated_at),
        }
