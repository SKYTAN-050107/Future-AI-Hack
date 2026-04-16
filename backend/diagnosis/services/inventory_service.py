"""Inventory service for user-scoped chemical stock in Firestore."""

from __future__ import annotations

import asyncio
from datetime import datetime

from google.cloud import firestore

from config import get_settings


class InventoryService:
    """Read and update inventory documents under users/{user_id}/inventory."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = firestore.Client(project=settings.GCP_PROJECT_ID)

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

    # ── Synchronous internals (Firestore SDK is sync) ─────────────────

    def _list_items_sync(self, user_id: str) -> dict:
        docs = (
            self._db.collection("users")
            .document(user_id)
            .collection("inventory")
            .stream()
        )

        items: list[dict] = []
        latest_ts: datetime | None = None

        for doc in docs:
            data = doc.to_dict() or {}
            updated_at = data.get("lastUpdated")
            updated_iso = None
            if hasattr(updated_at, "isoformat"):
                updated_iso = updated_at.isoformat()
                if latest_ts is None or updated_at > latest_ts:
                    latest_ts = updated_at

            liters = self._resolve_liters(data)
            item = {
                "id": doc.id,
                "name": str(data.get("name") or doc.id),
                "category": str(data.get("category") or "Uncategorized"),
                "liters": liters,
                "unit_cost_rm": float(data.get("unitCost", 0.0) or 0.0),
                "last_updated_iso": updated_iso,
            }
            items.append(item)

        items.sort(key=lambda item: item["name"].lower())
        low_stock_count = len([item for item in items if item["liters"] < 5.0])

        return {
            "items": items,
            "total_items": len(items),
            "low_stock_count": low_stock_count,
            "last_updated_iso": latest_ts.isoformat() if latest_ts else None,
        }

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
                "lastUpdated": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        return {
            "id": item_id,
            "liters": float(liters),
            "updated": True,
        }

    @staticmethod
    def _resolve_liters(data: dict) -> float:
        for key in ("quantity", "liters", "stockLiters"):
            value = data.get(key)
            if value is None:
                continue
            try:
                return max(0.0, float(value))
            except (TypeError, ValueError):
                continue
        return 0.0
