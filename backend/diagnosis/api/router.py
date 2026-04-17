"""
API router for diagnosis inference.

- POST /api/scan
    Single-frame REST endpoint used by frontend capture flow.
- POST /api/assistant/scan
    Single-frame REST endpoint that returns diagnosis + chatbot reply.
- WS /ws/scan
    Real-time endpoint for multi-region key frames.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from models.scan_models import (
    AssistantMessageRequest,
    AssistantMessageResponse,
    BoundingBox,
    CropCreateRequest,
    CropCreateResponse,
    CropItemResponse,
    CropListResponse,
    CropUpdateRequest,
    CropUpdateResponse,
    DashboardSummaryRequest,
    DashboardSummaryResponse,
    HttpScanAssistantRequest,
    HttpScanAssistantResponse,
    HttpScanAssistantMultiRequest,
    HttpScanAssistantMultiResponse,
    InventoryCreateRequest,
    InventoryCreateResponse,
    InventoryDeleteResponse,
    InventoryListResponse,
    InventoryStockUpdateRequest,
    InventoryStockUpdateResponse,
    InventoryUpdateRequest,
    InventoryUpdateResponse,
    InventoryV1ListResponse,
    HttpScanRequest,
    HttpScanResponse,
    ScanFrame,
    ScanResponse,
    ScanResult,
    ZoneHealthSummaryResponse,
    WeatherV1Response,
    TreatmentPlanRequest,
    TreatmentPlanResponse,
    WeatherOutlookResponse,
)
from orchestration.pipeline import LiveScanPipeline
from services.assistant_message_service import AssistantMessageService
from services.dashboard_service import DashboardService
from services.crop_service import CropService
from services.firestore_service import FirestoreService
from services.inventory_service import InventoryService
from services.region_detection_service import RegionDetectionService
from services.treatment_service import TreatmentService
from services.weather_service import WeatherService

logger = logging.getLogger(__name__)

router = APIRouter()

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

_firestore: FirestoreService | None = None
_firestore_init_error: str | None = None

_weather_service: WeatherService | None = None
_weather_service_init_error: str | None = None

_treatment_service: TreatmentService | None = None
_treatment_service_init_error: str | None = None

_inventory_service: InventoryService | None = None
_inventory_service_init_error: str | None = None

_crop_service: CropService | None = None
_crop_service_init_error: str | None = None

_dashboard_service: DashboardService | None = None
_dashboard_service_init_error: str | None = None

_assistant_message_service: AssistantMessageService | None = None
_assistant_message_service_init_error: str | None = None


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


def _get_weather_service() -> WeatherService | None:
    global _weather_service
    global _weather_service_init_error

    if _weather_service is not None:
        return _weather_service

    if _weather_service_init_error is not None:
        return None

    try:
        _weather_service = WeatherService()
    except Exception as exc:
        _weather_service_init_error = str(exc)
        logger.exception("WeatherService init failed: %s", exc)
        return None

    return _weather_service


def _get_treatment_service() -> TreatmentService | None:
    global _treatment_service
    global _treatment_service_init_error

    if _treatment_service is not None:
        return _treatment_service

    if _treatment_service_init_error is not None:
        return None

    try:
        _treatment_service = TreatmentService()
    except Exception as exc:
        _treatment_service_init_error = str(exc)
        logger.exception("TreatmentService init failed: %s", exc)
        return None

    return _treatment_service


def _get_inventory_service() -> InventoryService | None:
    global _inventory_service
    global _inventory_service_init_error

    if _inventory_service is not None:
        return _inventory_service

    if _inventory_service_init_error is not None:
        return None

    try:
        _inventory_service = InventoryService()
    except Exception as exc:
        _inventory_service_init_error = str(exc)
        logger.exception("InventoryService init failed: %s", exc)
        return None

    return _inventory_service


def _get_crop_service() -> CropService | None:
    global _crop_service
    global _crop_service_init_error

    if _crop_service is not None:
        return _crop_service

    if _crop_service_init_error is not None:
        return None

    try:
        _crop_service = CropService()
    except Exception as exc:
        _crop_service_init_error = str(exc)
        logger.exception("CropService init failed: %s", exc)
        return None

    return _crop_service


def _get_dashboard_service() -> DashboardService | None:
    global _dashboard_service
    global _dashboard_service_init_error

    if _dashboard_service is not None:
        return _dashboard_service

    if _dashboard_service_init_error is not None:
        return None

    try:
        _dashboard_service = DashboardService()
    except Exception as exc:
        _dashboard_service_init_error = str(exc)
        logger.exception("DashboardService init failed: %s", exc)
        return None

    return _dashboard_service


def _get_assistant_message_service() -> AssistantMessageService | None:
    global _assistant_message_service
    global _assistant_message_service_init_error

    if _assistant_message_service is not None:
        return _assistant_message_service

    if _assistant_message_service_init_error is not None:
        return None

    try:
        _assistant_message_service = AssistantMessageService()
    except Exception as exc:
        _assistant_message_service_init_error = str(exc)
        logger.exception("AssistantMessageService init failed: %s", exc)
        return None

    return _assistant_message_service


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


def _error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": message,
            "detail": message,
        },
    )


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


async def _record_abnormal_scan(result: ScanResult, grid_id: str | None, user_id: str | None = None) -> None:
    if not (result.is_abnormal and grid_id):
        return

    firestore = _get_firestore()
    if firestore is None:
        logger.warning("Skip Firestore write because service is unavailable")
        return

    try:
        await firestore.record_scan_result(
            grid_id=grid_id,
            user_id=user_id,
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


async def _run_scan_pipeline(
    cropped_image_b64: str,
    bbox: BoundingBox,
    grid_id: str | None,
) -> dict[str, Any]:
    pipeline = _get_pipeline()
    if pipeline is None:
        reason = _pipeline_init_error or "pipeline unavailable"
        raise RuntimeError(reason)

    try:
        raw_result = await pipeline.run(
            cropped_image_b64=cropped_image_b64,
            bbox=bbox.model_dump(),
            grid_id=grid_id,
        )
        return raw_result
    except Exception as exc:
        logger.exception("Pipeline run failed: %s", exc)
        raise RuntimeError(str(exc)) from exc


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


def _assistant_reply_from_scan(result: ScanResult) -> str:
    """Deterministic assistant reply from real diagnosis result only."""
    severity_percent = _severity_to_percent(result.severityScore, result.severity)
    return (
        f"Detected {result.disease} on {result.cropType}. "
        f"Severity is {severity_percent}% with spread risk {_spread_risk_from_severity(severity_percent)}. "
        f"Recommended action: {result.treatmentPlan}."
    )


def _assistant_reply_from_regions(results: list[ScanResult]) -> str:
    if not results:
        return "No diagnosable crop region was found in this submission."

    summary_parts = []
    for item in results:
        severity_percent = _severity_to_percent(item.severityScore, item.severity)
        summary_parts.append(
            f"{item.cropType}: {item.disease} ({severity_percent}% severity)"
        )

    return (
        "Detected multiple regions. "
        + "; ".join(summary_parts)
        + ". Prioritize treatment for highest-severity regions first."
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
        raw_result = await _run_scan_pipeline(
            cropped_image_b64=_strip_data_url_prefix(payload.base64_image),
            bbox=bbox,
            grid_id=payload.grid_id,
        )
        result = _build_scan_result(raw_result, bbox, 0)
        await _record_abnormal_scan(result, payload.grid_id, payload.user_id)
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
                    user_id=payload.user_id,
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
        raw_result = await _run_scan_pipeline(
            cropped_image_b64=_strip_data_url_prefix(payload.base64_image),
            bbox=bbox,
            grid_id=payload.grid_id,
        )
        result = _build_scan_result(raw_result, bbox, 0)
        await _record_abnormal_scan(result, payload.grid_id, payload.user_id)

        diagnosis = _to_http_scan_response(result, raw_result, payload.grid_id)
        assistant_reply = _assistant_reply_from_scan(result)

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

    first_error = next((item for item in raw_results if isinstance(item, Exception)), None)
    if first_error is not None:
        raise HTTPException(status_code=502, detail=f"Region pipeline failed: {first_error}")

    # Build scan results for each region
    regions_results: list[HttpScanResponse] = []
    region_diagnoses: list[ScanResult] = []

    for i, raw_result in enumerate(raw_results):
        bbox = payload.regions[i].bbox
        if not isinstance(raw_result, dict):
            raise HTTPException(status_code=500, detail="Pipeline returned invalid region result")

        result = _build_scan_result(raw_result, bbox, i)
        regions_results.append(_to_http_scan_response(result, raw_result, payload.grid_id))
        region_diagnoses.append(result)

        # Record abnormal scans
        await _record_abnormal_scan(result, payload.grid_id, payload.user_id)

    consolidated_reply = _assistant_reply_from_regions(region_diagnoses)

    return HttpScanAssistantMultiResponse(
        frame_number=0,
        regions_results=regions_results,
        consolidated_assistant_reply=consolidated_reply,
    )


@router.post("/api/assistant/message", response_model=AssistantMessageResponse)
async def assistant_message(payload: AssistantMessageRequest) -> AssistantMessageResponse:
    """Text-only assistant endpoint backed by real scan history data."""
    service = _get_assistant_message_service()
    if service is None:
        raise HTTPException(
            status_code=503,
            detail=_assistant_message_service_init_error or "assistant message service unavailable",
        )

    try:
        reply = await service.build_reply(
            user_prompt=payload.user_prompt,
            user_id=payload.user_id,
            zone=payload.zone,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Assistant message failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Assistant message failed: {exc}") from exc

    return AssistantMessageResponse(assistant_reply=reply)


@router.get("/api/weather", response_model=WeatherOutlookResponse)
async def weather_outlook(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    days: int = Query(7, ge=1, le=10),
) -> WeatherOutlookResponse | JSONResponse:
    """Real weather outlook endpoint for dashboard and weather pages."""
    service = _get_weather_service()
    if service is None:
        return _error_response(503, _weather_service_init_error or "weather service unavailable")

    try:
        result = await service.get_outlook(lat=lat, lng=lng, days=days)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Weather endpoint failed: %s", exc)
        return _error_response(502, f"Weather service failed: {exc}")

    logger.info(
        "Weather outlook response: lat=%.6f lng=%.6f days=%d safeToSpray=%s rainProbability=%s",
        lat,
        lng,
        days,
        result.get("safeToSpray"),
        result.get("rain_probability"),
    )

    return WeatherOutlookResponse.model_validate(result)


@router.get("/api/v1/weather", response_model=WeatherV1Response)
async def weather_outlook_v1(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    days: int = Query(7, ge=1, le=10),
) -> WeatherV1Response | JSONResponse:
    """Versioned weather endpoint with simplified widget contract fields."""
    service = _get_weather_service()
    if service is None:
        return _error_response(503, _weather_service_init_error or "weather service unavailable")

    try:
        result = await service.get_outlook_v1(lat=lat, lng=lng, days=days)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Weather v1 endpoint failed: %s", exc)
        return _error_response(502, f"Weather service failed: {exc}")

    logger.info(
        "Weather v1 response: lat=%.6f lng=%.6f safe_to_spray=%s",
        lat,
        lng,
        result.get("safe_to_spray"),
    )
    return WeatherV1Response.model_validate(result)



@router.post("/api/treatment", response_model=TreatmentPlanResponse)
async def treatment_plan(payload: TreatmentPlanRequest) -> TreatmentPlanResponse:
    """Real treatment and ROI endpoint backed by market and inventory data."""
    service = _get_treatment_service()
    if service is None:
        raise HTTPException(
            status_code=503,
            detail=_treatment_service_init_error or "treatment service unavailable",
        )

    try:
        result = await service.build_plan(
            crop_id=payload.crop_id,
            user_id=payload.user_id,
            disease=payload.disease,
            crop_type=payload.crop_type,
            treatment_plan=payload.treatment_plan,
            farm_size_hectares=payload.farm_size_hectares,
            survival_prob=payload.survival_prob,
            lat=payload.lat,
            lng=payload.lng,
            treatment_cost_rm=payload.treatment_cost_rm,
            selling_channel=payload.selling_channel,
            market_condition=payload.market_condition,
            manual_price_override=payload.manual_price_override,
            yield_kg=payload.yield_kg,
            actual_sold_kg=payload.actual_sold_kg,
            labor_cost_rm=payload.labor_cost_rm,
            other_costs_rm=payload.other_costs_rm,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Treatment endpoint failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Treatment service failed: {exc}") from exc

    return TreatmentPlanResponse.model_validate(result)


@router.get("/api/inventory", response_model=InventoryListResponse)
async def inventory_list(user_id: str = Query(..., min_length=1)) -> InventoryListResponse | JSONResponse:
    """List user inventory from Firestore."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        result = await service.list_items(user_id=user_id)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory list failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info(
        "Inventory list response: user_id=%s count=%d low_stock=%d",
        user_id,
        len(result.get("items") or []),
        int(result.get("low_stock_count") or 0),
    )

    return InventoryListResponse.model_validate(result)


