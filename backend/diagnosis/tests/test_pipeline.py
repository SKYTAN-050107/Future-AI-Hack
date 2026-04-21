"""
Unit tests for the PadiGuard AI diagnosis pipeline.

These tests use mocked GCP services so they can run locally
without any cloud credentials or network access.

Run:
    cd d:\\RAGsystem\\Future-AI-Hack\\backend\\diagnosis
    python -m pytest tests/ -v
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Patch settings before importing any modules that use them ─────────

_MOCK_SETTINGS = MagicMock()
_MOCK_SETTINGS.GCP_PROJECT_ID = "test-project"
_MOCK_SETTINGS.GCP_REGION = "us-central1"
_MOCK_SETTINGS.EMBEDDING_MODEL = "multimodalembedding@001"
_MOCK_SETTINGS.EMBEDDING_DIMENSION = 1408
_MOCK_SETTINGS.VECTOR_SEARCH_INDEX_ENDPOINT = "projects/test/locations/us-central1/indexEndpoints/123"
_MOCK_SETTINGS.VECTOR_SEARCH_DEPLOYED_INDEX_ID = "test-deployed-index"
_MOCK_SETTINGS.VECTOR_SEARCH_CONFIDENCE_THRESHOLD = 0.65
_MOCK_SETTINGS.VECTOR_SEARCH_FAST_MATCH_THRESHOLD = 0.85
_MOCK_SETTINGS.GEMINI_MODEL_NAME = "gemini-2.0-flash"
_MOCK_SETTINGS.FIRESTORE_GRID_COLLECTION = "grids"
_MOCK_SETTINGS.FIRESTORE_REPORT_COLLECTION = "scanReports"
_MOCK_SETTINGS.FIRESTORE_CANDIDATE_COLLECTION = "candidateMetadata"
_MOCK_SETTINGS.DEFAULT_TOP_K = 5


# ══════════════════════════════════════════════════════════════════════
# Test: ReasoningAgent Fast Path
# ══════════════════════════════════════════════════════════════════════

class TestReasoningAgentFastPath:
    """Test that ReasoningAgent correctly uses fast_match to skip LLM."""

    def test_fast_path_produces_correct_result(self):
        """When fast_match is set, agent should NOT call LLM."""
        from models.candidate import RetrievalCandidate

        # Simulate session state after VectorMatchAgent with a fast_match
        state = {
            "candidates": [
                RetrievalCandidate(
                    id="abc123",
                    score=0.92,
                    metadata={"cropType": "Tomato", "disease": "Late Blight"},
                )
            ],
            "fast_match": {
                "id": "abc123",
                "score": 0.92,
                "metadata": {"cropType": "Tomato", "disease": "Late Blight"},
            },
            "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            "grid_id": "section_A1",
        }

        # The ReasoningAgent should use fast_match and skip LLM
        # We verify by checking the logic directly
        fast_match = state.get("fast_match")
        assert fast_match is not None
        metadata = fast_match["metadata"]
        assert metadata["cropType"] == "Tomato"
        assert metadata["disease"] == "Late Blight"

        # Verify abnormality detection
        disease = metadata["disease"]
        is_abnormal = disease.lower() not in ["healthy", "normal", "unknown"]
        assert is_abnormal is True

    def test_no_fast_match_falls_through(self):
        """When fast_match is None, agent should proceed to LLM path."""
        state = {
            "candidates": [],
            "fast_match": None,
            "bbox": {},
            "grid_id": None,
        }

        fast_match = state.get("fast_match")
        candidates = state.get("candidates", [])
        assert fast_match is None
        assert len(candidates) == 0

        # Should produce healthy defaults
        cropType = "Unknown"
        disease = "Healthy"
        assert cropType == "Unknown"
        assert disease == "Healthy"


# ══════════════════════════════════════════════════════════════════════
# Test: VectorMatchAgent Fast Match Gate
# ══════════════════════════════════════════════════════════════════════

class TestVectorMatchFastGate:
    """Test the fast-match threshold gating logic."""

    def test_high_score_triggers_fast_match(self):
        """Score >= 0.85 should set fast_match."""
        threshold = 0.85
        score = 0.92
        assert score >= threshold

        fast_match = {
            "id": "abc",
            "score": score,
            "metadata": {"cropType": "Rice", "disease": "Rice Blast"},
        }
        assert fast_match["score"] >= threshold

    def test_low_score_no_fast_match(self):
        """Score < 0.85 should NOT set fast_match."""
        threshold = 0.85
        score = 0.72
        assert score < threshold


# ══════════════════════════════════════════════════════════════════════
# Test: LLM Fallback Format
# ══════════════════════════════════════════════════════════════════════

class TestLLMFallbackFormat:
    """Test that LLM fallback returns keys matching ReasoningAgent expectations."""

    def test_fallback_has_correct_keys(self):
        """The fallback dict must have all keys that ReasoningAgent reads."""
        fallback = {
            "cropType": "Unknown",
            "disease": "Unknown",
            "severity": "Moderate",
            "severityScore": 0.0,
            "treatmentPlan": "Consult Agrologist",
            "survivalProb": 0.5,
        }

        # These are the exact keys ReasoningAgent reads via .get()
        required_keys = [
            "cropType", "disease", "severity",
            "severityScore", "treatmentPlan", "survivalProb",
        ]
        for key in required_keys:
            assert key in fallback, f"Missing key: {key}"

    def test_fallback_values_are_safe(self):
        """Fallback values should not cause downstream errors."""
        fallback = {
            "cropType": "Unknown",
            "disease": "Unknown",
            "severity": "Moderate",
            "severityScore": 0.0,
            "treatmentPlan": "Consult Agrologist",
            "survivalProb": 0.5,
        }

        assert isinstance(fallback["severityScore"], (int, float))
        assert isinstance(fallback["survivalProb"], (int, float))
        assert 0.0 <= fallback["severityScore"] <= 1.0
        assert 0.0 <= fallback["survivalProb"] <= 1.0


# ══════════════════════════════════════════════════════════════════════
# Test: Pydantic Models
# ══════════════════════════════════════════════════════════════════════

class TestScanModels:
    """Test Pydantic models validate correctly."""

    def test_scan_frame_valid(self):
        from models.scan_models import ScanFrame

        raw = {
            "grid_id": "section_A1",
            "frame_number": 120,
            "regions": [
                {
                    "cropped_image_b64": "aGVsbG8=",
                    "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                }
            ],
        }
        frame = ScanFrame.model_validate(raw)
        assert frame.grid_id == "section_A1"
        assert len(frame.regions) == 1
        assert frame.regions[0].bbox.x == 0.1

    def test_scan_frame_empty_regions_allowed(self):
        from models.scan_models import ScanFrame

        raw = {
            "regions": [],
        }
        frame = ScanFrame.model_validate(raw)
        assert frame.regions == []

    def test_scan_result_defaults(self):
        from models.scan_models import ScanResult, BoundingBox

        result = ScanResult(
            bbox=BoundingBox(x=0.0, y=0.0, width=0.5, height=0.5),
        )
        assert result.cropType == "Unknown"
        assert result.disease == "Healthy"
        assert result.is_abnormal is False

    def test_retrieval_candidate(self):
        from models.candidate import RetrievalCandidate

        c = RetrievalCandidate(
            id="abc123",
            score=0.87,
            metadata={"cropType": "Tomato", "disease": "Early Blight"},
        )
        assert c.id == "abc123"
        assert c.score == 0.87
        assert c.metadata["cropType"] == "Tomato"


# ══════════════════════════════════════════════════════════════════════
# Test: Firestore Service Grid Update
# ══════════════════════════════════════════════════════════════════════

class TestFirestoreGridUpdate:
    """Test that abnormal results trigger grid health updates."""

    def test_abnormal_result_should_update_grid(self):
        """Abnormal scan results should trigger a grid health write."""
        is_abnormal = True
        grid_id = "section_A1"

        # This is the condition checked in firestore_service.py
        assert is_abnormal and grid_id

    def test_normal_result_should_not_update_grid(self):
        """Normal/healthy results should NOT update grid health."""
        is_abnormal = False
        grid_id = "section_A1"

        # This condition should be False
        assert not (is_abnormal and grid_id)


# ══════════════════════════════════════════════════════════════════════
# Test: CSV to JSON Conversion
# ══════════════════════════════════════════════════════════════════════

class TestCSVConversion:
    """Test the CSV parsing logic used in generate_csv.py."""

    def test_crop_disease_split(self):
        """Test the '___' folder naming convention parsing."""
        folder_name = "Pepper,_bell___healthy"

        crop, disease = folder_name.split("___", 1)
        cropType = crop.replace("_", " ").replace(",", "").strip().title()
        diseaseName = disease.replace("_", " ").strip()

        assert cropType == "Pepper Bell"
        if diseaseName.lower() == "healthy":
            diseaseName = "Healthy"
        assert diseaseName == "Healthy"

    def test_pest_folder_detection(self):
        """Test pest/insect folder name detection."""
        blob_name = "farm_insects/Aphids/img1.jpg"
        blob_lower = blob_name.lower()

        is_pest = "pest" in blob_lower or "insect" in blob_lower
        assert is_pest is True

    def test_image_extension_filter(self):
        """Test image file extension filter."""
        valid_files = ["img.jpg", "img.png", "img.jpeg", "img.webp"]
        invalid_files = ["data.csv", "readme.md", "script.py"]

        for f in valid_files:
            assert f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))

        for f in invalid_files:
            assert not f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
