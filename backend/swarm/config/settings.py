"""Centralized configuration loaded from environment variables."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings sourced from .env file or environment."""

    # Google Cloud (Vertex fallback)
    gcp_project_id: str = Field(
        default="", description="Google Cloud project ID"
    )
    gcp_region: str = Field(
        default="us-central1", description="Google Cloud region"
    )

    # Google AI
    google_genai_api_key: str = Field(
        default="", description="Gemini API key"
    )

    # Tomorrow.io
    tomorrow_io_api_key: str = Field(
        default="", description="Tomorrow.io API key"
    )
    tomorrow_io_base_url: str = Field(
        default="https://api.tomorrow.io/v4/weather/forecast",
        description="Tomorrow.io forecast endpoint",
    )

    # MCP Server
    mcp_server_url: str = Field(
        default="", description="ManaMurah MCP SSE endpoint URL"
    )

    # Firebase
    google_application_credentials: str = Field(
        default="", description="Path to Firebase service account JSON"
    )

    model_config = {
        "env_file": os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        "env_file_encoding": "utf-8",
        # diagnosis and swarm share one .env; ignore unrelated keys.
        "extra": "ignore",
    }


# Singleton instance — import this everywhere
settings = Settings()

raw_creds = (settings.google_application_credentials or "").strip()
if raw_creds:
    backend_root = Path(__file__).resolve().parents[2]
    creds_path = Path(raw_creds).expanduser()
    if not creds_path.is_absolute():
        creds_path = (backend_root / creds_path).resolve()

    settings.google_application_credentials = str(creds_path)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(creds_path)