@router.get("/api/v1/inventory", response_model=InventoryV1ListResponse)
async def inventory_list_v1(user_id: str = Query(..., min_length=1)) -> InventoryV1ListResponse | JSONResponse:
    """List user inventory with canonical v1 schema sorted by updated_at."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        result = await service.list_items_v1(user_id=user_id)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory v1 list failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info("Inventory v1 list response: user_id=%s count=%d", user_id, len(result.get("items") or []))
    return InventoryV1ListResponse.model_validate(result)


@router.post("/api/inventory", response_model=InventoryCreateResponse)
@router.post("/api/v1/inventory", response_model=InventoryCreateResponse)
async def inventory_create(payload: InventoryCreateRequest) -> InventoryCreateResponse | JSONResponse:
    """Create inventory stock item and persist to Firestore."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        created_item = await service.create_item_v1(
            user_id=payload.user_id,
            name=payload.name,
            quantity=payload.quantity,
            usage=payload.usage,
            unit=payload.unit,
            cost_per_unit_rm=payload.cost_per_unit_rm,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory create failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info(
        "Inventory create response: user_id=%s item_id=%s quantity=%.3f unit=%s",
        payload.user_id,
        created_item.get("id"),
        float(created_item.get("quantity") or 0.0),
        created_item.get("unit"),
    )
    return InventoryCreateResponse.model_validate({"success": True, "item": created_item})


