"""
API router for the plant diagnosis endpoint.

Exposes:
    POST /analyze — multipart/form-data with optional image and text

The router is intentionally thin: it handles HTTP concerns (file
upload parsing, validation errors) and delegates all logic to the
``DiagnosisPipeline``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from models.request import AnalyzeRequest
from models.response import AnalyzeResponse
from orchestration.pipeline import DiagnosisPipeline

logger = logging.getLogger(__name__)

router = APIRouter()

# Pipeline is initialized once and reused across requests.
_pipeline = DiagnosisPipeline()


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze a plant image and/or text for disease diagnosis",
    description=(
        "Accepts an image file and/or text description. "
        "Returns structured diagnosis with confidence and reasoning."
    ),
)
async def analyze(
    image: UploadFile | None = File(None, description="Plant image to analyze"),
    text: str | None = Form(None, description="Text description of symptoms"),
) -> AnalyzeResponse:
    """Plant diagnosis analysis endpoint.

    Accepts ``multipart/form-data`` with:
    - ``image``: optional uploaded image file
    - ``text``: optional text description

    At least one of ``image`` or ``text`` must be provided.

    Returns a JSON response with:
    - ``result``: best diagnosis match
    - ``confidence``: float [0.0, 1.0]
    - ``reason``: LLM-generated reasoning
    - ``alternatives``: list of other plausible matches
    """
    # ── Read image bytes if provided ──────────────────────────────
    image_bytes: bytes | None = None
    image_filename: str | None = None

    if image is not None:
        image_bytes = await image.read()
        image_filename = image.filename

        if not image_bytes:
            raise HTTPException(
                status_code=400,
                detail="Uploaded image file is empty.",
            )

    # ── Validate at least one input ───────────────────────────────
    if image_bytes is None and not text:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'image' or 'text' must be provided.",
        )

    # ── Build request model ───────────────────────────────────────
    request = AnalyzeRequest(
        image_bytes=image_bytes,
        image_filename=image_filename,
        text=text,
    )

    # ── Execute pipeline ──────────────────────────────────────────
    try:
        response = await _pipeline.run(request)
    except Exception as exc:
        logger.exception("Pipeline execution failed")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {exc}",
        ) from exc

    return response
