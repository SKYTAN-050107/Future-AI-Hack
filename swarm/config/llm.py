"""Shared LLM client using google-genai SDK directly.

The genkit-google-genai plugin doesn't have a Python 3.14 wheel yet,
so we use the google-genai SDK directly for LLM calls while keeping
Genkit for flow/tool orchestration.
"""

from google import genai
from config.settings import settings

_client = None

def get_genai_client() -> genai.Client:
    """Return a singleton google-genai Client."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.google_genai_api_key)
    return _client


async def llm_generate(prompt: str, system: str | None = None) -> str:
    """Generate text using Gemini 2.0 Flash.

    Args:
        prompt: The user prompt.
        system: Optional system instruction.

    Returns:
        The generated text response.
    """
    client = get_genai_client()

    config = {}
    if system:
        config["system_instruction"] = system

    response = await client.aio.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=config,
    )

    return response.text


async def llm_generate_json(prompt: str, system: str | None = None) -> str:
    """Generate JSON output using Gemini 2.0 Flash.

    Args:
        prompt: The user prompt.
        system: Optional system instruction.

    Returns:
        The raw JSON string response.
    """
    client = get_genai_client()

    config = {"response_mime_type": "application/json"}
    if system:
        config["system_instruction"] = system

    response = await client.aio.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=config,
    )

    return response.text
