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

from pydantic import PrivateAttr
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


class CropEmbedAgent(BaseAgent):
    """Google ADK agent: base64 image → Vertex AI 1408-dim embedding."""

    _embedding_svc: EmbeddingService = PrivateAttr(default_factory=EmbeddingService)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        state = ctx.session.state

        b64_data: str = state["cropped_image_b64"]
        image_bytes = base64.b64decode(b64_data)

        embedding = await self._embedding_svc.embed_image_bytes(image_bytes)
        state["embedding"] = embedding

        logger.info(
            "[%s] %d bytes → %d-dim Vertex AI embedding",
            self.name, len(image_bytes), len(embedding),
        )

        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            branch=ctx.branch,
        )
