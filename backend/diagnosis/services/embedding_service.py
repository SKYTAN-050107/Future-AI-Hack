"""
Embedding service — Vertex AI Multimodal Embedding API.

Generates 1408-dimensional vectors via ``multimodalembedding@001``.
Supports embedding from in-memory bytes (live scan) or GCS URI.
"""

from __future__ import annotations

import logging

import vertexai
from vertexai.vision_models import (
    Image as VertexImage,
    MultiModalEmbeddingModel,
    MultiModalEmbeddingResponse,
)

from config import get_settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Vertex AI multimodal embedding generator (1408-dim)."""

    def __init__(self) -> None:
        settings = get_settings()
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
        """
        image = VertexImage(image_bytes=image_bytes)
        response: MultiModalEmbeddingResponse = self._model.get_embeddings(
            image=image,
            dimension=self._dimension,
        )
        logger.info("Vertex AI embedding from bytes (%d bytes)", len(image_bytes))
        return list(response.image_embedding)

    # ── Additional methods (for data ingestion / batch processing) ────

    async def embed_image_gcs(self, gcs_uri: str) -> list[float]:
        """Generate embedding from an image in Cloud Storage.

        Args:
            gcs_uri: Full GCS URI, e.g. ``gs://bucket/path/image.jpg``.

        Returns:
            1408-dimensional embedding vector.
        """
        image = VertexImage.load_from_file(gcs_uri)
        response: MultiModalEmbeddingResponse = self._model.get_embeddings(
            image=image,
            dimension=self._dimension,
        )
        logger.info("Vertex AI embedding from GCS: %s", gcs_uri)
        return list(response.image_embedding)

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding from text.

        Args:
            text: Free-form text description.

        Returns:
            1408-dimensional embedding vector.
        """
        response: MultiModalEmbeddingResponse = self._model.get_embeddings(
            contextual_text=text,
            dimension=self._dimension,
        )
        logger.info("Vertex AI text embedding (%d chars)", len(text))
        return list(response.text_embedding)