@router.patch("/api/v1/inventory/{item_id}", response_model=InventoryStockUpdateResponse)
async def inventory_update_v1(
    item_id: str,
    payload: InventoryStockUpdateRequest,
) -> InventoryStockUpdateResponse | JSONResponse:
    """Delta update inventory stock and prevent negative balances."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        updated_item = await service.update_item_quantity_delta_v1(
            user_id=payload.user_id,
            item_id=item_id,
            quantity_change=payload.quantity_change,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory v1 update failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info(
        "Inventory v1 update response: user_id=%s item_id=%s quantity_change=%.3f",
        payload.user_id,
        item_id,
        payload.quantity_change,
    )
    return InventoryStockUpdateResponse.model_validate({"success": True, "item": updated_item})


@router.patch("/api/inventory/{item_id}", response_model=InventoryUpdateResponse)
async def inventory_update(item_id: str, payload: InventoryUpdateRequest) -> InventoryUpdateResponse | JSONResponse:
    """Update user inventory liters for a specific item."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        result = await service.update_item_liters(
            user_id=payload.user_id,
            item_id=item_id,
            liters=payload.liters,
            description=payload.description,
            unit_cost_rm=payload.unit_cost_rm,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory update failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info(
        "Inventory legacy update response: user_id=%s item_id=%s liters=%.3f",
        payload.user_id,
        item_id,
        payload.liters,
    )

    return InventoryUpdateResponse.model_validate(result)


