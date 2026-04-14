"""Firebase Admin SDK initialization (singleton pattern)."""

import firebase_admin
from firebase_admin import credentials, firestore, messaging

_app = None


def get_firebase_app() -> firebase_admin.App:
    """Initialize Firebase Admin SDK once and return the app."""
    global _app
    if _app is None:
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
