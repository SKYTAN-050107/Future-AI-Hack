"""
Service layer — Vertex AI and Google Cloud integrations.

- EmbeddingService:     Vertex AI Multimodal Embedding (1408-dim)
- VectorSearchService:  Vertex AI Vector Search (Matching Engine)
- FirestoreService:     Cloud Firestore write-back

Imports are lazy so that modules without heavy dependencies (e.g. vertexai)
can still be imported in lightweight test environments.
"""


def __getattr__(name: str):
    """Lazy-import services on first access."""
    _registry = {
        "EmbeddingService": ("services.embedding_service", "EmbeddingService"),
        "VectorSearchService": ("services.vector_search_service", "VectorSearchService"),
        "FirestoreService": ("services.firestore_service", "FirestoreService"),
    }
    if name in _registry:
        module_path, attr = _registry[name]
        import importlib
        mod = importlib.import_module(module_path)
        return getattr(mod, attr)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "EmbeddingService",
    "VectorSearchService",
    "FirestoreService",
]

