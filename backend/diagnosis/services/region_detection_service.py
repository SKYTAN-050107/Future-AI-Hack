"""
Region detection service using Gemini 2.0 Flash to identify multiple crop regions in a photo.

Detects bounding boxes for separate plants/crops in a single image,
enabling multi-crop analysis in the chatbot.
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

logger = logging.getLogger(__name__)

REGION_DETECTION_SYSTEM_PROMPT = """\
You are a crop region detection system for agricultural imagery.

Your job is to:
1. Analyze a farm/garden photo
2. Identify all visible crops or plants
3. Return normalized bounding boxes for each crop region

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
- Minimum 1 region, maximum 5 regions per photo
- Avoid overlapping boxes as much as possible
- Include vegetation within reasonable margins
"""

MAX_RETRIES = 2
RETRY_DELAY = 1.0


class RegionDetectionService:
    """Detect multiple crop regions in a single photo using Gemini 2.0 Flash."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(
            vertexai=True,
            project=settings.GCP_PROJECT_ID,
            location=settings.GCP_REGION,
        )
        self._model_name = settings.GEMINI_MODEL_NAME

    async def detect_regions(self, base64_image: str) -> list[HttpScanRegion]:
        """Detect multiple crop regions from a single base64-encoded image.

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

        # Convert detected boxes to scan regions with cropped images
        regions = []
        for box_data in detected_boxes:
            try:
                bbox = BoundingBox(
                    x=float(box_data.get("x", 0)),
                    y=float(box_data.get("y", 0)),
                    width=float(box_data.get("width", 1)),
                    height=float(box_data.get("height", 1)),
                )

                # Create cropped image for this region
                cropped_b64 = self._crop_image(image_bytes, bbox)
                regions.append(
                    HttpScanRegion(
                        cropped_image_b64=cropped_b64,
                        bbox=bbox,
                    )
                )
            except (KeyError, ValueError, TypeError) as e:
                logger.warning("Skipping invalid region: %s", e)
                continue

        return regions if regions else [
            HttpScanRegion(
                cropped_image_b64=base64_image,
                bbox=BoundingBox(x=0, y=0, width=1, height=1),
            )
        ]

    async def _call_gemini_for_regions(self, base64_image: str) -> list[dict[str, Any]]:
        """Call Gemini 2.0 Flash to detect regions."""
        import asyncio

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._client.models.generate_content(
                    model=self._model_name,
                    contents=[
                        types.Part(
                            inline_data=types.Blob(
                                mime_type="image/jpeg",
                                data=base64.b64decode(base64_image),
                            ),
                        ),
                        types.Part(text="Detect all separate crop regions in this image."),
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

                result = json.loads(response.text.strip())
                regions = result.get("regions", [])
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
