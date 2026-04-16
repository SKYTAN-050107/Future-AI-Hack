"""Firebase Admin SDK initialization (singleton pattern)."""

from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, messaging

from config.settings import settings

_app = None


def get_firebase_app() -> firebase_admin.App:
    """Initialize Firebase Admin SDK once and return the app."""
    global _app
    if _app is None:
        cred = None
        raw_creds = (settings.google_application_credentials or "").strip()

        if raw_creds:
            creds_path = Path(raw_creds).expanduser()
            if not creds_path.is_absolute():
                backend_root = Path(__file__).resolve().parents[2]
                creds_path = (backend_root / creds_path).resolve()

            if creds_path.exists():
                cred = credentials.Certificate(str(creds_path))
            else:
                raise FileNotFoundError(
                    f"Firebase service account file not found: {creds_path}"
                )

        if cred is None:
            cred = credentials.ApplicationDefault()

        _app = firebase_admin.initialize_app(cred)
    return _app


def get_firestore_client() -> firestore.firestore.Client:
    """Return a Firestore client (initializes Firebase if needed)."""
    get_firebase_app()
    return firestore.client()


def get_messaging():
    """Return the Firebase messaging module."""
    get_firebase_app()
    return messaging
