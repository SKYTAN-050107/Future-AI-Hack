"""Firebase Admin SDK bootstrap for Firestore access."""

from __future__ import annotations

import logging
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

from config import get_settings

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None
_firestore_client: firestore.firestore.Client | None = None


def _build_credentials() -> credentials.Base:
    settings = get_settings()
    raw_creds = (settings.GOOGLE_APPLICATION_CREDENTIALS or "").strip()

    if not raw_creds:
        logger.info("Firebase Admin init using Application Default Credentials")
        return credentials.ApplicationDefault()

    creds_path = Path(raw_creds).expanduser()
    if not creds_path.is_absolute():
        backend_root = Path(__file__).resolve().parents[2]
        creds_path = (backend_root / creds_path).resolve()

    if not creds_path.exists():
        raise FileNotFoundError(f"Firebase service account file not found: {creds_path}")

    logger.info("Firebase Admin init using service account: %s", creds_path)
    return credentials.Certificate(str(creds_path))


def get_firebase_app() -> firebase_admin.App:
    """Initialize Firebase Admin once and return the app instance."""
    global _app

    if _app is not None:
        return _app

    if firebase_admin._apps:  # pylint: disable=protected-access
        _app = firebase_admin.get_app()
        return _app

    settings = get_settings()
    cred = _build_credentials()
    _app = firebase_admin.initialize_app(cred, {"projectId": settings.GCP_PROJECT_ID})
    return _app


def get_firestore_client() -> firestore.firestore.Client:
    """Return a singleton Firestore client from Firebase Admin SDK."""
    global _firestore_client

    if _firestore_client is not None:
        return _firestore_client

    get_firebase_app()
    _firestore_client = firestore.client()
    return _firestore_client
