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

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from models.scan_models import (
    BoundingBox,
    HttpScanAssistantRequest,
    HttpScanAssistantResponse,
    HttpScanRequest,
    HttpScanResponse,
    ScanFrame,
    ScanResponse,
    ScanResult,
)
from orchestration.assistant_pipeline import AssistantPipeline
from orchestration.pipeline import LiveScanPipeline
from services.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter()

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
    reason_suffix = f"\n\n附注\n{reason}" if reason else ""
    return (
        f"这是什么\n{result.disease}（作物类型：{result.cropType}，严重度：{result.severity}）\n\n"
        f"治疗方案\n{result.treatmentPlan}\n\n"
        "立即行动\n"
        "1. 先处理最明显病斑区域，避免扩散。\n"
        "2. 保留当前照片并记录位置，方便后续比对。\n\n"
        "复查时间\n24-48小时后复扫同一区域。"
        f"{reason_suffix}"
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

            # ── Process all regions concurrently via ADK pipeline ─────
            tasks = [
                _run_scan_pipeline(
                    cropped_image_b64=region.cropped_image_b64,
                    bbox=region.bbox,
                    grid_id=frame.grid_id,
                )
                for region in frame.regions
            ]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            # ── Build response ────────────────────────────────────────
            results: list[ScanResult] = []
            for i, raw_result in enumerate(raw_results):
                bbox = frame.regions[i].bbox

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
