"""Data models for the live-scan pipeline."""

from models.scan_models import BoundingBox, ScanRegion, ScanFrame, ScanResult, ScanResponse
from models.candidate import RetrievalCandidate

__all__ = [
    "BoundingBox",
    "ScanRegion",
    "ScanFrame",
    "ScanResult",
    "ScanResponse",
    "RetrievalCandidate",
]
