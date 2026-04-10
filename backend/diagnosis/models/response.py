"""
Response model for the /analyze endpoint.

Strictly matches the required JSON output contract:
{
  "result": "string",
  "confidence": float,
  "reason": "string",
  "alternatives": ["string"]
}
"""

from pydantic import BaseModel, Field


class AnalyzeResponse(BaseModel):
    """Structured diagnosis output returned to the caller."""

    result: str = Field(
        ...,
        description="Best-matching diagnosis result (e.g. disease name).",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0.",
    )
    reason: str = Field(
        ...,
        description="LLM-generated reasoning for the selected result.",
    )
    alternatives: list[str] = Field(
        default_factory=list,
        description="Other plausible candidate results.",
    )
