"""
Embedding service wrapping Vertex AI Multimodal Embedding API.

Supports image (via GCS URI), text, or combined multimodal embeddings.
All embeddings are 1408-dimensional vectors produced by
``multimodalembedding@001``.

IMPORTANT: Image embeddings are generated from Cloud Storage URIs,
not from raw in-memory bytes.  The caller must upload images to GCS
first and pass the URI here.
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
    """Generates 1408-dim embedding vectors via Vertex AI."""

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

    # ── Public API ────────────────────────────────────────────────────

    async def embed_image(self, gcs_uri: str) -> list[float]:
        """Generate embedding from an image stored in Cloud Storage.

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
        logger.info("Generated image embedding from %s", gcs_uri)
        return list(response.image_embedding)

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding from a text string.

        Args:
            text: Free-form text description.

        Returns:
            1408-dimensional embedding vector.
        """
        response: MultiModalEmbeddingResponse = self._model.get_embeddings(
            contextual_text=text,
            dimension=self._dimension,
        )
        logger.info("Generated text embedding (%d chars)", len(text))
        return list(response.text_embedding)

    async def embed_multimodal(
        self,
        gcs_uri: str | None = None,
        text: str | None = None,
    ) -> list[float]:
        """Generate a combined multimodal embedding.

        When both image and text are provided, the model produces a
        fused embedding that captures both visual and textual signals.

        Args:
            gcs_uri: GCS URI of the image (optional).
            text: Text description (optional).

        Returns:
            1408-dimensional embedding vector.

        Raises:
            ValueError: If neither image nor text is provided.
        """
        if gcs_uri is None and not text:
            raise ValueError("At least one of gcs_uri or text is required.")

        kwargs: dict = {"dimension": self._dimension}

        if gcs_uri:
            kwargs["image"] = VertexImage.load_from_file(gcs_uri)
        if text:
            kwargs["contextual_text"] = text

        response: MultiModalEmbeddingResponse = self._model.get_embeddings(
            **kwargs,
        )

        # Prefer image embedding when available (fused representation),
        # fall back to text embedding for text-only inputs.
        if gcs_uri and response.image_embedding:
            logger.info("Generated multimodal embedding (image-primary)")
            return list(response.image_embedding)

        logger.info("Generated multimodal embedding (text-primary)")
        return list(response.text_embedding)
