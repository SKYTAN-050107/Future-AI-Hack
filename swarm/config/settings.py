"""Centralized configuration loaded from environment variables."""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings sourced from .env file or environment."""

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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


# Singleton instance — import this everywhere
settings = Settings()
