"""
Centralized configuration via environment variables.

Uses pydantic-settings to load from .env or system environment.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )

    # ── Google Cloud Core ──────────────────────────────────────────────
    GCP_PROJECT_ID: str
    GCP_REGION: str = "us-central1"
    GOOGLE_APPLICATION_CREDENTIALS: str = ""

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

    # ── Pipeline Defaults ──────────────────────────────────────────────
    DEFAULT_TOP_K: int = 5


@lru_cache()
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