@router.delete("/api/inventory/{item_id}", response_model=InventoryDeleteResponse)
@router.delete("/api/v1/inventory/{item_id}", response_model=InventoryDeleteResponse)
async def inventory_delete(item_id: str, user_id: str = Query(..., min_length=1)) -> InventoryDeleteResponse | JSONResponse:
    """Delete a user inventory item."""
    service = _get_inventory_service()
    if service is None:
        return _error_response(503, _inventory_service_init_error or "inventory service unavailable")

    try:
        result = await service.delete_item_v1(
            user_id=user_id,
            item_id=item_id,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Inventory delete failed: %s", exc)
        return _error_response(502, f"Inventory service failed: {exc}")

    logger.info(
        "Inventory delete response: user_id=%s item_id=%s",
        user_id,
        item_id,
    )

    return InventoryDeleteResponse.model_validate(result)


@router.get("/api/crops", response_model=CropListResponse)
async def crop_list(user_id: str = Query(..., min_length=1)) -> CropListResponse | JSONResponse:
    """List user crops from Firestore."""
    service = _get_crop_service()
    if service is None:
        return _error_response(503, _crop_service_init_error or "crop service unavailable")

    try:
        result = await service.list_crops(user_id=user_id)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Crop list failed: %s", exc)
        return _error_response(502, f"Crop service failed: {exc}")

    logger.info(
        "Crop list response: user_id=%s count=%d",
        user_id,
        len(result.get("items") or []),
    )
    return CropListResponse.model_validate(result)


@router.get("/api/crops/{crop_id}", response_model=CropItemResponse)
async def crop_get(crop_id: str, user_id: str = Query(..., min_length=1)) -> CropItemResponse | JSONResponse:
    """Get a crop by id for ROI workflows."""
    service = _get_crop_service()
    if service is None:
        return _error_response(503, _crop_service_init_error or "crop service unavailable")

    try:
        result = await service.get_crop(user_id=user_id, crop_id=crop_id)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Crop get failed: %s", exc)
        return _error_response(502, f"Crop service failed: {exc}")

    logger.info("Crop get response: user_id=%s crop_id=%s", user_id, crop_id)
    return CropItemResponse.model_validate(result)


@router.post("/api/crops", response_model=CropCreateResponse)
async def crop_create(payload: CropCreateRequest) -> CropCreateResponse | JSONResponse:
    """Create a crop profile under users/{uid}/crops."""
    service = _get_crop_service()
    if service is None:
        return _error_response(503, _crop_service_init_error or "crop service unavailable")

    try:
        created_item = await service.create_crop(
            user_id=payload.user_id,
            name=payload.name,
            expected_yield_kg=payload.expected_yield_kg,
            area_hectares=payload.area_hectares,
            planting_date=payload.planting_date,
            status=payload.status,
            crop_inventory_usage=[item.model_dump() for item in payload.crop_inventory_usage],
            labor_cost_rm=payload.labor_cost_rm,
            other_costs_rm=payload.other_costs_rm,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Crop create failed: %s", exc)
        return _error_response(502, f"Crop service failed: {exc}")

    logger.info("Crop create response: user_id=%s crop_id=%s", payload.user_id, created_item.get("id"))
    return CropCreateResponse.model_validate({"success": True, "item": created_item})


@router.patch("/api/crops/{crop_id}", response_model=CropUpdateResponse)
async def crop_update(crop_id: str, payload: CropUpdateRequest) -> CropUpdateResponse | JSONResponse:
    """Update crop profile fields and linked inventory usage."""
    service = _get_crop_service()
    if service is None:
        return _error_response(503, _crop_service_init_error or "crop service unavailable")

    usage_payload = None
    if payload.crop_inventory_usage is not None:
        usage_payload = [item.model_dump() for item in payload.crop_inventory_usage]

    try:
        updated_item = await service.update_crop(
            user_id=payload.user_id,
            crop_id=crop_id,
            name=payload.name,
            expected_yield_kg=payload.expected_yield_kg,
            area_hectares=payload.area_hectares,
            planting_date=payload.planting_date,
            status=payload.status,
            crop_inventory_usage=usage_payload,
            labor_cost_rm=payload.labor_cost_rm,
            other_costs_rm=payload.other_costs_rm,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Crop update failed: %s", exc)
        return _error_response(502, f"Crop service failed: {exc}")

    logger.info("Crop update response: user_id=%s crop_id=%s", payload.user_id, crop_id)
    return CropUpdateResponse.model_validate({"success": True, "item": updated_item})


@router.get("/api/zones", response_model=ZoneHealthSummaryResponse)
@router.get("/api/zones/summary", response_model=ZoneHealthSummaryResponse)
@router.get("/api/v1/zones/summary", response_model=ZoneHealthSummaryResponse)
async def zones_summary(user_id: str | None = Query(default=None, min_length=1)) -> ZoneHealthSummaryResponse | JSONResponse:
    """Fetch real-time zone health counters from Firestore grids."""
    service = _get_dashboard_service()
    if service is None:
        return _error_response(503, _dashboard_service_init_error or "dashboard service unavailable")

    try:
        result = await service.get_zone_summary_counts(user_id=user_id)
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Zones summary failed: %s", exc)
        return _error_response(502, f"Zones summary failed: {exc}")

    logger.info(
        "Zones summary response: user_id=%s total=%d healthy=%d warning=%d unhealthy=%d",
        user_id or "all",
        result.get("total_zones", 0),
        result.get("healthy", 0),
        result.get("warning", 0),
        result.get("unhealthy", 0),
    )
    return ZoneHealthSummaryResponse.model_validate(result)


@router.post("/api/dashboard/summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(payload: DashboardSummaryRequest) -> DashboardSummaryResponse | JSONResponse:
    """Aggregate dashboard metrics from real backend services."""
    service = _get_dashboard_service()
    if service is None:
        return _error_response(503, _dashboard_service_init_error or "dashboard service unavailable")

    try:
        result = await service.build_summary(
            user_id=payload.user_id,
            crop_type=payload.crop_type,
            treatment_plan=payload.treatment_plan,
            farm_size_hectares=payload.farm_size_hectares,
            survival_prob=payload.survival_prob,
            lat=payload.lat,
            lng=payload.lng,
        )
    except ValueError as exc:
        return _error_response(400, str(exc))
    except Exception as exc:
        logger.exception("Dashboard summary failed: %s", exc)
        return _error_response(502, f"Dashboard service failed: {exc}")

    logger.info("Dashboard summary response: user_id=%s", payload.user_id)

    return DashboardSummaryResponse.model_validate(result)


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

                region_detector = _get_region_detector()
                if region_detector is None:
                    await websocket.send_json(
                        {
                            "error": (
                                "Region detector unavailable. "
                                "Send pre-cropped regions or configure Gemini region detection."
                            )
                        }
                    )
                    continue

                try:
                    frame_regions = await region_detector.detect_regions(
                        base64_image=_strip_data_url_prefix(frame.base64_image)
                    )
                except Exception as detect_exc:
                    logger.exception("WS region detection failed: %s", detect_exc)
                    await websocket.send_json(
                        {"error": f"Region detection failed: {detect_exc}"}
                    )
                    continue

            # ── Process all regions concurrently via ADK pipeline ─────
            tasks = [
                _run_scan_pipeline(
                    cropped_image_b64=region.cropped_image_b64,
                    bbox=region.bbox,
                    grid_id=frame.grid_id,
                )
                for region in frame_regions
            ]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            first_error = next((item for item in raw_results if isinstance(item, Exception)), None)
            if first_error is not None:
                await websocket.send_json({"error": f"Pipeline run failed: {first_error}"})
                continue

            # ── Build response ────────────────────────────────────────
            results: list[ScanResult] = []
            for i, raw_result in enumerate(raw_results):
                bbox = frame_regions[i].bbox

                if not isinstance(raw_result, dict):
                    await websocket.send_json({"error": "Pipeline returned invalid result payload"})
                    results = []
                    break

                result = _build_scan_result(raw_result, bbox, i)
                results.append(result)

                # ── Firestore write-back for abnormal results ─────────
                await _record_abnormal_scan(result, frame.grid_id)

            if not results:
                continue

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
