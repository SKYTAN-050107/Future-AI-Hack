"""Shared LLM client using google-genai SDK directly.

The genkit-google-genai plugin doesn't have a Python 3.14 wheel yet,
so we use the google-genai SDK directly for LLM calls while keeping
Genkit for flow/tool orchestration.
"""

import logging

from google import genai

from config.settings import settings

logger = logging.getLogger(__name__)

VERTEX_MODEL_NAME = "publishers/google/models/gemini-2.5-flash"
API_MODEL_NAME = "gemini-2.0-flash"

_api_client = None
_vertex_client = None


def _is_api_quota_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "resource_exhausted" in message or "credits are depleted" in message


def get_api_client() -> genai.Client | None:
    """Return a singleton API-key client when key is configured."""
    global _api_client

    if _api_client is None:
        api_key = (settings.google_genai_api_key or "").strip()
        if not api_key:
            return None
        _api_client = genai.Client(api_key=api_key)

    return _api_client


def get_vertex_client() -> genai.Client:
    """Return a singleton Vertex client for service-account backed fallback."""
    global _vertex_client

    if _vertex_client is None:
        _vertex_client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gcp_region,
        )

    return _vertex_client


async def _generate_with_best_available_client(
    *,
    prompt: str,
    system: str | None,
    response_mime_type: str | None,
) -> str:
    config = {}
    if system:
        config["system_instruction"] = system
    if response_mime_type:
        config["response_mime_type"] = response_mime_type

    api_client = get_api_client()
    if api_client is not None:
        try:
            response = await api_client.aio.models.generate_content(
                model=API_MODEL_NAME,
                contents=prompt,
                config=config,
            )
            return response.text
        except Exception as exc:
            if not _is_api_quota_error(exc):
                raise
            logger.warning(
                "Google GenAI API key quota exhausted. Falling back to Vertex model %s",
                VERTEX_MODEL_NAME,
            )

    response = await get_vertex_client().aio.models.generate_content(
        model=VERTEX_MODEL_NAME,
        contents=prompt,
        config=config,
    )
    return response.text


async def llm_generate(prompt: str, system: str | None = None) -> str:
    """Generate text using Gemini 2.0 Flash.

    Args:
        prompt: The user prompt.
        system: Optional system instruction.

    Returns:
        The generated text response.
    """
    return await _generate_with_best_available_client(
        prompt=prompt,
        system=system,
        response_mime_type=None,
    )


async def llm_generate_json(prompt: str, system: str | None = None) -> str:
    """Generate JSON output using Gemini 2.0 Flash.

    Args:
        prompt: The user prompt.
        system: Optional system instruction.

    Returns:
        The raw JSON string response.
    """
    return await _generate_with_best_available_client(
        prompt=prompt,
        system=system,
        response_mime_type="application/json",
    )
