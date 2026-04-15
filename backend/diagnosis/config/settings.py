"""
Centralized configuration via environment variables.

Uses pydantic-settings to load from .env or system environment.
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ── Google Cloud Core ──────────────────────────────────────────────
    GCP_PROJECT_ID: str
    GCP_REGION: str = "us-central1"
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    GCS_BUCKET_NAME: str = "disease_dataset_pd"  # Added to prevent validation issues

    # ── Vertex AI Multimodal Embedding ─────────────────────────────────
    EMBEDDING_MODEL: str = "multimodalembedding@001"
    EMBEDDING_DIMENSION: int = 1408

    # ── Vertex AI Vector Search ────────────────────────────────────────
    VECTOR_SEARCH_INDEX_ENDPOINT: str
    VECTOR_SEARCH_DEPLOYED_INDEX_ID: str
    VECTOR_SEARCH_CONFIDENCE_THRESHOLD: float = 0.65
    VECTOR_SEARCH_FAST_MATCH_THRESHOLD: float = 0.85

    # ── Vertex AI Gemini ───────────────────────────────────────────────
    GEMINI_MODEL_NAME: str = "gemini-2.0-flash"

    # ── Cloud Firestore ────────────────────────────────────────────────
    FIRESTORE_GRID_COLLECTION: str = "grids"
    FIRESTORE_REPORT_COLLECTION: str = "scanReports"
    FIRESTORE_CANDIDATE_COLLECTION: str = "candidateMetadata"

    # ── Pipeline Defaults ──────────────────────────────────────────────
    DEFAULT_TOP_K: int = 5
    WS_AUTO_REGION_DETECTION: bool = False
    WS_REGION_DETECTION_TIMEOUT_SECONDS: float = 2.5


@lru_cache()
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
