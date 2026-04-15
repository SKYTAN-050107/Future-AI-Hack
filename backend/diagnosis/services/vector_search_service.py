"""
Vector Search service wrapping Vertex AI Matching Engine.

Performs Top-K similarity search against a pre-deployed index.
Metadata is stored directly on Vector Search datapoints —
no external metadata store is used.

Includes retry logic and timeout handling.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from google.cloud.aiplatform.matching_engine import (
    MatchingEngineIndexEndpoint,
)

from config import get_settings
from models.candidate import RetrievalCandidate

logger = logging.getLogger(__name__)

# ── Retry Configuration ───────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1.0
SEARCH_TIMEOUT_SECONDS = 30


class VectorSearchService:
    """Executes similarity queries against Vertex AI Vector Search."""

    def __init__(self) -> None:
        settings = get_settings()
        self._endpoint = MatchingEngineIndexEndpoint(
            index_endpoint_name=settings.VECTOR_SEARCH_INDEX_ENDPOINT,
        )
        self._deployed_index_id = settings.VECTOR_SEARCH_DEPLOYED_INDEX_ID
        logger.info(
            "VectorSearchService initialized with endpoint=%s, deployed_index_id=%s",
            settings.VECTOR_SEARCH_INDEX_ENDPOINT,
            settings.VECTOR_SEARCH_DEPLOYED_INDEX_ID,
        )

    # ── Public API ────────────────────────────────────────────────────

    async def search(
        self,
        embedding: list[float],
        top_k: int = 5,
    ) -> list[RetrievalCandidate]:
        """Find the Top-K most similar datapoints.

        Args:
            embedding: Query embedding vector (1408-dim).
            top_k: Number of nearest neighbors to retrieve.

        Returns:
            List of ``RetrievalCandidate`` objects sorted by
            descending similarity score.  Metadata is extracted
            from the datapoint restricts (schema-free).

        Raises:
            RuntimeError: If all retry attempts fail.
        """
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                # Run the synchronous SDK call in a thread with a timeout
                responses = await asyncio.wait_for(
                    asyncio.to_thread(
                        self._endpoint.find_neighbors,
                        deployed_index_id=self._deployed_index_id,
                        queries=[embedding],
                        num_neighbors=top_k,
                        return_full_datapoint=True,
                    ),
                    timeout=SEARCH_TIMEOUT_SECONDS,
                )

                candidates: list[RetrievalCandidate] = []

                for match_list in responses:
                    for neighbor in match_list:
                        metadata = self._extract_metadata(neighbor)
                        logger.info(
                            "Neighbor %s: distance=%.4f, metadata=%s, restricts=%s, numeric_restricts=%s",
                            neighbor.id,
                            neighbor.distance,
                            metadata,
                            getattr(neighbor, "restricts", None),
                            getattr(neighbor, "numeric_restricts", None),
                        )
                        candidates.append(
                            RetrievalCandidate(
                                id=str(neighbor.id),
                                score=float(neighbor.distance),
                                metadata=metadata,
                            )
                        )

                logger.info("Vector search built %d candidate(s)", len(candidates))
                return candidates

            except asyncio.TimeoutError:
                logger.error(
                    "Vector search timed out after %ds (attempt %d/%d)",
                    SEARCH_TIMEOUT_SECONDS, attempt, MAX_RETRIES,
                )
                if attempt == MAX_RETRIES:
                    raise RuntimeError(
                        f"Vector search timed out after {MAX_RETRIES} attempts"
                    )
            except Exception as e:
                if attempt == MAX_RETRIES:
                    logger.error(
                        "Vector search failed after %d attempts: %s",
                        MAX_RETRIES, e,
                    )
                    raise RuntimeError(
                        f"Vector search failed after {MAX_RETRIES} retries: {e}"
                    ) from e
                logger.warning(
                    "Vector search attempt %d/%d failed: %s — retrying in %.1fs...",
                    attempt, MAX_RETRIES, e, RETRY_DELAY_SECONDS,
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        return []  # unreachable

    # ── Internal ──────────────────────────────────────────────────────

    @staticmethod
    def _extract_metadata(neighbor: Any) -> dict[str, Any]:
        """Extract metadata from a MatchNeighbor.

        Vertex AI Vector Search stores metadata in multiple possible locations:
        - embedding_metadata: custom metadata dict
        - restricts: list of Namespace objects with allow/deny token lists
        - numeric_restricts: numeric metadata
        We flatten these into a plain dict.
        """
        metadata: dict[str, Any] = {}
        
        # First, try to get metadata from embedding_metadata attribute
        if hasattr(neighbor, "embedding_metadata") and neighbor.embedding_metadata:
            logger.debug("[_extract_metadata] Found embedding_metadata: %s", neighbor.embedding_metadata)
            if isinstance(neighbor.embedding_metadata, dict):
                metadata.update(neighbor.embedding_metadata)
            else:
                # Try to treat it as an object with attributes
                for key in dir(neighbor.embedding_metadata):
                    if not key.startswith('_'):
                        try:
                            val = getattr(neighbor.embedding_metadata, key)
                            metadata[key] = val
                        except Exception:
                            pass

        # Token restricts → string values
        if hasattr(neighbor, "restricts") and neighbor.restricts:
            for restrict in neighbor.restricts:
                namespace = getattr(restrict, "namespace", None) or getattr(restrict, "name", None)
                tokens = getattr(restrict, "allow_tokens", None)
                if tokens is None:
                    tokens = getattr(restrict, "allow_list", [])
                if namespace and tokens:
                    # Single-value namespaces → scalar; multi → list
                    metadata[namespace] = (
                        tokens[0] if len(tokens) == 1 else tokens
                    )

        # Numeric restricts → float values
        if hasattr(neighbor, "numeric_restricts") and neighbor.numeric_restricts:
            for nr in neighbor.numeric_restricts:
                namespace = getattr(nr, "namespace", None)
                value = getattr(nr, "value_float", None)
                if value is None:
                    value = getattr(nr, "value_int", None)
                if value is None:
                    value = getattr(nr, "value_double", None)
                if namespace is not None and value is not None:
                    metadata[namespace] = value

        return metadata
