"""Text assistant service backed by real scan history data."""

from __future__ import annotations

import asyncio
import logging

from config import get_settings
from services.firebase_admin_service import get_firestore_client
from services.llm_service import LLMService

logger = logging.getLogger(__name__)

ZONE_REVIEW_PROMPT_MARKER = "[ZONE_REVIEW]"
_USER_OWNER_FIELDS = ("ownerUid", "userId", "uid")
_ZONE_FIELDS = ("zone", "gridId")
# Hard cap for the zone quick review LLM call. The dashboard widget has a
# deterministic fallback string, so we prefer returning that quickly over
# waiting for a slow Gemini round-trip and tripping the frontend 45s timeout.
_ZONE_REVIEW_LLM_TIMEOUT_SECONDS = 20.0


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
        reports = await asyncio.to_thread(
            self._load_reports_sync,
            user_id,
            zone,
            is_zone_review,
        )
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

        fallback = self._build_zone_fallback_summary(
            zone_label=zone_label,
            latest_disease=latest_disease,
            latest_severity=latest_severity,
            latest_confidence=latest_confidence,
            trend_hint=trend_hint,
        )

        llm = self._get_llm_service()
        if llm is None:
            return fallback

        try:
            reply = await asyncio.wait_for(
                llm.generate_zone_quick_review(
                    zone_name=zone_label,
                    latest_disease=latest_disease,
                    latest_severity=latest_severity,
                    latest_confidence=latest_confidence,
                    trend_hint=trend_hint,
                ),
                timeout=_ZONE_REVIEW_LLM_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Zone quick review LLM call exceeded %.1fs, using fallback",
                _ZONE_REVIEW_LLM_TIMEOUT_SECONDS,
            )
            return fallback
        except Exception as exc:
            logger.warning("Zone quick review generation failed, using fallback: %s", exc)
            return fallback

        # Guard against terse / malformed LLM output (e.g. the model echoing
        # just the disease name). A useful review needs enough words to name
        # the area, the risk level, and an action — fewer than ~6 words or
        # under ~30 characters almost certainly fails that bar, so prefer the
        # deterministic fallback which always includes severity and next step.
        cleaned = (reply or "").strip()
        word_count = len(cleaned.split())
        if len(cleaned) < 30 or word_count < 6:
            logger.info(
                "Zone quick review reply too short (%d chars, %d words); using fallback",
                len(cleaned),
                word_count,
            )
            return fallback
        return cleaned

    @staticmethod
    def _build_zone_fallback_summary(
        *,
        zone_label: str,
        latest_disease: str,
        latest_severity: float,
        latest_confidence: float,
        trend_hint: str,
    ) -> str:
        severity_pct = max(0.0, min(100.0, latest_severity))
        if severity_pct >= 60:
            risk_phrase = "high infection risk"
            action = "Treat immediately and rescan within 24 hours."
        elif severity_pct >= 25:
            risk_phrase = "moderate infection risk"
            action = "Plan treatment soon and rescan in 24-48 hours."
        elif severity_pct > 0:
            risk_phrase = "early-stage risk"
            action = "Monitor closely and rescan in 48 hours."
        else:
            risk_phrase = "no active infection detected"
            action = "Keep monitoring and rescan after the next field walk."

        confidence_note = ""
        if 0 < latest_confidence < 60:
            confidence_note = " Scan confidence is low — capture a fresh image for a firmer read."

        trend_sentence = (trend_hint or "").strip()

        return (
            f"{zone_label}: {latest_disease} at {severity_pct:.0f}% severity ({risk_phrase}). "
            f"{action}{(' ' + trend_sentence) if trend_sentence else ''}{confidence_note}"
        ).strip()

    def _load_reports_sync(
        self,
        user_id: str,
        zone: str | None,
        skip_full_scan: bool = False,
    ) -> list[dict]:
        reports = self._load_reports_via_targeted_queries(user_id=user_id, zone=zone)

        # Legacy fallback: preserve support for older records that may not yet
        # have stable owner fields. This only runs when targeted queries found
        # nothing, which avoids full-collection scans on the hot dashboard path.
        # The zone-review widget skips this fallback altogether — the full scan
        # is what historically pushed that endpoint past the 45s client timeout,
        # and the caller has a deterministic fallback message when no reports
        # are found.
        if not reports and not skip_full_scan:
            reports = self._load_reports_via_full_scan(user_id=user_id, zone=zone)

        reports.sort(key=self._sort_key, reverse=True)
        return reports[:30]

    def _load_reports_via_targeted_queries(self, *, user_id: str, zone: str | None) -> list[dict]:
        collection = self._db.collection(self._report_collection)
        seen_doc_ids: set[str] = set()
        reports: list[dict] = []

        for owner_field in _USER_OWNER_FIELDS:
            queries = []
            owner_query = collection.where(owner_field, "==", user_id)
            queries.append(owner_query)

            if zone:
                for zone_field in _ZONE_FIELDS:
                    queries.append(owner_query.where(zone_field, "==", zone))

            for query in queries:
                for doc in query.stream():
                    if doc.id in seen_doc_ids:
                        continue
                    seen_doc_ids.add(doc.id)
                    reports.append(doc.to_dict() or {})

        if zone:
            zone_value = zone.strip()
            reports = [
                report for report in reports
                if str(report.get("zone") or report.get("gridId") or "").strip() == zone_value
            ]

        return reports

    def _load_reports_via_full_scan(self, *, user_id: str, zone: str | None) -> list[dict]:
        docs = self._db.collection(self._report_collection).stream()
        reports: list[dict] = []

        for doc in docs:
            data = doc.to_dict() or {}
            owner_uid = str(data.get("ownerUid") or data.get("userId") or data.get("uid") or "").strip()
            if owner_uid and owner_uid != user_id:
                continue

            if zone:
                record_zone = str(data.get("zone") or data.get("gridId") or "").strip()
                if record_zone != zone.strip():
                    continue

            reports.append(data)

        return reports

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
