"""
Vector Search service wrapping Vertex AI Matching Engine.

Performs Top-K similarity search against a pre-deployed index.
Metadata is stored directly on Vector Search datapoints —
no external metadata store is used.
"""

from __future__ import annotations

import logging
from typing import Any

from google.cloud.aiplatform.matching_engine import (
    MatchingEngineIndexEndpoint,
)

from config import get_settings
from models.candidate import RetrievalCandidate

logger = logging.getLogger(__name__)


class VectorSearchService:
    """Executes similarity queries against Vertex AI Vector Search."""

    def __init__(self) -> None:
        settings = get_settings()
        self._endpoint = MatchingEngineIndexEndpoint(
            index_endpoint_name=settings.VECTOR_SEARCH_INDEX_ENDPOINT,
        )
        self._deployed_index_id = settings.VECTOR_SEARCH_DEPLOYED_INDEX_ID

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
        """
        responses = self._endpoint.find_neighbors(
            deployed_index_id=self._deployed_index_id,
            queries=[embedding],
            num_neighbors=top_k,
        )

        candidates: list[RetrievalCandidate] = []

        for match_list in responses:
            for neighbor in match_list:
                metadata = self._extract_metadata(neighbor)
                candidates.append(
                    RetrievalCandidate(
                        id=str(neighbor.id),
                        score=float(neighbor.distance),
                        metadata=metadata,
                    )
                )

        candidates.sort(key=lambda c: c.score, reverse=True)
        logger.info(
            "Vector search returned %d candidate(s) (top_k=%d)",
            len(candidates),
            top_k,
        )
        return candidates

    # ── Internal ──────────────────────────────────────────────────────

    @staticmethod
    def _extract_metadata(neighbor: Any) -> dict[str, Any]:
        """Extract metadata from a MatchNeighbor's restricts.

        Vertex AI Vector Search stores metadata as ``restricts``
        (list of Namespace objects with allow/deny token lists) and
        ``numeric_restricts``.  We flatten these into a plain dict
        so the rest of the system stays schema-free.
        """
        metadata: dict[str, Any] = {}

        # Token restricts → string values
        if hasattr(neighbor, "restricts") and neighbor.restricts:
            for restrict in neighbor.restricts:
                namespace = getattr(restrict, "namespace", None)
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
