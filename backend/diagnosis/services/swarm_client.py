"""HTTP client for the Swarm Orchestrator service (Genkit, separate process).

Features:
- Connection pooling via a shared ``httpx.AsyncClient``
- Configurable connect / read / write / pool timeouts
- Automatic retry with exponential backoff on transient errors
- Graceful degradation when SWARM_API_BASE_URL is unset
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

_MAX_RETRIES = 2
_BASE_DELAY_S = 0.5


class SwarmUnavailableError(RuntimeError):
    """Raised when the swarm service is not configured or unreachable."""


class SwarmClient:
    """Async client for the Genkit swarm reflection server.

    The swarm is deployed as a separate process (see ``backend/swarm/main.py``)
    and exposes its registered flows via the Genkit reflection convention
    ``POST /api/runAction`` with a body of ``{"key": "/flow/<name>", "input": {...}}``.

    Connection pooling: a single ``httpx.AsyncClient`` is reused for all calls
    (created lazily on first request) to avoid TCP connection overhead on every
    tool call.
    """

    DEFAULT_CONNECT_TIMEOUT = 5.0
    DEFAULT_READ_TIMEOUT = 45.0
    DEFAULT_WRITE_TIMEOUT = 10.0
    DEFAULT_POOL_TIMEOUT = 10.0

    def __init__(self) -> None:
        settings = get_settings()
        base_url = str(settings.SWARM_API_BASE_URL or "").strip().rstrip("/")
        self._base_url = base_url
        self._client: httpx.AsyncClient | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url)

    def _get_client(self) -> httpx.AsyncClient:
        """Return the shared, pooled HTTP client (created lazily)."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=self.DEFAULT_CONNECT_TIMEOUT,
                    read=self.DEFAULT_READ_TIMEOUT,
                    write=self.DEFAULT_WRITE_TIMEOUT,
                    pool=self.DEFAULT_POOL_TIMEOUT,
                ),
                limits=httpx.Limits(
                    max_connections=10,
                    max_keepalive_connections=5,
                ),
            )
        return self._client

    async def close(self) -> None:
        """Close the underlying connection pool."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def run_orchestrator(self, swarm_input: dict[str, Any]) -> dict[str, Any]:
        return await self._run_flow("swarm_orchestrator", swarm_input)

    async def run_meteorologist(self, meteorologist_input: dict[str, Any]) -> dict[str, Any]:
        return await self._run_flow("meteorologist_flow", meteorologist_input)

    async def _run_flow(self, flow_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self._base_url:
            raise SwarmUnavailableError(
                "SWARM_API_BASE_URL is not configured on the diagnosis backend"
            )

        url = f"{self._base_url}/api/runAction"
        body = {"key": f"/flow/{flow_name}", "input": payload}
        client = self._get_client()

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = await client.post(url, json=body)
                response.raise_for_status()
                result = response.json()

                if isinstance(result, dict) and "result" in result and isinstance(result["result"], dict):
                    return result["result"]
                if isinstance(result, dict):
                    return result
                return {}

            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "Swarm flow %s returned HTTP %d (attempt %d): %s",
                    flow_name,
                    exc.response.status_code,
                    attempt + 1,
                    exc.response.text[:200],
                )
                # Don't retry on 4xx client errors (they won't change)
                if 400 <= exc.response.status_code < 500:
                    raise SwarmUnavailableError(
                        f"Swarm flow {flow_name} failed with HTTP {exc.response.status_code}"
                    ) from exc
                last_exc = exc

            except httpx.RequestError as exc:
                logger.warning(
                    "Swarm flow %s unreachable (attempt %d): %s",
                    flow_name,
                    attempt + 1,
                    exc,
                )
                last_exc = exc

            # Exponential backoff before retry
            if attempt < _MAX_RETRIES:
                delay = _BASE_DELAY_S * (2 ** attempt)
                logger.info(
                    "Retrying swarm flow %s in %.1fs (attempt %d/%d)",
                    flow_name, delay, attempt + 2, _MAX_RETRIES + 1,
                )
                await asyncio.sleep(delay)

        raise SwarmUnavailableError(
            f"Swarm service unreachable after {_MAX_RETRIES + 1} attempts: {last_exc}"
        )
