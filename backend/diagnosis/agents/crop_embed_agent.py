"""
Crop-Embed Agent — Google ADK BaseAgent.

Decodes a base64 cropped image and generates a 1408-dim multimodal
embedding via Vertex AI ``multimodalembedding@001``.

No GCS upload — embedding is generated directly from in-memory bytes
for lowest latency.

State keys read:
    cropped_image_b64  (str)   — base64-encoded cropped image

State keys written:
    embedding          (list[float]) — 1408-dim vector
"""

from __future__ import annotations

import base64
import logging
from typing import AsyncGenerator

from pydantic import PrivateAttr, ConfigDict
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


class CropEmbedAgent(BaseAgent):
    """Google ADK agent: base64 image → Vertex AI 1408-dim embedding."""

    model_config = ConfigDict(extra='ignore')

    _embedding_svc: EmbeddingService = PrivateAttr(default_factory=EmbeddingService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        logger.info("[%s] ENTRY: _run_async_impl called", self.name)
        state = ctx.session.state
        logger.info("[%s] State keys: %s", self.name, list(state.keys()))

        try:
            b64_data: str = state["cropped_image_b64"]
            image_bytes = base64.b64decode(b64_data)
            logger.info("[%s] Decoded %d bytes from base64", self.name, len(image_bytes))

            embedding = await self._embedding_svc.embed_image_bytes(image_bytes)
            state["embedding"] = embedding
            logger.info("[%s] Embedding written to state: %d-dim", self.name, len(embedding))

            logger.info(
                "[%s] %d bytes → %d-dim Vertex AI embedding",
                self.name, len(image_bytes), len(embedding),
            )
        except Exception as e:
            logger.error("[%s] Failed to generate embedding: %s", self.name, e, exc_info=True)
            state["embedding"] = []  # Empty embedding to allow downstream agents to proceed

        logger.info("[%s] EXIT: About to yield event", self.name)
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
        logger.info("[%s] EXIT: Event yielded", self.name)
