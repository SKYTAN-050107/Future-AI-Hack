"""Task-graph supervisor for PadiGuard AI chat and scan replies."""

from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
import logging
import re
from typing import Any, Awaitable, Callable

from config import get_settings
from agents.agriculture_advice_agent import AgricultureAdviceAgent
from orchestration.assistant_pipeline import AssistantPipeline
from agents.response_validation_agent import ResponseValidationAgent
from services.crop_service import CropService
from services.dashboard_service import DashboardService
from services.firebase_admin_service import get_firestore_client
from services.firestore_service import FirestoreService
from services.inventory_service import InventoryService
from services.llm_service import LLMService, build_farmer_fallback_dialogue, detect_farmer_language
from services.weather_service import WeatherService

logger = logging.getLogger(__name__)

_DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.65


@dataclass(slots=True)
class TaskNode:
    name: str
    runner: Callable[[dict[str, Any]], Awaitable[Any]] = field(repr=False)
    depends_on: tuple[str, ...] = ()


class InteractionSupervisor:
    def __init__(self) -> None:
        self._llm_service: LLMService | None = None
        self._llm_service_error: str | None = None

        self._assistant_pipeline: AssistantPipeline | None = None
        self._assistant_pipeline_error: str | None = None

        self._agriculture_advice_agent: AgricultureAdviceAgent | None = None
        self._agriculture_advice_agent_error: str | None = None

        self._response_validation_agent: ResponseValidationAgent | None = None
        self._response_validation_agent_error: str | None = None

        self._dashboard_service: DashboardService | None = None
        self._dashboard_service_error: str | None = None

        self._crop_service: CropService | None = None
        self._crop_service_error: str | None = None

        self._weather_service: WeatherService | None = None
        self._weather_service_error: str | None = None

        self._inventory_service: InventoryService | None = None
        self._inventory_service_error: str | None = None

        self._diagnosis_firestore_service: FirestoreService | None = None
        self._diagnosis_firestore_service_error: str | None = None

        self._firestore_client: Any | None = None
        self._firestore_error: str | None = None

    def _get_low_confidence_threshold(self) -> float:
        settings = get_settings()
        return float(getattr(settings, "VECTOR_SEARCH_CONFIDENCE_THRESHOLD", _DEFAULT_LOW_CONFIDENCE_THRESHOLD))

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
            logger.warning("AssistantPipeline unavailable for supervisor replies: %s", exc)
            return None

        return self._assistant_pipeline

    def _get_agriculture_advice_agent(self) -> AgricultureAdviceAgent | None:
        if self._agriculture_advice_agent is not None:
            return self._agriculture_advice_agent
        if self._agriculture_advice_agent_error is not None:
            return None

        try:
            self._agriculture_advice_agent = AgricultureAdviceAgent(
                name="AgricultureAdviceAgent",
                description="Answer agriculture-only fallback questions when no specialist agent matches.",
            )
        except Exception as exc:
            self._agriculture_advice_agent_error = str(exc)
            logger.warning("AgricultureAdviceAgent unavailable for supervisor replies: %s", exc)
            return None

        return self._agriculture_advice_agent

    def _get_response_validation_agent(self) -> ResponseValidationAgent | None:
        if self._response_validation_agent is not None:
            return self._response_validation_agent
        if self._response_validation_agent_error is not None:
            return None

        try:
            self._response_validation_agent = ResponseValidationAgent(
                name="ResponseValidationAgent",
                description="Validate Gemini replies before returning them to the user.",
            )
        except Exception as exc:
            self._response_validation_agent_error = str(exc)
            logger.warning("ResponseValidationAgent unavailable for supervisor replies: %s", exc)
            return None

        return self._response_validation_agent

    async def _finalize_response(
        self,
        *,
        user_prompt: str,
        draft_reply: str,
        context: dict[str, Any],
        validate: bool = True,
    ) -> str:
        reply = str(draft_reply or "").strip()
        if not reply:
            return reply

        if not validate:
            return reply

        validator = self._get_response_validation_agent()
        if validator is None:
            return reply

        try:
            validation_result = await validator.validate_and_repair_reply(
                user_prompt=user_prompt,
                draft_reply=reply,
                context=context,
            )
        except Exception as exc:
            logger.warning("Reply validation failed, using draft reply: %s", exc)
            return reply

        final_reply = str(validation_result.get("final_reply") or reply).strip()
        verdict = str(validation_result.get("verdict") or "").strip().lower()
        if verdict and verdict != "pass":
            logger.info(
                "Reply validation verdict=%s score=%s truncated=%s",
                verdict,
                validation_result.get("score"),
                validation_result.get("truncated"),
            )

        return final_reply or reply

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

    def _get_weather_service(self) -> WeatherService | None:
        if self._weather_service is not None:
            return self._weather_service
        if self._weather_service_error is not None:
            return None

        try:
            self._weather_service = WeatherService()
        except Exception as exc:
            self._weather_service_error = str(exc)
            logger.warning("WeatherService unavailable for supervisor replies: %s", exc)
            return None

        return self._weather_service

    def _get_inventory_service(self) -> InventoryService | None:
        if self._inventory_service is not None:
            return self._inventory_service
        if self._inventory_service_error is not None:
            return None

        try:
            self._inventory_service = InventoryService()
        except Exception as exc:
            self._inventory_service_error = str(exc)
            logger.warning("InventoryService unavailable for supervisor replies: %s", exc)
            return None

        return self._inventory_service

    def _get_diagnosis_firestore_service(self) -> FirestoreService | None:
        if self._diagnosis_firestore_service is not None:
            return self._diagnosis_firestore_service
        if self._diagnosis_firestore_service_error is not None:
            return None

        try:
            self._diagnosis_firestore_service = FirestoreService()
        except Exception as exc:
            self._diagnosis_firestore_service_error = str(exc)
            logger.warning("Diagnosis FirestoreService unavailable for catalog lookup: %s", exc)
            return None

        return self._diagnosis_firestore_service

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

        scores = [self._normalize_confidence(item.get("confidence")) for item in scan_results if isinstance(item, dict)]
        normalized_scores = [score for score in scores if score is not None]
        if not normalized_scores:
            return False

        return min(normalized_scores) < threshold_percent

    @staticmethod
    def _trim_text(value: Any, default: str = "") -> str:
        text = str(value or "").strip()
        return text or default

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_optional_float(value: Any) -> float | None:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _detect_intents(user_prompt: str) -> set[str]:
        text = (user_prompt or "").lower()
        intents: set[str] = set()

        if any(keyword in text for keyword in ("inventory", "stock", "supply", "supplies", "fertilizer", "fertiliser", "chemical", "chemicals", "pesticide", "pesticides", "seed", "seeds")):
            intents.add("resource")
        if any(phrase in text for phrase in ("location", "my location", "saved location", "farm location", "bound location", "where am i", "where is my farm")):
            intents.add("location")
        if any(keyword in text for keyword in ("weather", "rain", "forecast", "temperature", "wind", "humidity", "climate")):
            intents.add("weather")
        if any(keyword in text for keyword in ("economy", "roi", "profit", "cost", "yield", "revenue", "financial")):
            intents.add("economy")
        if any(keyword in text for keyword in ("diagnosis", "disease", "infect", "infection", "spot", "spots", "wilt", "leaf", "leaves", "pest", "pests", "symptom", "symptoms", "photo", "picture", "image")):
            intents.add("diagnosis")
        if any(keyword in text for keyword in ("spread", "spreading", "cluster", "clusters")):
            intents.add("spread")

        return intents

    @staticmethod
    def _extract_catalog_pest_query(user_prompt: str) -> str | None:
        text = str(user_prompt or "").strip()
        if not text:
            return None

        patterns = [
            r"\b(?:pesticides?|insecticides?|fungicides?|herbicides?|chemical(?:s)?|racun(?:\s+serangga)?)\s+(?:for|against|untuk|bagi)\s+(.+)$",
            r"\b(?:suggest|recommend|give|what(?:'s|\s+is|\s+are)?)\s+(?:me\s+)?(?:pesticides?|insecticides?|fungicides?|herbicides?|chemical(?:s)?|racun(?:\s+serangga)?)\s+(?:for|against|untuk|bagi)\s+(.+)$",
        ]

        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if not match:
                continue

            candidate = match.group(1).strip()
            candidate = re.split(r"[?.!,;]", candidate, maxsplit=1)[0].strip()
            candidate = re.sub(r"\b(?:not|bukan)\b.*$", "", candidate, flags=re.IGNORECASE).strip()
            candidate = candidate.strip(" \"'()[]{}")

            if not candidate:
                continue

            lowered = candidate.lower()
            if any(keyword in lowered for keyword in ("inventory", "stock", "supply", "supplies")):
                continue

            if len(candidate) > 80:
                continue

            return candidate

        return None

    async def _load_pesticide_catalog_recommendation(self, *, requested_pest_name: str) -> dict[str, Any]:
        firestore_service = self._get_diagnosis_firestore_service()
        if firestore_service is None:
            return {}

        try:
            return await firestore_service.get_pesticide_catalog_recommendation(requested_pest_name)
        except Exception as exc:
            logger.warning(
                "Pesticide catalog lookup failed for pest=%s: %s",
                requested_pest_name,
                exc,
            )
            return {}

    def _build_catalog_pesticide_reply(
        self,
        *,
        user_prompt: str,
        requested_pest_name: str,
        catalog_recommendation: dict[str, Any],
    ) -> str:
        language = detect_farmer_language(user_prompt)
        matched_name = self._trim_text(
            catalog_recommendation.get("matchedPestName"),
            default=requested_pest_name,
        )

        pesticides_raw = catalog_recommendation.get("recommendedPesticides") or []
        if not isinstance(pesticides_raw, list):
            pesticides_raw = []
        pesticides = [
            str(item).strip()
            for item in pesticides_raw
            if str(item).strip()
        ]

        if pesticides:
            if language == "ms":
                return (
                    f"Untuk {matched_name}, racun yang biasa digunakan ialah: {', '.join(pesticides)}. "
                    "Mulakan semburan ikut kadar label produk dan semak semula gejala dalam 48 jam."
                )

            return (
                f"For {matched_name}, commonly used pesticides are: {', '.join(pesticides)}. "
                "Apply according to the product label rate and recheck symptoms after 48 hours."
            )

        if language == "ms":
            return (
                f"Saya tidak jumpa rekod pesticideCatalog untuk '{requested_pest_name}'. "
                "Sila semak ejaan nama perosak atau buat imbasan gambar baharu."
            )

        return (
            f"I could not find a pesticideCatalog record for '{requested_pest_name}'. "
            "Please check the pest name spelling or run a new photo scan."
        )

    @staticmethod
    def _references_existing_scan_context(user_prompt: str) -> bool:
        text = (user_prompt or "").lower()
        if re.search(
            r"\b(latest|recent|previous|prior|scan|report|history|photo|image|upload|uploaded|picture)\b",
            text,
        ):
            return True

        follow_up_patterns = (
            r"\b(this|that|the)\s+(disease|issue|problem|infection|symptom|condition)\b",
            r"\b(same|that)\s+(disease|issue|problem|infection|symptom|condition)\b",
            r"\bthe\s+one\s+you\s+(detected|found|diagnosed|mentioned)\b",
            r"\b(penyakit|masalah|gejala)\s+(ini|itu)\b",
            r"\byang\s+(anda|awak)\s+(kesan|jumpa|diagnos|sebut)\b",
        )

        return any(re.search(pattern, text) for pattern in follow_up_patterns)

    async def _run_task_graph(self, nodes: list[TaskNode]) -> dict[str, Any]:
        state: dict[str, Any] = {}
        pending = list(nodes)
        completed: set[str] = set()

        while pending:
            progressed = False
            for index, node in enumerate(list(pending)):
                if any(dep not in completed for dep in node.depends_on):
                    continue

                state[node.name] = await node.runner(state.copy())
                completed.add(node.name)
                pending.pop(index)
                progressed = True
                break

            if not progressed:
                pending_names = [node.name for node in pending]
                missing_dependencies = sorted(
                    {
                        dependency
                        for node in pending
                        for dependency in node.depends_on
                        if dependency not in completed
                    }
                )
                raise RuntimeError(
                    f"Task graph stalled; pending={pending_names}; missing_dependencies={missing_dependencies}"
                )

        return state

    async def build_photo_reply(
        self,
        *,
        user_prompt: str,
        confidence: Any,
        scan_result: dict[str, Any] | None = None,
        scan_results: list[dict[str, Any]] | None = None,
    ) -> str:
        current_scan = scan_result or (scan_results[0] if scan_results else {})
        low_confidence = self._is_low_confidence(confidence, scan_results)
        validation_context = {
            "confidence": confidence,
            "scan_result": current_scan,
            "scan_results": scan_results or [],
        }

        if scan_results and len(scan_results) > 1:
            if low_confidence:
                llm = self._get_llm_service()
                if llm is not None:
                    draft_reply = await llm.generate_low_confidence_photo_reply(
                        user_prompt=user_prompt,
                        scan_results=scan_results,
                    )
                else:
                    draft_reply = self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)

                return await self._finalize_response(
                    user_prompt=user_prompt,
                    draft_reply=draft_reply,
                    context=validation_context,
                )

            llm = self._get_llm_service()
            if llm is not None:
                draft_reply = await llm.generate_consolidated_assistant_dialogue(scan_results, user_prompt)
                return await self._finalize_response(
                    user_prompt=user_prompt,
                    draft_reply=draft_reply,
                    context=validation_context,
                )

            draft_reply = self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)
            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context=validation_context,
            )

        if low_confidence:
            llm = self._get_llm_service()
            if llm is not None:
                draft_reply = await llm.generate_low_confidence_photo_reply(
                    user_prompt=user_prompt,
                    scan_result=current_scan,
                )
            else:
                draft_reply = self._low_confidence_fallback(user_prompt=user_prompt, scan_result=current_scan)

            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context=validation_context,
            )

        assistant_pipeline = self._get_assistant_pipeline()
        if assistant_pipeline is not None:
            try:
                draft_reply = await assistant_pipeline.run(current_scan, user_prompt)
                return await self._finalize_response(
                    user_prompt=user_prompt,
                    draft_reply=draft_reply,
                    context=validation_context,
                )
            except Exception as exc:
                logger.warning("AssistantPipeline reply failed, falling back to Gemini: %s", exc)

        llm = self._get_llm_service()
        if llm is not None:
            draft_reply = await llm.generate_assistant_dialogue(current_scan, user_prompt)
            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context=validation_context,
            )

        draft_reply = build_farmer_fallback_dialogue(current_scan, user_prompt)
        return await self._finalize_response(
            user_prompt=user_prompt,
            draft_reply=draft_reply,
            context=validation_context,
        )

    async def build_text_reply(
        self,
        *,
        user_prompt: str,
        user_id: str,
        zone: str | None = None,
        location: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
    ) -> str:
        """Return the response-agent reply for a text-only request."""
        intents = self._detect_intents(user_prompt)
        validation_context_base = {
            "intents": sorted(intents),
            "location": location,
            "lat": lat,
            "lng": lng,
            "user_id": user_id,
            "zone": zone,
        }

        requested_pest_name = self._extract_catalog_pest_query(user_prompt)
        if requested_pest_name:
            catalog_recommendation = await self._load_pesticide_catalog_recommendation(
                requested_pest_name=requested_pest_name,
            )
            draft_reply = self._build_catalog_pesticide_reply(
                user_prompt=user_prompt,
                requested_pest_name=requested_pest_name,
                catalog_recommendation=catalog_recommendation,
            )

            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context={
                    **validation_context_base,
                    "catalog_requested_pest_name": requested_pest_name,
                    "catalog_recommendation": catalog_recommendation,
                },
                validate=False,
            )

        nodes: list[TaskNode] = []

        needs_inventory = bool(intents & {"resource"})
        needs_recent_scan = bool(intents & {"diagnosis", "spread", "weather", "economy"})
        needs_crop_profiles = bool(intents & {"weather", "economy"})

        if needs_inventory:
            nodes.append(
                TaskNode(
                    name="inventory_summary",
                    runner=lambda _state: self._load_inventory_summary(user_id=user_id),
                )
            )

        if intents & {"resource"}:
            inventory_summary = await self._load_inventory_summary(user_id=user_id)
            llm = self._get_llm_service()
            if llm is not None:
                draft_reply = await llm.generate_inventory_reply(
                    user_prompt=user_prompt,
                    inventory_summary=inventory_summary,
                )
            else:
                draft_reply = self._inventory_fallback(inventory_summary=inventory_summary)

            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context={**validation_context_base, "inventory_summary": inventory_summary},
            )

        if not (intents & {"resource", "weather", "location", "economy", "diagnosis", "spread"}):
            recent_scan = await self._load_recent_scan_context(user_id=user_id, zone=zone)
            agriculture_context = {
                **validation_context_base,
                "recent_scan": recent_scan,
            }

            agriculture_agent = self._get_agriculture_advice_agent()
            if agriculture_agent is not None:
                draft_reply = await agriculture_agent.generate_reply(
                    user_prompt=user_prompt,
                    context=agriculture_context,
                )
            else:
                llm = self._get_llm_service()
                if llm is not None:
                    draft_reply = await llm.generate_agriculture_reply(
                        user_prompt=user_prompt,
                        context=agriculture_context,
                    )
                else:
                    draft_reply = "This assistant only answers agriculture-related questions. Please ask about crops, planting, soil, irrigation, pests, fertilizer, harvesting, or farm management."

            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=draft_reply,
                context=agriculture_context,
                validate=False,
            )

        if needs_recent_scan:
            nodes.append(
                TaskNode(
                    name="recent_scan",
                    runner=lambda _state: self._load_recent_scan_context(user_id=user_id, zone=zone),
                )
            )

        if needs_crop_profiles:
            nodes.append(
                TaskNode(
                    name="crop_profiles",
                    runner=lambda _state: self._load_crop_profiles(user_id=user_id),
                )
            )

        if intents & {"weather", "location"}:
            nodes.append(
                TaskNode(
                    name="weather_snapshot",
                    runner=lambda _state: self._load_weather_snapshot(lat=lat, lng=lng),
                )
            )

        needs_dashboard = bool(intents & {"weather", "economy"})
        if needs_dashboard:
            nodes.append(
                TaskNode(
                    name="dashboard_summary",
                    depends_on=tuple(
                        name for name in ("recent_scan", "crop_profiles") if any(node.name == name for node in nodes)
                    ),
                    runner=lambda state: self._load_dashboard_summary(
                        user_id=user_id,
                        recent_scan=state.get("recent_scan") or {},
                        crop_profiles=state.get("crop_profiles") or {},
                        lat=lat,
                        lng=lng,
                    ),
                )
            )

        if not nodes:
            nodes.extend(
                [
                    TaskNode(
                        name="recent_scan",
                        runner=lambda _state: self._load_recent_scan_context(user_id=user_id, zone=zone),
                    ),
                    TaskNode(
                        name="crop_profiles",
                        runner=lambda _state: self._load_crop_profiles(user_id=user_id),
                    ),
                ]
            )

        nodes.append(
            TaskNode(
                name="response",
                depends_on=tuple(node.name for node in nodes),
                runner=lambda state: self._build_text_response(
                    user_prompt=user_prompt,
                    intents=intents,
                    state=state,
                    location=location,
                    lat=lat,
                    lng=lng,
                ),
            )
        )

        state = await self._run_task_graph(nodes)
        validation_context = {**validation_context_base, **state}
        response = str(state.get("response") or "").strip()
        if response:
            return await self._finalize_response(
                user_prompt=user_prompt,
                draft_reply=response,
                context=validation_context,
            )

        draft_reply = self._text_fallback(
            user_prompt=user_prompt,
            intents=intents,
            state=state,
            location=location,
            lat=lat,
            lng=lng,
        )
        return await self._finalize_response(
            user_prompt=user_prompt,
            draft_reply=draft_reply,
            context=validation_context,
        )

    async def _load_recent_scan_context(self, *, user_id: str, zone: str | None) -> dict[str, Any]:
        reports = await asyncio.to_thread(self._load_reports_sync, user_id, zone)
        latest = reports[0] if reports else None

        return {
            "has_reports": bool(reports),
            "report_count": len(reports),
            "latest_report": self._compact_report(latest),
            "recent_reports": [self._compact_report(item) for item in reports[:5]],
            "trend": self._trend_line(reports),
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

    async def _load_inventory_summary(self, *, user_id: str) -> dict[str, Any]:
        service = self._get_inventory_service()
        if service is None:
            return {
                "items": [],
                "total_items": 0,
                "low_stock_count": 0,
                "error": "inventory service unavailable",
            }

        try:
            payload = await service.list_items(user_id=user_id)
        except Exception as exc:
            logger.warning("Inventory lookup failed: %s", exc)
            return {
                "items": [],
                "total_items": 0,
                "low_stock_count": 0,
                "error": str(exc),
            }

        items = payload.get("items") or []
        return {
            "items": items[:10],
            "total_items": int(payload.get("total_items") or len(items)),
            "low_stock_count": int(payload.get("low_stock_count") or 0),
            "last_updated_iso": payload.get("last_updated_iso"),
        }

    async def _load_weather_snapshot(self, *, lat: float | None, lng: float | None) -> dict[str, Any] | None:
        service = self._get_weather_service()
        if service is None or lat is None or lng is None:
            return None

        try:
            return await service.get_outlook(lat=lat, lng=lng, days=7)
        except Exception as exc:
            logger.warning("Weather lookup failed for supervisor replies: %s", exc)
            return None

    async def _load_dashboard_summary(
        self,
        *,
        user_id: str,
        recent_scan: dict[str, Any],
        crop_profiles: dict[str, Any],
        lat: float | None = None,
        lng: float | None = None,
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
        if not crop_items:
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
                lat=self._safe_optional_float(lat) if lat is not None else self._safe_optional_float(latest.get("lat")),
                lng=self._safe_optional_float(lng) if lng is not None else self._safe_optional_float(latest.get("lng")),
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
        location: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
    ) -> str:
        recent_scan = state.get("recent_scan") or {}
        crop_profiles = state.get("crop_profiles") or {}
        weather_snapshot = state.get("weather_snapshot") or {}
        inventory_summary = state.get("inventory_summary") or {}
        dashboard_summary = state.get("dashboard_summary")
        has_recent_scan = bool(recent_scan.get("has_reports"))

        if intents & {"diagnosis"} and not has_recent_scan and not self._references_existing_scan_context(user_prompt):
            return self._clarifying_question(intents=intents)

        if intents == {"location"}:
            return self._saved_location_reply(user_prompt=user_prompt, location=location, lat=lat, lng=lng)

        if intents & {"weather"} and not weather_snapshot and dashboard_summary is None:
            return self._weather_unavailable_reply(user_prompt=user_prompt, location=location)

        if self._needs_clarification(
            intents=intents,
            recent_scan=recent_scan,
            crop_profiles=crop_profiles,
            dashboard_summary=dashboard_summary,
            inventory_summary=inventory_summary,
        ):
            return self._clarifying_question(intents=intents)

        if intents & {"resource"}:
            llm = self._get_llm_service()
            if llm is not None:
                return await llm.generate_inventory_reply(
                    user_prompt=user_prompt,
                    inventory_summary=inventory_summary,
                )
            return self._inventory_fallback(inventory_summary=inventory_summary)

        llm = self._get_llm_service()
        if llm is not None:
            return await llm.generate_supervisor_reply(
                user_prompt=user_prompt,
                context={
                    "intents": sorted(intents),
                    "location": location,
                    "lat": lat,
                    "lng": lng,
                    "weather_snapshot": weather_snapshot,
                    "recent_scan": recent_scan,
                    "crop_profiles": {
                        "count": crop_profiles.get("count", 0),
                        "items": crop_profiles.get("items", []),
                    },
                    "inventory_summary": inventory_summary,
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
        inventory_summary: dict[str, Any],
    ) -> bool:
        if not recent_scan.get("has_reports") and intents & {"diagnosis", "spread"}:
            return True

        if intents & {"weather", "economy"}:
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

    def _text_fallback(
        self,
        *,
        user_prompt: str,
        intents: set[str],
        state: dict[str, Any],
        location: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
    ) -> str:
        recent_scan = state.get("recent_scan") or {}
        weather_snapshot = state.get("weather_snapshot") or {}
        inventory_summary = state.get("inventory_summary") or {}
        dashboard_summary = state.get("dashboard_summary")
        crop_profiles = state.get("crop_profiles") or {}

        if intents & {"resource"}:
            return self._inventory_fallback(inventory_summary=inventory_summary)

        if intents == {"location"}:
            return self._saved_location_reply(user_prompt=user_prompt, location=location, lat=lat, lng=lng)

        if intents & {"weather"} and not weather_snapshot and dashboard_summary is None:
            return self._weather_unavailable_reply(user_prompt=user_prompt, location=location)

        if weather_snapshot:
            return self._weather_snapshot_reply(
                user_prompt=user_prompt,
                weather_snapshot=weather_snapshot,
                location=location,
            )

        if dashboard_summary:
            weather = dashboard_summary.get("weatherSnapshot") or {}
            zone_health = dashboard_summary.get("zoneHealthSummary") or {}
            financial = dashboard_summary.get("financialSummary") or {}

            parts: list[str] = []
            if weather:
                condition = self._trim_text(weather.get("condition"), default="Unknown")
                temperature_c = self._safe_float(weather.get("temperatureC"), default=0.0)
                rain_in_hours = self._safe_float(weather.get("rainInHours"), default=0.0)
                parts.append(
                    f"Weather: {condition}, {temperature_c:.0f}C, rain in {rain_in_hours:.0f} hours."
                )
            if zone_health:
                parts.append(f"Zone health: {self._trim_text(zone_health.get('status') or zone_health.get('summary'), default='No zone summary available')}.")
            if financial:
                roi_percent = self._safe_float(financial.get("roiPercent"), default=0.0)
                parts.append(f"Expected ROI: {roi_percent:.1f}%.")
            if parts:
                return " ".join(parts)

        if recent_scan.get("has_reports"):
            latest = recent_scan.get("latest_report") or {}
            crop_type = self._trim_text(latest.get("cropType") or latest.get("crop_type"), default="Unknown")
            disease = self._trim_text(latest.get("disease"), default="Unknown")
            severity_score = self._safe_float(latest.get("severityScore"), default=self._safe_float(latest.get("severity"), default=0.0))
            treatment_plan = self._trim_text(latest.get("treatmentPlan") or latest.get("treatment_plan"), default="Review the latest scan.")
            trend = self._trim_text(recent_scan.get("trend"), default="")

            response = f"Latest scan for {crop_type}: {disease} at {severity_score:.0f}% severity. {treatment_plan}"
            if trend:
                response = f"{response} {trend}"
            return response

        if (crop_profiles.get("count") or 0) > 0:
            return f"I found {int(crop_profiles.get('count') or 0)} crop profile(s), but I need a clearer data signal before making a recommendation."

        return build_farmer_fallback_dialogue({}, user_prompt)

    def _weather_unavailable_reply(self, *, user_prompt: str, location: str | None) -> str:
        language = detect_farmer_language(user_prompt)
        location_text = self._trim_text(location, default="")

        if language == "ms":
            if location_text:
                return f"Saya tahu lokasi ladang anda ialah {location_text}, tetapi cuaca belum dapat diambil sekarang."
            return "Saya belum dapat mengambil cuaca sekarang. Sila semak lokasi ladang dalam Settings."

        if location_text:
            return f"I know your farm location is {location_text}, but I could not fetch weather right now."

        return "I could not fetch weather right now. Please check your saved farm location in Settings."

    def _saved_location_reply(
        self,
        *,
        user_prompt: str,
        location: str | None,
        lat: float | None,
        lng: float | None,
    ) -> str:
        language = detect_farmer_language(user_prompt)
        location_text = self._trim_text(location, default="")

        if location_text:
            if lat is not None and lng is not None:
                coordinates = f"{lat:.4f}, {lng:.4f}"
                if language == "ms":
                    return f"Lokasi ladang yang disimpan ialah {location_text} ({coordinates})."
                return f"Your saved farm location is {location_text} ({coordinates})."

            if language == "ms":
                return f"Lokasi ladang yang disimpan ialah {location_text}."
            return f"Your saved farm location is {location_text}."

        if language == "ms":
            return "Lokasi ladang belum disimpan. Sila kemas kini di Settings."

        return "Your farm location is not saved yet. Please update it in Settings."

    def _weather_snapshot_reply(
        self,
        *,
        user_prompt: str,
        weather_snapshot: dict[str, Any],
        location: str | None,
    ) -> str:
        language = detect_farmer_language(user_prompt)
        location_text = self._trim_text(location, default="")
        condition = self._trim_text(weather_snapshot.get("condition"), default="Unknown")
        temperature_c = self._safe_float(weather_snapshot.get("temperatureC"), default=0.0)
        wind_kmh = self._safe_float(weather_snapshot.get("windKmh"), default=0.0)
        rain_in_hours = weather_snapshot.get("rainInHours")
        rain_text = "none expected soon" if rain_in_hours is None else f"rain in about {self._safe_float(rain_in_hours, default=0.0):.0f} hours"
        recommendation = self._trim_text(weather_snapshot.get("recommendation") or weather_snapshot.get("advisory"), default="")
        safe_to_spray = weather_snapshot.get("safeToSpray")

        if language == "ms":
            prefix = f"Untuk {location_text}, " if location_text else ""
            spray_text = "sesuai untuk semburan" if safe_to_spray else "belum selamat untuk semburan"
            return (
                f"{prefix}cuaca {condition}, {temperature_c:.0f}C, angin {wind_kmh:.0f} km/j, dan {rain_text}. "
                f"Ini {spray_text}. {recommendation}".strip()
            )

        prefix = f"For {location_text}, " if location_text else ""
        spray_text = "safe to spray" if safe_to_spray else "not safe to spray yet"
        return (
            f"{prefix}weather is {condition}, {temperature_c:.0f}C, wind is {wind_kmh:.0f} km/h, and {rain_text}. "
            f"It is {spray_text}. {recommendation}".strip()
        )

    def _inventory_fallback(self, *, inventory_summary: dict[str, Any]) -> str:
        items = inventory_summary.get("items") or []
        total_items = int(inventory_summary.get("total_items") or len(items))
        low_stock_count = int(inventory_summary.get("low_stock_count") or 0)

        if not items:
            return "No inventory items were found for this account."

        item_summaries: list[str] = []
        for item in items[:5]:
            if not isinstance(item, dict):
                continue
            name = self._trim_text(
                item.get("name") or item.get("itemName") or item.get("productName") or item.get("item"),
                default="Item",
            )
            quantity_value = item.get("quantity")
            if quantity_value is None:
                quantity_value = item.get("liters")
            quantity = self._safe_optional_float(quantity_value)
            unit = self._trim_text(item.get("unit") or item.get("uom"), default="")
            if quantity is None:
                item_summaries.append(name)
            elif unit:
                item_summaries.append(f"{name} ({quantity:g} {unit})")
            else:
                item_summaries.append(f"{name} ({quantity:g})")

        summary = f"Inventory summary: {total_items} item(s), {low_stock_count} low stock."
        if item_summaries:
            summary = f"{summary} Top items: {', '.join(item_summaries)}."
        if low_stock_count > 0:
            summary = f"{summary} Restock low items soon."
        return summary

    @staticmethod
    def _compact_report(item: dict[str, Any] | None) -> dict[str, Any]:
        if not item:
            return {}

        return {
            "gridId": item.get("gridId"),
            "zone": item.get("zone") or item.get("gridId"),
            "cropType": item.get("cropType") or item.get("crop_type"),
            "disease": item.get("disease"),
            "severity": item.get("severity") or item.get("severityLevel"),
            "severityScore": item.get("severityScore"),
            "treatmentPlan": item.get("treatmentPlan") or item.get("treatment_plan"),
            "recommendedPesticides": item.get("recommendedPesticides") or [],
            "recommendationSource": item.get("recommendationSource"),
            "matchedPestName": item.get("matchedPestName"),
            "survivalProb": item.get("survivalProb"),
            "confidence": item.get("confidence"),
            "lat": item.get("lat"),
            "lng": item.get("lng"),
            "timestamp": item.get("timestamp") or item.get("createdAt") or item.get("lastUpdated"),
        }

    def _low_confidence_fallback(
        self,
        *,
        user_prompt: str,
        scan_result: dict[str, Any] | None = None,
        scan_results: list[dict[str, Any]] | None = None,
    ) -> str:
        current_scan = scan_result or (scan_results[0] if scan_results else {})
        return build_farmer_fallback_dialogue(current_scan, user_prompt, reason="confidence low")

    def _load_reports_sync(self, user_id: str, zone: str | None) -> list[dict[str, Any]]:
        settings = get_settings()
        db = self._get_firestore_client()
        if db is None:
            return []

        reports: list[dict[str, Any]] = []
        try:
            docs = db.collection(settings.FIRESTORE_REPORT_COLLECTION).stream()
        except Exception as exc:
            logger.warning("Failed to load scan reports for supervisor replies: %s", exc)
            return []

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
        for key in ("timestamp", "createdAt", "lastUpdated", "updatedAt"):
            value = item.get(key)
            if hasattr(value, "timestamp"):
                try:
                    return float(value.timestamp())
                except Exception:
                    pass
            if isinstance(value, (int, float)):
                return float(value)
        return 0.0

    def _trend_line(self, reports: list[dict[str, Any]]) -> str:
        if len(reports) < 2:
            return "Trend baseline is limited because only one report is available."

        latest_score = self._safe_float(
            reports[0].get("severityScore"),
            default=self._safe_float(reports[0].get("severity"), default=0.0),
        )
        oldest_score = self._safe_float(
            reports[-1].get("severityScore"),
            default=self._safe_float(reports[-1].get("severity"), default=0.0),
        )
        delta = latest_score - oldest_score

        if delta > 5:
            return "Severity trend has increased; prioritize treatment in the next 24 hours."
        if delta < -5:
            return "Severity trend is improving; continue monitoring and follow-up scans."
        return "Severity trend is stable; monitor closely and keep treatment discipline."
