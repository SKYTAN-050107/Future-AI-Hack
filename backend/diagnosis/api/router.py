"""
API router — WebSocket endpoint for real-time live scanning.

WS /ws/scan
    Receives ``ScanFrame`` JSON (multiple cropped regions per message).
    Processes each region through the Google ADK ``LiveScanPipeline``.
    Responds with ``ScanResponse`` JSON (labels for every region).
    Abnormal results are written to Firestore (triggers grid propagation).
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from models.scan_models import ScanFrame, ScanResult, ScanResponse
from orchestration.pipeline import LiveScanPipeline
from services.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter()

_pipeline = LiveScanPipeline()
_firestore = FirestoreService()


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
                _pipeline.run(
                    cropped_image_b64=region.cropped_image_b64,
                    bbox=region.bbox.model_dump(),
                    grid_id=frame.grid_id,
                )
                for region in frame.regions
            ]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            # ── Build response ────────────────────────────────────────
            results: list[ScanResult] = []
            for i, raw_result in enumerate(raw_results):
                bbox = frame.regions[i].bbox

                if isinstance(raw_result, Exception):
                    logger.error("Region %d failed: %s", i, raw_result)
                    results.append(ScanResult(
                        cropType="Error",
                        disease=str(raw_result),
                        severity="Low",
                        severityScore=0.0,
                        treatmentPlan="None",
                        survivalProb=0.0,
                        bbox=bbox,
                    ))
                    continue

                result = ScanResult(
                    cropType=str(raw_result.get("cropType", "Unknown")),
                    disease=str(raw_result.get("disease", "Unknown")),
                    severity=str(raw_result.get("severity", "Moderate")),
                    severityScore=float(raw_result.get("severityScore", 0.0)),
                    treatmentPlan=str(raw_result.get("treatmentPlan", "Consult Agrologist")),
                    survivalProb=float(raw_result.get("survivalProb", 1.0)),
                    is_abnormal=bool(raw_result.get("is_abnormal", False)),
                    bbox=bbox,
                )
                results.append(result)

                # ── Firestore write-back for abnormal results ─────────
                if result.is_abnormal and frame.grid_id:
                    try:
                        await _firestore.record_scan_result(
                            grid_id=frame.grid_id,
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
