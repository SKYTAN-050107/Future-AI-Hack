"""
Centralized configuration via environment variables.

Uses pydantic-settings to load from .env or system environment.
"""

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
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

    # ── Assistant Scan Performance Controls ────────────────────────────
    ASSISTANT_SCAN_ENABLE_AUTO_MULTI_REGION: bool = False
    ASSISTANT_SCAN_ENABLE_LLM_PHOTO_REPLY: bool = False
    ASSISTANT_SCAN_ENABLE_PHOTO_REPLY_VALIDATION: bool = False

    # ── External Crop Intelligence APIs ───────────────────────────────
    TOMORROW_IO_API_KEY: str = ""
    TOMORROW_IO_BASE_URL: str = "https://api.tomorrow.io/v4/weather/forecast"
    MCP_SERVER_URL: str = ""

    # ── Cloud Firestore ────────────────────────────────────────────────
    FIRESTORE_GRID_COLLECTION: str = "grids"
    FIRESTORE_REPORT_COLLECTION: str = "scanReports"
    FIRESTORE_CANDIDATE_COLLECTION: str = "candidateMetadata"
    FIRESTORE_CROP_COLLECTION: str = "crops"
    FIRESTORE_PESTICIDE_COLLECTION: str = "pesticideCatalog"

    # ── Pipeline Defaults ──────────────────────────────────────────────
    DEFAULT_TOP_K: int = 5


@lru_cache()
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    settings = Settings()

    raw_creds = (settings.GOOGLE_APPLICATION_CREDENTIALS or "").strip()
    if raw_creds:
        creds_path = Path(raw_creds).expanduser()
        if not creds_path.is_absolute():
            creds_path = (BACKEND_ROOT / creds_path).resolve()

        settings.GOOGLE_APPLICATION_CREDENTIALS = str(creds_path)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(creds_path)

    return settings
