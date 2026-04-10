"""
Storage service wrapping Google Cloud Storage.

Handles uploading raw images to GCS and returning the
``gs://`` URI.  The URI is then passed to the Embedding
Service for vector generation (images are NOT embedded
from in-memory bytes).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from google.cloud import storage

from config import get_settings

logger = logging.getLogger(__name__)


class StorageService:
    """Uploads files to Google Cloud Storage."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = storage.Client(project=settings.GCP_PROJECT_ID)
        self._bucket_name = settings.GCS_BUCKET_NAME
        self._bucket = self._client.bucket(self._bucket_name)

    # ── Public API ────────────────────────────────────────────────────

    async def upload_image(
        self,
        image_bytes: bytes,
        original_filename: str | None = None,
    ) -> str:
        """Upload an image to Cloud Storage and return its GCS URI.

        Files are stored under ``uploads/<date>/<uuid>_<filename>``
        to avoid collisions and enable chronological browsing.

        Args:
            image_bytes: Raw image file content.
            original_filename: Original filename (used for extension
                               detection).  Falls back to ``.jpg``.

        Returns:
            Full GCS URI, e.g. ``gs://bucket/uploads/2026-04-10/abc123_img.jpg``.
        """
        ext = self._extract_extension(original_filename)
        date_prefix = datetime.utcnow().strftime("%Y-%m-%d")
        unique_id = uuid.uuid4().hex[:12]
        blob_name = f"uploads/{date_prefix}/{unique_id}{ext}"

        blob = self._bucket.blob(blob_name)
        content_type = self._guess_content_type(ext)
        blob.upload_from_string(image_bytes, content_type=content_type)

        gcs_uri = f"gs://{self._bucket_name}/{blob_name}"
        logger.info("Uploaded image to %s (%d bytes)", gcs_uri, len(image_bytes))
        return gcs_uri

    # ── Internal ──────────────────────────────────────────────────────

    @staticmethod
    def _extract_extension(filename: str | None) -> str:
        """Extract file extension, defaulting to .jpg."""
        if filename and "." in filename:
            return "." + filename.rsplit(".", 1)[-1].lower()
        return ".jpg"

    @staticmethod
    def _guess_content_type(ext: str) -> str:
        """Map common image extensions to MIME types."""
        mapping = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
        }
        return mapping.get(ext, "application/octet-stream")
