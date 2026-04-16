"""Text assistant service backed by real scan history data."""

from __future__ import annotations

import asyncio

from config import get_settings
from services.firebase_admin_service import get_firestore_client


class AssistantMessageService:
    """Generate user-facing assistant replies from persisted scan reports."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = get_firestore_client()
        self._report_collection = settings.FIRESTORE_REPORT_COLLECTION

    async def build_reply(self, *, user_prompt: str, user_id: str, zone: str | None = None) -> str:
        if not user_prompt.strip():
            raise ValueError("user_prompt is required")
        if not user_id.strip():
            raise ValueError("user_id is required")

        reports = await asyncio.to_thread(self._load_reports_sync, user_id, zone)
        if not reports:
            raise ValueError("No scan history available for assistant reasoning")

        latest = reports[0]
        latest_disease = str(latest.get("disease") or "Unknown")
        latest_severity = self._safe_float(latest.get("severity"), 0.0)
        latest_confidence = self._safe_float(latest.get("confidence"), 0.0)

        trend_line = self._trend_line(reports)
        return (
            f"Latest scan shows {latest_disease} at {latest_severity:.0f}% severity with "
            f"{latest_confidence:.0f}% confidence. {trend_line}"
        )

    def _load_reports_sync(self, user_id: str, zone: str | None) -> list[dict]:
        # Current data model may not persist ownerUid on scan reports yet.
        # We still use real records and narrow by zone when provided.
        docs = self._db.collection(self._report_collection).stream()
        reports: list[dict] = []

        for doc in docs:
            data = doc.to_dict() or {}
            if zone:
                record_zone = str(data.get("zone") or data.get("gridId") or "")
                if record_zone != zone:
                    continue
            reports.append(data)

        reports.sort(key=self._sort_key, reverse=True)
        return reports[:30]

    def _sort_key(self, item: dict) -> float:
        for key in ("createdAt", "timestamp", "lastUpdated"):
            value = item.get(key)
            if hasattr(value, "timestamp"):
                return float(value.timestamp())
        return 0.0

    def _trend_line(self, reports: list[dict]) -> str:
        if len(reports) < 2:
            return "Trend baseline is limited because only one report is available."

        first = self._safe_float(reports[0].get("severity"), 0.0)
        last = self._safe_float(reports[-1].get("severity"), 0.0)
        delta = first - last

        if delta > 5:
            return "Severity trend has increased; prioritize treatment in the next 24 hours."
        if delta < -5:
            return "Severity trend is improving; continue monitoring and follow-up scans."
        return "Severity trend is stable; monitor closely and keep treatment discipline."

    @staticmethod
    def _safe_float(value: object, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
