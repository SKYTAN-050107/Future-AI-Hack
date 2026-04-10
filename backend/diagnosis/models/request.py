"""
Request model for the /analyze endpoint.

Accepts either an image, text, or both.  At least one must be present.
The image field carries raw bytes read from the uploaded file;
the text field carries the user's free-form description.
"""

from __future__ import annotations

from pydantic import BaseModel, model_validator


class AnalyzeRequest(BaseModel):
    """Inbound payload for plant diagnosis analysis.

    At minimum, one of ``image_bytes`` or ``text`` must be provided.
    ``image_bytes`` is populated by the API layer after reading the
    uploaded file — callers never set it directly.
    """

    image_bytes: bytes | None = None
    image_filename: str | None = None
    text: str | None = None

    model_config = {"arbitrary_types_allowed": True}

    @model_validator(mode="after")
    def _at_least_one_input(self) -> "AnalyzeRequest":
        if self.image_bytes is None and not self.text:
            raise ValueError("At least one of 'image' or 'text' must be provided.")
        return self
