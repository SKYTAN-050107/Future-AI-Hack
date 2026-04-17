"""Task-graph supervisor for PadiGuard AI chat and scan replies."""

from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
import logging
import re
from typing import Any, Awaitable, Callable

from config import get_settings
from orchestration.assistant_pipeline import AssistantPipeline
from services.crop_service import CropService
from services.dashboard_service import DashboardService
from services.firebase_admin_service import get_firestore_client
from services.llm_service import LLMService, build_farmer_fallback_dialogue, detect_farmer_language

logger = logging.getLogger(__name__)

_DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.65


@dataclass(slots=True)
class TaskNode:
    """One node in a small task graph."""

    name: str
    runner: Callable[[dict[str, Any]], Awaitable[Any]] = field(repr=False)
    depends_on: tuple[str, ...] = ()


class InteractionSupervisor:
    """Coordinate diagnosis, dashboard, and reply tasks without touching agents."""

    def __init__(self) -> None:
        self._assistant_pipeline: AssistantPipeline | None = None
        self._assistant_pipeline_error: str | None = None

        self._dashboard_service: DashboardService | None = None
        self._dashboard_service_error: str | None = None

        self._crop_service: CropService | None = None
        self._crop_service_error: str | None = None

        self._llm_service: LLMService | None = None
        self._llm_service_error: str | None = None

        self._firestore_client = None
        self._firestore_error: str | None = None

    def _get_low_confidence_threshold(self) -> float:
        try:
            settings = get_settings()
            threshold = float(getattr(settings, "VECTOR_SEARCH_CONFIDENCE_THRESHOLD", _DEFAULT_LOW_CONFIDENCE_THRESHOLD))
        except Exception:
            threshold = _DEFAULT_LOW_CONFIDENCE_THRESHOLD

        if threshold <= 1.0:
            return threshold
        return threshold / 100.0

    def _get_llm_service(self) -> LLMService | None:
        if self._llm_service is not None:
            return self._llm_service
        if self._llm_service_error is not None:
            return None

        try:
            self._llm_service = LLMService()
        except Exception as exc:
            self._llm_service_error = str(exc)
            logger.warning("LLMService unavailable for supervisor replies: %s", exc)
            return None

        return self._llm_service

    def _get_assistant_pipeline(self) -> AssistantPipeline | None:
        if self._assistant_pipeline is not None:
            return self._assistant_pipeline
        if self._assistant_pipeline_error is not None:
            return None

        try:
            self._assistant_pipeline = AssistantPipeline()
        except Exception as exc:
            self._assistant_pipeline_error = str(exc)
            logger.warning("AssistantPipeline unavailable: %s", exc)
            return None

        return self._assistant_pipeline

    def _get_dashboard_service(self) -> DashboardService | None:
        if self._dashboard_service is not None:
            return self._dashboard_service
        if self._dashboard_service_error is not None:
            return None

        try:
            self._dashboard_service = DashboardService()
        except Exception as exc:
            self._dashboard_service_error = str(exc)
            logger.warning("DashboardService unavailable for supervisor replies: %s", exc)
            return None

        return self._dashboard_service

    def _get_crop_service(self) -> CropService | None:
        if self._crop_service is not None:
            return self._crop_service
        if self._crop_service_error is not None:
            return None

        try:
            self._crop_service = CropService()
        except Exception as exc:
            self._crop_service_error = str(exc)
            logger.warning("CropService unavailable for supervisor replies: %s", exc)
            return None

        return self._crop_service

    def _get_firestore_client(self):
        if self._firestore_client is not None:
            return self._firestore_client
        if self._firestore_error is not None:
            return None

        try:
            self._firestore_client = get_firestore_client()
        except Exception as exc:
            self._firestore_error = str(exc)
            logger.warning("Firestore client unavailable for supervisor replies: %s", exc)
            return None

        return self._firestore_client

    @staticmethod
    def _normalize_confidence(value: Any) -> int | None:
        try:
            confidence = float(value)
        except (TypeError, ValueError):
            return None

        if confidence <= 1.0:
            confidence *= 100.0

        return int(round(max(0.0, min(100.0, confidence))))

    def _is_low_confidence(self, confidence: Any, scan_results: list[dict[str, Any]] | None = None) -> bool:
        threshold_percent = int(round(self._get_low_confidence_threshold() * 100.0))

        normalized = self._normalize_confidence(confidence)
        if normalized is not None:
            return normalized < threshold_percent

        if not scan_results:
            return False

        normalized_values = [
            candidate
            for candidate in (self._normalize_confidence(item.get("confidence")) for item in scan_results)
            if candidate is not None
        ]
        if not normalized_values:
            return False

        return min(normalized_values) < threshold_percent

    @staticmethod
    def _trim_text(value: Any, default: str = "Unknown") -> str:
        text = str(value or "").strip()
        return text or default

    def _detect_intents(self, user_prompt: str) -> set[str]:
        text = (user_prompt or "").lower()
        intents: set[str] = set()

        if re.search(r"\b(photo|image|picture|upload|leaf|spot|symptom|disease|pest|blight|rust|blast|mildew)\b", text):
            intents.add("diagnosis")
        if re.search(r"\b(spray|spraying|weather|rain|wind|temperature|forecast|safe to spray)\b", text):
            intents.add("weather")
        if re.search(r"\b(cost|roi|worth|worth it|profit|benefit|expense|expensive|budget)\b", text):
            intents.add("economy")
        if re.search(r"\b(stock|inventory|available|supply|enough|material|chemical|pesticide|fungicide|fertilizer)\b", text):
            intents.add("resource")
        if re.search(r"\b(spread|isolate|quarantine|contagious|nearby|neighbor|other area|other areas)\b", text):
            intents.add("spread")

        return intents

    async def _run_task_graph(self, nodes: list[TaskNode]) -> dict[str, Any]:
        pending = {node.name: node for node in nodes}
        state: dict[str, Any] = {}

        while pending:
            ready = [
                node
                for node in pending.values()
                if set(node.depends_on).issubset(state.keys())
            ]
            if not ready:
                raise RuntimeError("Task graph has unsatisfied dependencies")

            results = await asyncio.gather(
                *(node.runner(state) for node in ready),
                return_exceptions=True,
            )

            for node, result in zip(ready, results):
                if isinstance(result, Exception):
                    logger.warning("Task node failed: %s -> %s", node.name, result)
                    state[node.name] = {"error": str(result)}
                else:
                    state[node.name] = result
                pending.pop(node.name, None)

        return state

    async def build_photo_reply(
        self,
        *,
        user_prompt: str,
        scan_result: dict[str, Any] | None = None,
        scan_results: list[dict[str, Any]] | None = None,
        confidence: Any = None,
    ) -> str:
        """Return the response-agent reply for a photo upload."""
        llm = self._get_llm_service()
        current_scan = scan_result or (scan_results[0] if scan_results else {})
        low_confidence = self._is_low_confidence(confidence, scan_results)

        if scan_results and len(scan_results) > 1:
            if low_confidence:
                if llm is not None:
                    return await llm.generate_low_confidence_photo_reply(
                        user_prompt=user_prompt,
                        scan_results=scan_results,
                    )
                return self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)

            if llm is not None:
                return await llm.generate_consolidated_assistant_dialogue(scan_results, user_prompt)

            return self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)

        if low_confidence:
            if llm is not None:
                return await llm.generate_low_confidence_photo_reply(
                    user_prompt=user_prompt,
                    scan_result=current_scan,
                )
            return self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)

        assistant_pipeline = self._get_assistant_pipeline()
        if assistant_pipeline is not None:
            try:
                return await assistant_pipeline.run(current_scan, user_prompt)
            except Exception as exc:
                logger.warning("AssistantPipeline reply failed, falling back to Gemini: %s", exc)

        if llm is not None:
            return await llm.generate_assistant_dialogue(current_scan, user_prompt)

        return build_farmer_fallback_dialogue(current_scan, user_prompt)

    async def build_text_reply(
        self,
        *,
        user_prompt: str,
        user_id: str,
        zone: str | None = None,
    ) -> str:
        """Return the response-agent reply for a text-only request."""
        intents = self._detect_intents(user_prompt)

        nodes = [
            TaskNode(
                name="recent_scan",
                runner=lambda _state: self._load_recent_scan_context(user_id=user_id, zone=zone),
            ),
            TaskNode(
                name="crop_profiles",
                runner=lambda _state: self._load_crop_profiles(user_id=user_id),
            ),
        ]

        needs_dashboard = bool(intents & {"weather", "economy", "resource"})
        if needs_dashboard:
            nodes.append(
                TaskNode(
                    name="dashboard_summary",
                    depends_on=("recent_scan", "crop_profiles"),
                    runner=lambda state: self._load_dashboard_summary(
                        user_id=user_id,
                        recent_scan=state.get("recent_scan") or {},
                        crop_profiles=state.get("crop_profiles") or {},
                    ),
                ),
            )

        nodes.append(
            TaskNode(
                name="response",
                depends_on=("recent_scan", "crop_profiles") + (("dashboard_summary",) if needs_dashboard else ()),
                runner=lambda state: self._build_text_response(
                    user_prompt=user_prompt,
                    intents=intents,
                    state=state,
                ),
            ),
        )

        state = await self._run_task_graph(nodes)
        response = str(state.get("response") or "").strip()
        if response:
            return response

        return self._text_fallback(user_prompt=user_prompt, intents=intents, state=state)

    async def _load_recent_scan_context(self, *, user_id: str, zone: str | None) -> dict[str, Any]:
        reports = await asyncio.to_thread(self._load_reports_sync, user_id, zone)

        latest = reports[0] if reports else None
        trend_line = self._trend_line(reports)

        return {
            "has_reports": bool(reports),
            "report_count": len(reports),
            "latest_report": self._compact_report(latest),
            "recent_reports": [self._compact_report(item) for item in reports[:5]],
            "trend": trend_line,
            "zone": zone,
            "needs_follow_up": not bool(reports),
        }

    async def _load_crop_profiles(self, *, user_id: str) -> dict[str, Any]:
        service = self._get_crop_service()
        if service is None:
            return {"items": [], "count": 0, "error": "crop service unavailable"}

        try:
            payload = await service.list_crops(user_id=user_id)
        except Exception as exc:
            logger.warning("Crop profile lookup failed: %s", exc)
            return {"items": [], "count": 0, "error": str(exc)}

        items = payload.get("items") or []
        return {
            "items": items[:8],
            "count": len(items),
        }

    async def _load_dashboard_summary(
        self,
        *,
        user_id: str,
        recent_scan: dict[str, Any],
        crop_profiles: dict[str, Any],
    ) -> dict[str, Any] | None:
        service = self._get_dashboard_service()
        if service is None:
            return None

        latest = recent_scan.get("latest_report") or {}
        crop_items = crop_profiles.get("items") or []
        crop_type = self._trim_text(latest.get("cropType") or latest.get("crop_type") or None, default="") or None
        treatment_plan = self._trim_text(latest.get("treatmentPlan") or latest.get("treatment_plan") or None, default="") or None
        survival_prob = self._safe_float(latest.get("survivalProb"), default=1.0)

        farm_size = 1.0
        if crop_items:
            farm_size = 1.0
        else:
            farm_size = self._safe_float(latest.get("farm_size_hectares"), default=1.0)

        if not crop_items and (not crop_type or not treatment_plan):
            return None

        try:
            summary = await service.build_summary(
                user_id=user_id,
                crop_type=crop_type,
                treatment_plan=treatment_plan,
                farm_size_hectares=farm_size,
                survival_prob=survival_prob,
                lat=self._safe_float(latest.get("lat"), default=None),
                lng=self._safe_float(latest.get("lng"), default=None),
            )
        except Exception as exc:
            logger.warning("Dashboard summary lookup failed: %s", exc)
            return None

        return summary

    async def _build_text_response(
        self,
        *,
        user_prompt: str,
        intents: set[str],
        state: dict[str, Any],
    ) -> str:
        recent_scan = state.get("recent_scan") or {}
        crop_profiles = state.get("crop_profiles") or {}
        dashboard_summary = state.get("dashboard_summary")

        if self._needs_clarification(intents=intents, recent_scan=recent_scan, crop_profiles=crop_profiles, dashboard_summary=dashboard_summary):
            return self._clarifying_question(intents=intents)

        llm = self._get_llm_service()
        if llm is not None:
            return await llm.generate_supervisor_reply(
                user_prompt=user_prompt,
                context={
                    "intents": sorted(intents),
                    "recent_scan": recent_scan,
                    "crop_profiles": {
                        "count": crop_profiles.get("count", 0),
                        "items": crop_profiles.get("items", []),
                    },
                    "dashboard_summary": dashboard_summary,
                },
            )

        return self._text_fallback(user_prompt=user_prompt, intents=intents, state=state)

    def _needs_clarification(
        self,
        *,
        intents: set[str],
        recent_scan: dict[str, Any],
        crop_profiles: dict[str, Any],
        dashboard_summary: dict[str, Any] | None,
    ) -> bool:
        if not recent_scan.get("has_reports") and intents & {"diagnosis", "spread"}:
            return True

        if intents & {"weather", "economy", "resource"}:
            if dashboard_summary is not None:
                return False
            if (crop_profiles.get("count") or 0) > 0:
                return False
            if recent_scan.get("has_reports"):
                return False
            return True

        return False

    def _clarifying_question(self, *, intents: set[str]) -> str:
        if intents & {"weather", "economy", "resource"}:
            return "Which crop and zone should I check?"

        return "Please upload a clearer photo of the affected crop, and tell me which crop it is."

    def _text_fallback(self, *, user_prompt: str, intents: set[str], state: dict[str, Any]) -> str:
        recent_scan = state.get("recent_scan") or {}
        dashboard_summary = state.get("dashboard_summary")
        latest = recent_scan.get("latest_report") or {}

        if dashboard_summary:
            weather = dashboard_summary.get("weatherSnapshot") or {}
            financial = dashboard_summary.get("financialSummary") or {}
            zone_health = dashboard_summary.get("zoneHealthSummary") or {}
            parts: list[str] = []

            if intents & {"weather", "economy", "resource"}:
                parts.append(
                    f"Weather: {self._trim_text(weather.get('condition'), default='Unknown')}. "
                    f"Wind {self._trim_text(weather.get('windKmh'), default='0')} km/h. "
                    f"Rain in hours: {self._trim_text(weather.get('rainInHours'), default='n/a')}."
                )
                parts.append(
                    f"ROI: {self._trim_text(financial.get('roiPercent'), default='0')}% and treatment cost RM {self._trim_text(financial.get('treatmentCostRm'), default='0')}."
                )
                low_stock_item = financial.get("lowStockItem")
                if low_stock_item:
                    parts.append(
                        f"Low stock: {self._trim_text(low_stock_item, default='unknown')} has {self._trim_text(financial.get('lowStockLiters'), default='0')} liters left."
                    )

            if zone_health:
                parts.append(
                    f"Zones needing attention: {self._trim_text(zone_health.get('zonesNeedingAttention'), default='0')}."
                )

            if parts:
                return " ".join(parts)

        if latest:
            disease = self._trim_text(latest.get("disease"), default="Unknown")
            severity = self._trim_text(latest.get("severity"), default="Unknown")
            confidence = latest.get("confidence")
            trend = self._trim_text(recent_scan.get("trend"), default="Trend data is limited.")
            if confidence is None:
                confidence_text = ""
            else:
                confidence_text = f" Confidence {self._normalize_confidence(confidence) or 0}%."
            return f"Latest scan shows {disease} at {severity} severity.{confidence_text} {trend}"

        if intents & {"diagnosis", "spread"}:
            return "Please upload a clear photo of the affected crop, and tell me which crop it is."

        return "Which crop and zone should I check?"

    @staticmethod
    def _compact_report(report: dict[str, Any] | None) -> dict[str, Any]:
        if not report:
            return {}

        return {
            "cropType": report.get("cropType") or report.get("crop_type") or "Unknown",
            "disease": report.get("disease") or "Unknown",
            "severity": report.get("severity") or report.get("severityLevel") or report.get("severity_level") or "Unknown",
            "severityScore": report.get("severityScore") or report.get("severity_score") or 0,
            "confidence": report.get("confidence"),
            "treatmentPlan": report.get("treatmentPlan") or report.get("treatment_plan") or "None",
            "survivalProb": report.get("survivalProb") or report.get("survival_prob"),
            "zone": report.get("zone") or report.get("gridId") or report.get("grid_id"),
        }

    def _low_confidence_fallback(self, *, user_prompt: str, scan_result: dict[str, Any] | None) -> str:
        language = detect_farmer_language(user_prompt)
        crop_type = self._trim_text((scan_result or {}).get("cropType"), default="Unknown")
        disease = self._trim_text((scan_result or {}).get("disease"), default="Unknown")

        if language == "ms":
            return (
                "Apa Yang Kelihatan\n"
                f"{crop_type}: {disease}.\n\n"
                "Kenapa Keyakinan Rendah\n"
                "Gambar ini belum cukup jelas untuk pengesahan yang selamat.\n\n"
                "Langkah Seterusnya\n"
                "Ambil semula gambar dekat dalam cahaya baik. Jika simptom merebak, asingkan pokok dan semak semula."
            )

        return (
            "What This Looks Like\n"
            f"Possible issue: {disease} on {crop_type}.\n\n"
            "Why Confidence Is Low\n"
            "The photo is not clear enough for a safe diagnosis.\n\n"
            "Next Step\n"
            "Retake a close photo in good light. If the issue is spreading, isolate the plant and recheck soon."
        )

    def _load_reports_sync(self, user_id: str, zone: str | None) -> list[dict[str, Any]]:
        db = self._get_firestore_client()
        if db is None:
            return []

        try:
            docs = db.collection(get_settings().FIRESTORE_REPORT_COLLECTION).stream()
        except Exception as exc:
            logger.warning("Unable to stream scan reports: %s", exc)
            return []

        reports: list[dict[str, Any]] = []
        for doc in docs:
            data = doc.to_dict() or {}
            owner_uid = str(data.get("ownerUid") or data.get("userId") or data.get("uid") or "").strip()
            if owner_uid and owner_uid != user_id:
                continue

            if zone:
                record_zone = str(data.get("zone") or data.get("gridId") or "").strip()
                if record_zone != zone:
                    continue

            reports.append(data)

        reports.sort(key=self._report_sort_key, reverse=True)
        return reports[:30]

    @staticmethod
    def _report_sort_key(item: dict[str, Any]) -> float:
        for key in ("timestamp", "createdAt", "created_at", "lastUpdated"):
            value = item.get(key)
            if hasattr(value, "timestamp"):
                return float(value.timestamp())
        return 0.0

    def _trend_line(self, reports: list[dict[str, Any]]) -> str:
        if len(reports) < 2:
            return "Trend baseline is limited because only one report is available."

        first = self._safe_float(reports[0].get("severity"), default=0.0)
        last = self._safe_float(reports[-1].get("severity"), default=0.0)
        delta = first - last

        if delta > 5:
            return "Severity trend has increased; prioritize treatment in the next 24 hours."
        if delta < -5:
            return "Severity trend is improving; continue monitoring and follow-up scans."
        return "Severity trend is stable; monitor closely and keep treatment discipline."

    @staticmethod
    def _safe_float(value: object, default: float | None = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default or 0.0)
