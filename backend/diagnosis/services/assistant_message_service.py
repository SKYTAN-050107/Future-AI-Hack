"""Text assistant service backed by real scan history data."""

from __future__ import annotations

import asyncio
import logging

from config import get_settings
from services.firebase_admin_service import get_firestore_client
from services.llm_service import LLMService

logger = logging.getLogger(__name__)

ZONE_REVIEW_PROMPT_MARKER = "[ZONE_REVIEW]"


class AssistantMessageService:
    """Generate user-facing assistant replies from persisted scan reports."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = get_firestore_client()
        self._report_collection = settings.FIRESTORE_REPORT_COLLECTION
        self._llm: LLMService | None = None
        self._llm_init_error: str | None = None

    def _get_llm_service(self) -> LLMService | None:
        if self._llm is not None:
            return self._llm
        if self._llm_init_error is not None:
            return None

        try:
            self._llm = LLMService()
        except Exception as exc:
            self._llm_init_error = str(exc)
            logger.warning("LLMService unavailable for zone quick review: %s", exc)
            return None

        return self._llm

    @staticmethod
    def _is_zone_review_prompt(user_prompt: str) -> bool:
        return user_prompt.strip().upper().startswith(ZONE_REVIEW_PROMPT_MARKER)

    async def build_reply(self, *, user_prompt: str, user_id: str, zone: str | None = None) -> str:
        if not user_prompt.strip():
            raise ValueError("user_prompt is required")
        if not user_id.strip():
            raise ValueError("user_id is required")

        is_zone_review = self._is_zone_review_prompt(user_prompt)
        reports = await asyncio.to_thread(self._load_reports_sync, user_id, zone)
        if not reports:
            if is_zone_review:
                zone_label = str(zone or "this area").strip() or "this area"
                return f"No scan records yet for {zone_label}. Capture a new scan to generate a quick AI review."
            raise ValueError("No scan history available for assistant reasoning")

        if is_zone_review:
            return await self._build_zone_quick_review(zone=zone, reports=reports)

        latest = reports[0]
        latest_disease = str(latest.get("disease") or "Unknown")
        latest_severity = self._safe_float(latest.get("severity"), 0.0)
        latest_confidence = self._safe_float(latest.get("confidence"), 0.0)

        trend_line = self._trend_line(reports)
        return (
            f"Latest scan shows {latest_disease} at {latest_severity:.0f}% severity with "
            f"{latest_confidence:.0f}% confidence. {trend_line}"
        )

    async def _build_zone_quick_review(self, *, zone: str | None, reports: list[dict]) -> str:
        latest = reports[0]
        latest_disease = str(latest.get("disease") or "Unknown")
        latest_severity = self._safe_float(latest.get("severity"), 0.0)
        latest_confidence = self._safe_float(latest.get("confidence"), 0.0)
        trend_hint = self._trend_line(reports)
        zone_label = str(zone or latest.get("zone") or latest.get("gridId") or "this area").strip() or "this area"

        fallback = (
            f"{zone_label}: {latest_disease} at {latest_severity:.0f}% severity. "
            "Treat soon and rescan in 24-48 hours."
        )

        llm = self._get_llm_service()
        if llm is None:
            return fallback

        try:
            return await llm.generate_zone_quick_review(
                zone_name=zone_label,
                latest_disease=latest_disease,
                latest_severity=latest_severity,
                latest_confidence=latest_confidence,
                trend_hint=trend_hint,
            )
        except Exception as exc:
            logger.warning("Zone quick review generation failed, using fallback: %s", exc)
            return fallback

    def _load_reports_sync(self, user_id: str, zone: str | None) -> list[dict]:
        # Prefer user-scoped records; allow legacy docs without owner fields.
        docs = self._db.collection(self._report_collection).stream()
        reports: list[dict] = []

        for doc in docs:
            data = doc.to_dict() or {}
            owner_uid = str(data.get("ownerUid") or data.get("userId") or data.get("uid") or "").strip()
            if owner_uid and owner_uid != user_id:
                continue

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
