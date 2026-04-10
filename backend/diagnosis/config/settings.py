"""
Centralized configuration via environment variables.

Uses pydantic-settings to load from .env file or system environment.
All Google Cloud and service-specific settings are defined here.
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

    # ── Vertex AI Embedding ────────────────────────────────────────────
    EMBEDDING_MODEL: str = "multimodalembedding@001"
    EMBEDDING_DIMENSION: int = 1408

    # ── Vertex AI Vector Search ────────────────────────────────────────
    VECTOR_SEARCH_INDEX_ENDPOINT: str
    VECTOR_SEARCH_DEPLOYED_INDEX_ID: str

    # ── LLM (Gemini) ──────────────────────────────────────────────────
    GEMINI_MODEL_NAME: str = "gemini-2.0-flash"

    # ── Cloud Storage ─────────────────────────────────────────────────
    GCS_BUCKET_NAME: str

    # ── Pipeline Defaults ─────────────────────────────────────────────
    DEFAULT_TOP_K: int = 5


@lru_cache()
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
