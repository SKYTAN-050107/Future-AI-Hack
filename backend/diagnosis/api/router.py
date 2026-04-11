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
                        label="Error",
                        confidence=0.0,
                        reason=str(raw_result),
                        bbox=bbox,
                    ))
                    continue

                result = ScanResult(
                    label=raw_result.get("label", "Unknown"),
                    confidence=raw_result.get("confidence", 0.0),
                    reason=raw_result.get("reason", ""),
                    severity=raw_result.get("severity", "unknown"),
                    is_abnormal=raw_result.get("is_abnormal", False),
                    bbox=bbox,
                    alternatives=raw_result.get("alternatives", []),
                )
                results.append(result)

                # ── Firestore write-back for abnormal results ─────────
                if result.is_abnormal and frame.grid_id:
                    try:
                        await _firestore.record_scan_result(
                            grid_id=frame.grid_id,
                            label=result.label,
                            confidence=result.confidence,
                            severity=result.severity,
                            is_abnormal=True,
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
