"""
Region detection service using Gemini 2.0 Flash to identify one primary crop region in a photo.

Detects a single bounding box for the most prominent plant/crop/pest in an image,
so the live scanner can focus on one target at a time.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from google import genai
from google.genai import types

from config import get_settings
from models.scan_models import BoundingBox, HttpScanRegion
from services.json_utils import extract_json_payload

logger = logging.getLogger(__name__)

REGION_DETECTION_SYSTEM_PROMPT = """\
You are a crop region detection system for agricultural imagery.

Your job is to:
1. Analyze a farm/garden photo
2. Identify the single most prominent crop, plant, or pest region
3. Return one normalized bounding box only

OUTPUT FORMAT (strictly JSON, no markdown):
{
  "regions": [
    {
      "x": 0.1,
      "y": 0.15,
      "width": 0.35,
      "height": 0.4,
      "description": "Rice cluster on left"
    },
    {
      "x": 0.55,
      "y": 0.2,
      "width": 0.3,
      "height": 0.35,
      "description": "Tomato plants on right"
    }
  ]
}

Constraints:
- All coordinates are normalized to [0, 1] range
- x, y is top-left corner of bounding box
- width and height are sizes (must be > 0 and <= 1)
- Return exactly 1 region when a target is visible
- If multiple targets are visible, choose the clearest or most prominent one
- Include vegetation within reasonable margins
"""

MAX_RETRIES = 2
RETRY_DELAY = 1.0

VERTEX_MODEL_PREFIX = "publishers/google/models/"
DEFAULT_VERTEX_MODEL_CANDIDATES = (
    "publishers/google/models/gemini-2.5-flash",
    "publishers/google/models/gemini-2.0-flash-001",
)


def _normalize_vertex_model_name(model_name: str) -> str:
    normalized = (model_name or "").strip()
    if not normalized:
        return DEFAULT_VERTEX_MODEL_CANDIDATES[0]
    if normalized.startswith(VERTEX_MODEL_PREFIX):
        return normalized
    return f"{VERTEX_MODEL_PREFIX}{normalized}"


def _build_vertex_model_candidates(model_name: str) -> list[str]:
    candidates = [_normalize_vertex_model_name(model_name)]
    for fallback_model in DEFAULT_VERTEX_MODEL_CANDIDATES:
        if fallback_model not in candidates:
            candidates.append(fallback_model)
    return candidates


def _is_vertex_model_not_found(exc: Exception) -> bool:
    message = str(exc).lower()
    return "publisher model" in message and "not found" in message


def _normalize_regions_payload(raw_text: str) -> list[dict[str, Any]]:
    payload = extract_json_payload(raw_text)

    if isinstance(payload, dict):
        regions = payload.get("regions", [])
    elif isinstance(payload, list):
        regions = payload
    else:
        raise json.JSONDecodeError(
            "Gemini region response must be a JSON object or array",
            raw_text,
            0,
        )

    if not isinstance(regions, list):
        raise json.JSONDecodeError(
            "Gemini region response must contain a list of regions",
            raw_text,
            0,
        )

    return [region for region in regions if isinstance(region, dict)]


def _parse_detection_score(box_data: dict[str, Any]) -> float:
    for key in ("detection_score", "score", "confidence"):
        value = box_data.get(key)
        if value is None:
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return 0.0


def _select_primary_region(detected_boxes: list[dict[str, Any]]) -> tuple[BoundingBox, float, float, dict[str, Any]] | None:
    candidates: list[tuple[float, float, BoundingBox, dict[str, Any]]] = []

    for box_data in detected_boxes:
        try:
            bbox = BoundingBox(
                x=float(box_data.get("x", 0)),
                y=float(box_data.get("y", 0)),
                width=float(box_data.get("width", 1)),
                height=float(box_data.get("height", 1)),
            )
        except (KeyError, ValueError, TypeError):
            continue

        detection_score = _parse_detection_score(box_data)
        area_score = bbox.width * bbox.height
        candidates.append((detection_score, area_score, bbox, box_data))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    detection_score, area_score, bbox, box_data = candidates[0]
    return bbox, detection_score, area_score, box_data


class RegionDetectionService:
    """Detect multiple crop regions in a single photo using Gemini 2.0 Flash."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(
            vertexai=True,
            project=settings.GCP_PROJECT_ID,
            location=settings.GCP_REGION,
        )
        self._model_candidates = _build_vertex_model_candidates(settings.GEMINI_MODEL_NAME)
        self._model_name = self._model_candidates[0]

    def _generate_content_with_model_fallback(
        self,
        *,
        contents: list[types.Part],
        config: types.GenerateContentConfig,
    ):
        for index, model_name in enumerate(self._model_candidates):
            try:
                return self._client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
            except Exception as exc:
                has_fallback = index < len(self._model_candidates) - 1
                if has_fallback and _is_vertex_model_not_found(exc):
                    next_model = self._model_candidates[index + 1]
                    logger.warning(
                        "Vertex model unavailable (%s). Retrying with %s",
                        model_name,
                        next_model,
                    )
                    continue
                raise

    async def _generate_content_async(
        self,
        *,
        contents: list[types.Part],
        config: types.GenerateContentConfig,
    ):
        return await asyncio.to_thread(
            self._generate_content_with_model_fallback,
            contents=contents,
            config=config,
        )

    async def detect_regions(self, base64_image: str) -> list[HttpScanRegion]:
        """Detect one primary crop region from a single base64-encoded image.

        Args:
            base64_image: Base64-encoded image data (raw or data URL format).

        Returns:
            List of HttpScanRegion with bounding boxes and cropped images.
        """
        # Decode and re-encode to ensure clean binary data
        if base64_image.startswith("data:"):
            # Strip data URL prefix if present
            base64_image = base64_image.split(",", 1)[1] if "," in base64_image else base64_image

        try:
            image_bytes = base64.b64decode(base64_image)
        except Exception as e:
            logger.error("Failed to decode base64 image: %s", e)
            return []

        # Call Gemini to detect regions
        detected_boxes = await self._call_gemini_for_regions(base64_image)
        if not detected_boxes:
            logger.warning("No regions detected by Gemini, returning full image as single region")
            return [
                HttpScanRegion(
                    cropped_image_b64=base64_image,
                    bbox=BoundingBox(x=0, y=0, width=1, height=1),
                )
            ]

        selected_region = _select_primary_region(detected_boxes)
        if selected_region is None:
            logger.warning("No valid region detected by Gemini, returning full image as single region")
            return [
                HttpScanRegion(
                    cropped_image_b64=base64_image,
                    bbox=BoundingBox(x=0, y=0, width=1, height=1),
                )
            ]

        bbox, detection_score, area_score, _ = selected_region
        logger.info(
            "Gemini detected %d regions; using one primary region (score=%.3f, area=%.3f)",
            len(detected_boxes),
            detection_score,
            area_score,
        )

        cropped_b64 = self._crop_image(image_bytes, bbox)
        return [
            HttpScanRegion(
                cropped_image_b64=cropped_b64,
                bbox=bbox,
            )
        ]

    async def _call_gemini_for_regions(self, base64_image: str) -> list[dict[str, Any]]:
        """Call Gemini 2.0 Flash to detect regions."""
        import asyncio

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await self._generate_content_async(
                    contents=[
                        types.Part(
                            inline_data=types.Blob(
                                mime_type="image/jpeg",
                                data=base64.b64decode(base64_image),
                            ),
                        ),
                        types.Part(text="Detect the single most prominent crop or pest region in this image."),
                    ],
                    config=types.GenerateContentConfig(
                        system_instruction=REGION_DETECTION_SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.1,
                        max_output_tokens=512,
                    ),
                )

                if not response.text:
                    logger.warning("Gemini region detection returned empty response")
                    return []

                regions = _normalize_regions_payload(response.text)
                logger.info("Gemini detected %d regions", len(regions))
                return regions

            except json.JSONDecodeError as e:
                logger.error("Gemini returned invalid JSON: %s", e)
                if attempt == MAX_RETRIES:
                    return []

            except Exception as e:
                logger.warning("Region detection attempt %d/%d failed: %s", attempt, MAX_RETRIES, e)
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)

        return []

    @staticmethod
    def _crop_image(image_bytes: bytes, bbox: BoundingBox) -> str:
        """Crop an image to the specified bounding box and return as base64.

        Args:
            image_bytes: Raw image bytes.
            bbox: Normalized bounding box [0, 1] range.

        Returns:
            Base64-encoded cropped image.
        """
        try:
            from PIL import Image
            import io

            img = Image.open(io.BytesIO(image_bytes))
            width, height = img.size

            # Convert normalized coordinates to pixel coordinates
            x_px = int(bbox.x * width)
            y_px = int(bbox.y * height)
            w_px = int(bbox.width * width)
            h_px = int(bbox.height * height)

            # Ensure valid crop bounds
            x_px = max(0, x_px)
            y_px = max(0, y_px)
            w_px = max(1, min(w_px, width - x_px))
            h_px = max(1, min(h_px, height - y_px))

            cropped = img.crop((x_px, y_px, x_px + w_px, y_px + h_px))

            # Encode back to base64
            buffer = io.BytesIO()
            cropped.save(buffer, format="JPEG", quality=85)
            cropped_bytes = buffer.getvalue()
            return base64.b64encode(cropped_bytes).decode("utf-8")

        except ImportError:
            logger.warning("PIL not available, returning original image")
            return base64.b64encode(image_bytes).decode("utf-8")
        except Exception as e:
            logger.error("Image cropping failed: %s, returning original", e)
            return base64.b64encode(image_bytes).decode("utf-8")
