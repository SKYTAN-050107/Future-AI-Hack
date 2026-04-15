"""
Schema-free retrieval candidate model.

Metadata is stored as an unstructured dict — the system never
assumes a fixed schema.  This allows the vector database to
carry arbitrary domain-specific attributes per datapoint.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RetrievalCandidate(BaseModel):
    """A single candidate returned by vector similarity search.

    Attributes:
        id: Unique datapoint identifier from the vector database.
        score: Cosine / dot-product similarity score.
        metadata: Flexible key-value metadata attached to the datapoint.
                  No fixed schema — contents depend on what was indexed.
    """

    id: str = Field(..., description="Datapoint ID in Vector Search.")
    score: float = Field(..., description="Similarity score.")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Unstructured metadata (schema-free).",
    )
