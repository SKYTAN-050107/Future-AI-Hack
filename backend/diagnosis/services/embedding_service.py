"""
Embedding service — Vertex AI Multimodal Embedding API.

Generates 1408-dimensional vectors via ``multimodalembedding@001``.
Supports embedding from in-memory bytes (live scan) or GCS URI.

Includes retry logic for transient API failures.
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl

import vertexai
from vertexai.vision_models import (
    Image as VertexImage,
    MultiModalEmbeddingModel,
    MultiModalEmbeddingResponse,
)

from config import get_settings

logger = logging.getLogger(__name__)

# ── Retry Configuration ───────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1.0


class EmbeddingService:
    """Vertex AI multimodal embedding generator (1408-dim)."""

    def __init__(self) -> None:
        settings = get_settings()
        # Ensure GOOGLE_APPLICATION_CREDENTIALS from .env is visible to google-auth
        if settings.GOOGLE_APPLICATION_CREDENTIALS and "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

        vertexai.init(
            project=settings.GCP_PROJECT_ID,
            location=settings.GCP_REGION,
        )
        self._model = MultiModalEmbeddingModel.from_pretrained(
            settings.EMBEDDING_MODEL,
        )
        self._dimension = settings.EMBEDDING_DIMENSION

    # ── Primary method for live scan ──────────────────────────────────

    async def embed_image_bytes(self, image_bytes: bytes) -> list[float]:
        """Generate embedding directly from in-memory image bytes.

        This is the primary method used by the live-scan pipeline.
        No GCS upload — lowest latency path.

        Args:
            image_bytes: Raw image content (JPEG, PNG, etc.).

        Returns:
            1408-dimensional embedding vector.

        Raises:
            RuntimeError: If all retry attempts fail.
        """
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                image = VertexImage(image_bytes=image_bytes)
                response: MultiModalEmbeddingResponse = self._model.get_embeddings(
                    image=image,
                    dimension=self._dimension,
                )
                logger.info("Vertex AI embedding from bytes (%d bytes)", len(image_bytes))
                return list(response.image_embedding)
            except Exception as e:
                if attempt == MAX_RETRIES:
                    is_ssl = isinstance(e, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(e).upper()
                    logger.error(
                        "Embedding from bytes failed after %d attempts: %s",
                        MAX_RETRIES, e,
                        extra={"module": "embedding", "status": "failed", "reason": "SSL_CERT_ERROR" if is_ssl else type(e).__name__},
                    )
                    if is_ssl:
                        logger.error(
                            "SSL certificate error — run 'pip install --upgrade certifi' "
                            "or set SSL_CERT_FILE=$(python -m certifi)"
                        )
                    raise RuntimeError(
                        f"Vertex AI Embedding failed after {MAX_RETRIES} retries: {e}"
                    ) from e
                logger.warning(
                    "Embedding attempt %d/%d failed: %s — retrying in %.1fs...",
                    attempt, MAX_RETRIES, e, RETRY_DELAY_SECONDS,
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return []  # unreachable, satisfies type checker

    # ── Additional methods (for data ingestion / batch processing) ────

    async def embed_image_gcs(self, gcs_uri: str) -> list[float]:
        """Generate embedding from an image in Cloud Storage.

        Args:
            gcs_uri: Full GCS URI, e.g. ``gs://bucket/path/image.jpg``.

        Returns:
            1408-dimensional embedding vector.

        Raises:
            RuntimeError: If all retry attempts fail.
        """
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                image = VertexImage.load_from_file(gcs_uri)
                response: MultiModalEmbeddingResponse = self._model.get_embeddings(
                    image=image,
                    dimension=self._dimension,
                )
                logger.info("Vertex AI embedding from GCS: %s", gcs_uri)
                return list(response.image_embedding)
            except Exception as e:
                if attempt == MAX_RETRIES:
                    is_ssl = isinstance(e, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(e).upper()
                    logger.error(
                        "Embedding from GCS failed after %d attempts for %s: %s",
                        MAX_RETRIES, gcs_uri, e,
                        extra={"module": "embedding", "status": "failed", "reason": "SSL_CERT_ERROR" if is_ssl else type(e).__name__},
                    )
                    raise RuntimeError(
                        f"Vertex AI Embedding failed for {gcs_uri} after {MAX_RETRIES} retries: {e}"
                    ) from e
                logger.warning(
                    "Embedding GCS attempt %d/%d failed: %s — retrying in %.1fs...",
                    attempt, MAX_RETRIES, e, RETRY_DELAY_SECONDS,
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return []  # unreachable

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding from text.

        Args:
            text: Free-form text description.

        Returns:
            1408-dimensional embedding vector.

        Raises:
            RuntimeError: If all retry attempts fail.
        """
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response: MultiModalEmbeddingResponse = self._model.get_embeddings(
                    contextual_text=text,
                    dimension=self._dimension,
                )
                logger.info("Vertex AI text embedding (%d chars)", len(text))
                return list(response.text_embedding)
            except Exception as e:
                if attempt == MAX_RETRIES:
                    logger.error(
                        "Text embedding failed after %d attempts: %s",
                        MAX_RETRIES, e,
                        extra={"module": "embedding", "status": "failed", "reason": type(e).__name__},
                    )
                    raise RuntimeError(
                        f"Vertex AI text embedding failed after {MAX_RETRIES} retries: {e}"
                    ) from e
                logger.warning(
                    "Text embedding attempt %d/%d failed: %s — retrying in %.1fs...",
                    attempt, MAX_RETRIES, e, RETRY_DELAY_SECONDS,
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return []  # unreachable
