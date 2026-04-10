"""
Embedding Agent — Converts input into an embedding vector.

Reads the ``input_type`` set by the Planner Agent and calls the
appropriate Embedding Service method.

For image inputs:
1. Upload to Cloud Storage first (via Storage Service).
2. Generate embedding from the GCS URI (NOT from raw bytes).

State keys read  (from ctx.session.state):
- ``input_type``:      from Planner
- ``image_bytes``:     raw image bytes (if image input)
- ``image_filename``:  original filename (if image input)
- ``text``:            user text description (if text input)

State keys written (to ctx.session.state):
- ``embedding``:  list[float] — the generated embedding vector
- ``gcs_uri``:    str — Cloud Storage URI of the uploaded image (if applicable)
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from services.embedding_service import EmbeddingService
from services.storage_service import StorageService

logger = logging.getLogger(__name__)


class EmbeddingAgent(BaseAgent):
    """Converts user input into an embedding vector."""

    # Service instances stored as private attributes (not Pydantic-serialised fields)
    _embedding_service: EmbeddingService = PrivateAttr(
        default_factory=EmbeddingService
    )
    _storage_service: StorageService = PrivateAttr(
        default_factory=StorageService
    )

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        input_type: str = state["input_type"]
        gcs_uri: str | None = None

        # ── Upload image to GCS if present ────────────────────────
        if input_type in ("image", "multimodal"):
            image_bytes: bytes = state["image_bytes"]
            filename: str | None = state.get("image_filename")
            gcs_uri = await self._storage_service.upload_image(
                image_bytes, filename
            )
            state["gcs_uri"] = gcs_uri

        # ── Generate embedding based on input type ────────────────
        text: str | None = state.get("text")

        if input_type == "image":
            embedding = await self._embedding_service.embed_image(gcs_uri)
        elif input_type == "text":
            embedding = await self._embedding_service.embed_text(text)
        elif input_type == "multimodal":
            embedding = await self._embedding_service.embed_multimodal(
                gcs_uri=gcs_uri,
                text=text,
            )
        else:
            raise ValueError(f"Unknown input_type: {input_type}")

        state["embedding"] = embedding
        logger.info(
            "[%s] Generated %d-dim embedding (type=%s)",
            self.name,
            len(embedding),
            input_type,
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
