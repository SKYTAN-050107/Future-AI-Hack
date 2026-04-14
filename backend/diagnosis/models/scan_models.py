"""
Scan models — WebSocket message schemas for the live-scan pipeline.

All models are Pydantic v2 BaseModels used to validate the JSON
messages flowing between the frontend and the ``WS /ws/scan`` endpoint.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Normalised bounding-box coordinates (values in [0, 1])."""

    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., gt=0.0, le=1.0)
    height: float = Field(..., gt=0.0, le=1.0)
    mediapipe_label: str = Field(default="object")
    detection_score: float = Field(default=0.0, ge=0.0, le=1.0)


class ScanRegion(BaseModel):
    """One cropped region from a single bounding box."""

    cropped_image_b64: str = Field(..., description="Base64-encoded cropped image")
    bbox: BoundingBox


class ScanFrame(BaseModel):
    """Inbound WebSocket message — one key-frame with all detected regions."""

    grid_id: str | None = None
    frame_number: int = Field(default=0, ge=0)
    regions: list[ScanRegion] = Field(..., min_length=1)


class ScanResult(BaseModel):
    """Diagnosis output for one cropped region."""

    cropType: str = Field(default="Unknown", description="Type of plant or 'Pest'")
    disease: str = Field(default="Healthy", description="Disease or pest name")
    severity: str = Field(default="Low", description="High, Moderate, or Low")
    severityScore: float = Field(default=0.0, ge=0.0, le=1.0)
    treatmentPlan: str = Field(default="None")
    survivalProb: float = Field(default=1.0, ge=0.0, le=1.0)
    is_abnormal: bool = Field(default=False)
    bbox: BoundingBox


class ScanResponse(BaseModel):
    """Outbound WebSocket message — results for every region in the frame."""

    frame_number: int
    results: list[ScanResult]
