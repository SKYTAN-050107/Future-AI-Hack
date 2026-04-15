"""
API router for diagnosis inference.

- POST /api/scan
    Single-frame REST endpoint used by frontend capture flow.
- POST /api/assistant/scan
    Single-frame REST endpoint that returns diagnosis + chatbot reply.
- GET /api/weather
    Dashboard weather intelligence endpoint (Meteorologist Agent).
- WS /ws/scan
    Real-time endpoint for multi-region key frames.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from config import get_settings
from models.scan_models import (
    BoundingBox,
    HttpScanAssistantRequest,
    HttpScanAssistantResponse,
    HttpScanAssistantMultiRequest,
    HttpScanAssistantMultiResponse,
    HttpScanRequest,
    HttpScanResponse,
    ScanFrame,
    ScanRegion,
    ScanResponse,
    ScanResult,
)
from orchestration.assistant_pipeline import AssistantPipeline
from orchestration.pipeline import LiveScanPipeline
from services.firestore_service import FirestoreService
from services.llm_service import LLMService, build_farmer_fallback_dialogue
from services.region_detection_service import RegionDetectionService

logger = logging.getLogger(__name__)

router = APIRouter()
_settings = get_settings()

# ── Allow imports from the sibling swarm package ──────────────────────
_swarm_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "swarm"))
if _swarm_dir not in sys.path:
    sys.path.insert(0, _swarm_dir)


# ── Weather dashboard helpers ─────────────────────────────────────────

class WeatherDashboardResponse(BaseModel):
    """Structured response for the frontend Dashboard weather card."""
    condition: str
    temperatureC: int
    windKmh: int
    windDirection: str
    rainInHours: float
    safeToSpray: bool


def _determine_condition(precip_prob: float, wind_kmh: float) -> str:
    """Deterministic condition string from precipitation probability."""
    if precip_prob > 80:
        return "Heavy Rain"
    if precip_prob > 50:
        return "Passing Rain"
    if precip_prob > 20:
        return "Light Rain"
    if precip_prob > 5:
        return "Cloudy"
    if wind_kmh > 20:
        return "Windy"
    return "Clear"


def _degrees_to_compass(degrees: int) -> str:
    """Convert wind direction degrees (0-360) to a compass abbreviation."""
    directions = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ]
    index = int((degrees / 22.5) + 0.5) % 16
    return directions[index]


_region_detector: RegionDetectionService | None = None
_region_detector_init_error: str | None = None


def _get_region_detector() -> RegionDetectionService | None:
    global _region_detector
    global _region_detector_init_error

    if _region_detector is not None:
        return _region_detector

    if _region_detector_init_error is not None:
        return None

    try:
        _region_detector = RegionDetectionService()
    except Exception as exc:
        _region_detector_init_error = str(exc)
        logger.exception("RegionDetectionService init failed: %s", exc)
        return None

    return _region_detector

_pipeline: LiveScanPipeline | None = None
_pipeline_init_error: str | None = None

_assistant_pipeline: AssistantPipeline | None = None
_assistant_pipeline_init_error: str | None = None

_firestore: FirestoreService | None = None
_firestore_init_error: str | None = None


def _get_pipeline() -> LiveScanPipeline | None:
    global _pipeline
    global _pipeline_init_error

    if _pipeline is not None:
        return _pipeline

    if _pipeline_init_error is not None:
        return None

    try:
        _pipeline = LiveScanPipeline()
    except Exception as exc:
        _pipeline_init_error = str(exc)
        logger.exception("LiveScanPipeline init failed: %s", exc)
        return None

    return _pipeline


def _get_assistant_pipeline() -> AssistantPipeline | None:
    global _assistant_pipeline
    global _assistant_pipeline_init_error

    if _assistant_pipeline is not None:
        return _assistant_pipeline

    if _assistant_pipeline_init_error is not None:
        return None

    try:
        _assistant_pipeline = AssistantPipeline()
    except Exception as exc:
        _assistant_pipeline_init_error = str(exc)
        logger.exception("AssistantPipeline init failed: %s", exc)
        return None

    return _assistant_pipeline


def _get_firestore() -> FirestoreService | None:
    global _firestore
    global _firestore_init_error

    if _firestore is not None:
        return _firestore

    if _firestore_init_error is not None:
        return None

    try:
        _firestore = FirestoreService()
    except Exception as exc:
        _firestore_init_error = str(exc)
        logger.exception("FirestoreService init failed: %s", exc)
        return None

    return _firestore


def _strip_data_url_prefix(value: str) -> str:
    """Accept either raw base64 or data URL from browser captures."""
    if value.startswith("data:") and "," in value:
        return value.split(",", 1)[1]
    return value


def _clamp_percent(value: float) -> int:
    return max(0, min(100, int(round(value))))


def _severity_to_percent(score: float, level: str) -> int:
    if score > 0:
        return _clamp_percent(score * 100)

    level_lower = level.lower().strip()
    if level_lower == "high":
        return 80
    if level_lower == "moderate":
        return 55
    if level_lower == "low":
        return 20
    return 0


def _confidence_to_percent(raw_result: dict[str, Any], fallback_score: float) -> int:
    for key in ("confidence", "matchScore", "vectorScore"):
        candidate = raw_result.get(key)
        if isinstance(candidate, (int, float)):
            value = float(candidate)
            return _clamp_percent(value * 100 if value <= 1 else value)

    if fallback_score > 0:
        return _clamp_percent(fallback_score * 100)

    return 35


def _spread_risk_from_severity(severity_percent: int) -> str:
    if severity_percent >= 70:
        return "High"
    if severity_percent >= 40:
        return "Medium"
    return "Low"


def _build_scan_result(raw_result: Any, bbox: BoundingBox, region_index: int) -> ScanResult:
    if isinstance(raw_result, Exception):
        logger.error("Region %d failed: %s", region_index, raw_result)
        return ScanResult(
            cropType="Error",
            disease=str(raw_result),
            severity="Low",
            severityScore=0.0,
            treatmentPlan="None",
            survivalProb=0.0,
            bbox=bbox,
        )

    if not isinstance(raw_result, dict):
        return ScanResult(
            cropType="Error",
            disease="Unexpected pipeline output",
            severity="Low",
            severityScore=0.0,
            treatmentPlan="None",
            survivalProb=0.0,
            bbox=bbox,
        )

    return ScanResult(
        cropType=str(raw_result.get("cropType", "Unknown")),
        disease=str(raw_result.get("disease", "Unknown")),
        severity=str(raw_result.get("severity", "Moderate")),
        severityScore=float(raw_result.get("severityScore", 0.0)),
        treatmentPlan=str(raw_result.get("treatmentPlan", "Consult Agrologist")),
        survivalProb=float(raw_result.get("survivalProb", 1.0)),
        is_abnormal=bool(raw_result.get("is_abnormal", False)),
        bbox=bbox,
    )


async def _record_abnormal_scan(result: ScanResult, grid_id: str | None) -> None:
    if not (result.is_abnormal and grid_id):
        return

    firestore = _get_firestore()
    if firestore is None:
        logger.warning("Skip Firestore write because service is unavailable")
        return

    try:
        await firestore.record_scan_result(
            grid_id=grid_id,
            cropType=result.cropType,
            disease=result.disease,
            severity=result.severity,
            severityScore=result.severityScore,
            treatmentPlan=result.treatmentPlan,
            survivalProb=result.survivalProb,
            is_abnormal=result.is_abnormal,
        )
    except Exception as fs_err:
        logger.error("Firestore write failed: %s", fs_err)


def _fallback_raw_result(reason: str) -> dict[str, Any]:
    return {
        "cropType": "Unknown",
        "disease": "Unknown",
        "severity": "Moderate",
        "severityScore": 0.0,
        "treatmentPlan": (
            "Diagnosis backend is reachable but cloud diagnosis services are unavailable. "
            f"Reason: {reason}"
        ),
        "survivalProb": 0.5,
        "is_abnormal": False,
    }


async def _run_scan_pipeline(
    cropped_image_b64: str,
    bbox: BoundingBox,
    grid_id: str | None,
) -> tuple[Any, str | None]:
    pipeline = _get_pipeline()
    if pipeline is None:
        reason = _pipeline_init_error or "pipeline unavailable"
        return _fallback_raw_result(reason), reason

    try:
        raw_result = await pipeline.run(
            cropped_image_b64=cropped_image_b64,
            bbox=bbox.model_dump(),
            grid_id=grid_id,
        )
        return raw_result, None
    except Exception as exc:
        logger.exception("Pipeline run failed: %s", exc)
        reason = str(exc)
        return _fallback_raw_result(reason), reason


def _to_http_scan_response(
    result: ScanResult,
    raw_result: Any,
    grid_id: str | None,
) -> HttpScanResponse:
    severity_percent = _severity_to_percent(result.severityScore, result.severity)
    confidence = _confidence_to_percent(
        raw_result if isinstance(raw_result, dict) else {},
        result.severityScore,
    )

    return HttpScanResponse(
        disease=result.disease,
        severity=severity_percent,
        confidence=confidence,
        spread_risk=_spread_risk_from_severity(severity_percent),
        zone=grid_id,
        crop_type=result.cropType,
        treatment_plan=result.treatmentPlan,
    )


def _build_assistant_fallback_reply(
    result: ScanResult,
    reason: str | None = None,
) -> str:
    """Build fallback assistant reply using the new language-aware function."""
    return build_farmer_fallback_dialogue(
        scan_result=result.model_dump(),
        user_prompt="I just took this photo. Please explain what was detected.",
        reason=reason,
    )


@router.post("/api/scan", response_model=HttpScanResponse)
async def scan_once(payload: HttpScanRequest) -> HttpScanResponse:
    """Single-frame diagnosis endpoint for frontend camera captures."""
    bbox = BoundingBox(
        x=0.0,
        y=0.0,
        width=1.0,
        height=1.0,
        mediapipe_label="leaf",
        detection_score=1.0,
    )

    try:
        raw_result, _ = await _run_scan_pipeline(
            cropped_image_b64=_strip_data_url_prefix(payload.base64_image),
            bbox=bbox,
            grid_id=payload.grid_id,
        )
        result = _build_scan_result(raw_result, bbox, 0)
        await _record_abnormal_scan(result, payload.grid_id)
        return _to_http_scan_response(result, raw_result, payload.grid_id)
    except Exception as exc:
        logger.exception("HTTP scan failed: %s", exc)
        raise HTTPException(status_code=500, detail="Scan failed") from exc


@router.post("/api/assistant/scan", response_model=HttpScanAssistantResponse)
async def scan_and_chat(payload: HttpScanAssistantRequest) -> HttpScanAssistantResponse:
    """Scan a capture and generate chatbot dialogue from diagnosis result."""
    # Try to auto-detect multiple regions in the image for multi-crop analysis
    region_detector = _get_region_detector()
    if region_detector:
        try:
            detected_regions = await region_detector.detect_regions(
                base64_image=_strip_data_url_prefix(payload.base64_image)
            )
            if len(detected_regions) > 1:
                # If multiple regions detected, use multi-region endpoint
                logger.info("Auto-detected %d regions in image, using multi-region analysis", len(detected_regions))
                multi_payload = HttpScanAssistantMultiRequest(
                    source=payload.source,
                    grid_id=payload.grid_id,
                    regions=detected_regions,
                    user_prompt=payload.user_prompt,
                )
                multi_response = await scan_and_chat_multi(multi_payload)
                # Convert multi-response to single-response format (use first region)
                first_result = multi_response.regions_results[0] if multi_response.regions_results else HttpScanResponse(
                    disease="Unknown",
                    severity=0,
                    confidence=0,
                    spread_risk="Low",
                )
                return HttpScanAssistantResponse(
                    **first_result.model_dump(),
                    assistant_reply=multi_response.consolidated_assistant_reply,
                )
        except Exception as e:
            logger.warning("Auto-detect regions failed, falling back to single-region: %s", e)

    # Fallback to single full-image region
    bbox = BoundingBox(
        x=0.0,
        y=0.0,
        width=1.0,
        height=1.0,
        mediapipe_label="leaf",
        detection_score=1.0,
    )

    try:
        raw_result, pipeline_error = await _run_scan_pipeline(
            cropped_image_b64=_strip_data_url_prefix(payload.base64_image),
            bbox=bbox,
            grid_id=payload.grid_id,
        )
        result = _build_scan_result(raw_result, bbox, 0)
        await _record_abnormal_scan(result, payload.grid_id)

        diagnosis = _to_http_scan_response(result, raw_result, payload.grid_id)
        assistant_pipeline = _get_assistant_pipeline()

        if assistant_pipeline is None:
            assistant_reason = _assistant_pipeline_init_error or "assistant pipeline unavailable"
            assistant_reply = _build_assistant_fallback_reply(result, assistant_reason)
        else:
            try:
                assistant_reply = await assistant_pipeline.run(
                    scan_result=result.model_dump(),
                    user_prompt=payload.user_prompt,
                )
            except Exception as assistant_exc:
                logger.exception("Assistant pipeline run failed: %s", assistant_exc)
                assistant_reply = _build_assistant_fallback_reply(result, str(assistant_exc))

        if pipeline_error:
            assistant_reply = _build_assistant_fallback_reply(
                result,
                "诊断正在降级模式运行，建议先按复拍流程确认后再做最终施药决策。",
            )

        return HttpScanAssistantResponse(
            **diagnosis.model_dump(),
            assistant_reply=assistant_reply,
        )
    except Exception as exc:
        logger.exception("Assistant scan failed: %s", exc)
        raise HTTPException(status_code=500, detail="Assistant scan failed") from exc


@router.post("/api/assistant/scan-multi", response_model=HttpScanAssistantMultiResponse)
async def scan_and_chat_multi(payload: HttpScanAssistantMultiRequest) -> HttpScanAssistantMultiResponse:
    """Multi-region scan and chatbot dialogue for photos with multiple plants.

    Each region is processed independently, then a consolidated assistant
    reply is generated addressing all detected crops.
    """
    # Process all regions concurrently through pipeline
    tasks = [
        _run_scan_pipeline(
            cropped_image_b64=_strip_data_url_prefix(region.cropped_image_b64),
            bbox=region.bbox,
            grid_id=payload.grid_id,
        )
        for region in payload.regions
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Build scan results for each region
    regions_results: list[HttpScanResponse] = []
    region_diagnoses: list[dict[str, Any]] = []

    for i, raw_result in enumerate(raw_results):
        bbox = payload.regions[i].bbox
        pipeline_error = None

        if isinstance(raw_result, tuple):
            raw_result, pipeline_error = raw_result
        elif isinstance(raw_result, Exception):
            raw_result = _fallback_raw_result(str(raw_result))

        result = _build_scan_result(raw_result, bbox, i)
        regions_results.append(_to_http_scan_response(result, raw_result, payload.grid_id))
        region_diagnoses.append(result.model_dump())

        # Record abnormal scans
        await _record_abnormal_scan(result, payload.grid_id)

    # Generate consolidated assistant dialogue
    assistant_pipeline = _get_assistant_pipeline()

    if assistant_pipeline is None:
        assistant_reason = _assistant_pipeline_init_error or "assistant pipeline unavailable"
        consolidated_reply = build_farmer_fallback_dialogue(
            region_diagnoses[0] if region_diagnoses else {},
            payload.user_prompt,
            assistant_reason,
        )
    else:
        try:
            llm_svc = LLMService()
            consolidated_reply = await llm_svc.generate_consolidated_assistant_dialogue(
                scan_results=region_diagnoses,
                user_prompt=payload.user_prompt,
            )
        except Exception as exc:
            logger.exception("Consolidated dialogue generation failed: %s", exc)
            consolidated_reply = build_farmer_fallback_dialogue(
                region_diagnoses[0] if region_diagnoses else {},
                payload.user_prompt,
                str(exc),
            )

    return HttpScanAssistantMultiResponse(
        frame_number=0,
        regions_results=regions_results,
        consolidated_assistant_reply=consolidated_reply,
    )


@router.websocket("/ws/scan")
async def live_scan(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time plant scanning.

    Each message contains all cropped regions from one camera key-frame.
    Regions are processed CONCURRENTLY through the ADK pipeline.
    """
    await websocket.accept()
    logger.info("Scanner connected")

    try:
        while True:
            raw = await websocket.receive_text()

            # ── Parse frame ───────────────────────────────────────────
            try:
                frame = ScanFrame.model_validate_json(raw)
            except Exception as e:
                await websocket.send_json({"error": f"Invalid frame: {e}"})
                continue

            frame_regions = list(frame.regions)
            if not frame_regions:
                if not frame.base64_image:
                    await websocket.send_json(
                        {"error": "Frame must include either regions or base64_image"}
                    )
                    continue

                normalized_base64 = _strip_data_url_prefix(frame.base64_image)
                fallback_region = ScanRegion(
                    cropped_image_b64=normalized_base64,
                    bbox=BoundingBox(
                        x=0.0,
                        y=0.0,
                        width=1.0,
                        height=1.0,
                        mediapipe_label="leaf",
                        detection_score=1.0,
                    ),
                )

                if _settings.WS_AUTO_REGION_DETECTION:
                    region_detector = _get_region_detector()
                    if region_detector is None:
                        logger.warning(
                            "WS region detector unavailable, falling back to full-frame scan"
                        )
                        frame_regions = [fallback_region]
                    else:
                        try:
                            detected_regions = await asyncio.wait_for(
                                region_detector.detect_regions(base64_image=normalized_base64),
                                timeout=float(_settings.WS_REGION_DETECTION_TIMEOUT_SECONDS),
                            )
                            frame_regions = detected_regions or [fallback_region]
                        except asyncio.TimeoutError:
                            logger.warning(
                                "WS region detection timed out after %.1fs; using full-frame scan",
                                _settings.WS_REGION_DETECTION_TIMEOUT_SECONDS,
                            )
                            frame_regions = [fallback_region]
                        except Exception as detect_exc:
                            logger.exception("WS region detection failed: %s", detect_exc)
                            frame_regions = [fallback_region]
                else:
                    frame_regions = [fallback_region]

            if not frame_regions:
                await websocket.send_json({"error": "No scan region available for this frame"})
                continue

            normalized_regions: list[tuple[ScanRegion, str]] = []
            for region in frame_regions:
                normalized_region_b64 = _strip_data_url_prefix(region.cropped_image_b64)
                if normalized_region_b64:
                    normalized_regions.append((region, normalized_region_b64))

            if not normalized_regions:
                await websocket.send_json({"error": "No valid scan region payload for this frame"})
                continue

            # ── Process all regions concurrently via ADK pipeline ─────
            tasks = [
                _run_scan_pipeline(
                    cropped_image_b64=region_b64,
                    bbox=region.bbox,
                    grid_id=frame.grid_id,
                )
                for region, region_b64 in normalized_regions
            ]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            # ── Build response ────────────────────────────────────────
            results: list[ScanResult] = []
            for i, raw_result in enumerate(raw_results):
                bbox = normalized_regions[i][0].bbox

                if isinstance(raw_result, tuple):
                    raw_result = raw_result[0]

                result = _build_scan_result(raw_result, bbox, i)
                results.append(result)

                # ── Firestore write-back for abnormal results ─────────
                await _record_abnormal_scan(result, frame.grid_id)

            # ── Send results ──────────────────────────────────────────
            response = ScanResponse(
                frame_number=frame.frame_number,
                results=results,
            )
            await websocket.send_text(response.model_dump_json())

    except WebSocketDisconnect:
        logger.info("Scanner disconnected")
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass


