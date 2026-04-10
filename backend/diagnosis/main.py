"""
PadiGuard AI — Multi-Agent Plant Diagnosis Backend

FastAPI application entrypoint.

Run with:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

Or for production:
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
"""

from __future__ import annotations

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.router import router

# ── Logging Setup ─────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-28s │ %(levelname)-5s │ %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)

# ── Application Factory ──────────────────────────────────────────────

app = FastAPI(
    title="PadiGuard AI — Plant Diagnosis API",
    description=(
        "Multi-agent backend for plant disease diagnosis using "
        "Image/Text retrieval + LLM validation pipeline."
    ),
    version="0.1.0",
)

# ── CORS (allow frontend access) ─────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount Routes ─────────────────────────────────────────────────────

app.include_router(router)


# ── Health Check ─────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health_check() -> dict:
    """Simple liveness probe."""
    return {"status": "ok", "service": "diagnosis-api"}
