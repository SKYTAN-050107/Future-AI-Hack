"""
PadiGuard AI — Live-Scan Backend

Google ADK + Vertex AI powered real-time plant disease scanner.

Run:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.router import router

# ── Logging ───────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-28s │ %(levelname)-5s │ %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)

# ── App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="PadiGuard AI — Live Scan",
    description="Google ADK + Vertex AI real-time plant disease scanner.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health", tags=["system"])
async def health() -> dict:
    """Liveness probe."""
    return {"status": "ok", "service": "padiguard-livescan"}