# ── Meteorologist Agent: Dashboard Weather Endpoint ───────────────────

@router.get("/api/weather", response_model=WeatherDashboardResponse)
async def get_dashboard_weather(
    lat: float = Query(..., description="Latitude of the farm or user location"),
    lng: float = Query(..., description="Longitude of the farm or user location"),
) -> WeatherDashboardResponse:
    """Fetch live weather data from Tomorrow.io via the swarm weather tool
    and return a fast, deterministic summary for the Dashboard card."""
    try:
        from tools.weather_tool import fetch_weather, WeatherInput

        weather_out = await fetch_weather(WeatherInput(lat=lat, lng=lng))

        w = weather_out["weather"]
        safe_to_spray = weather_out["safe_to_spray"]

        precip_prob = w.get("precipitation_probability", 0)
        wind_kmh = w.get("wind_speed_kmh", 0)
        temp_c = w.get("temperature_c", 0)
        wind_deg = w.get("wind_direction_degrees", 0)
        rain_hr = w.get("rain_expected_within_hours")

        return WeatherDashboardResponse(
            condition=_determine_condition(precip_prob, wind_kmh),
            temperatureC=int(temp_c),
            windKmh=int(wind_kmh),
            windDirection=_degrees_to_compass(wind_deg),
            rainInHours=float(rain_hr) if rain_hr is not None else 24.0,
            safeToSpray=bool(safe_to_spray),
        )
    except Exception as exc:
        logger.exception("Weather fetch failed: %s", exc)
        raise HTTPException(status_code=500, detail="Weather fetch failed") from exc
