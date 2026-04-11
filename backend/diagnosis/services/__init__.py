"""
Service layer — Vertex AI and Google Cloud integrations.

- EmbeddingService:     Vertex AI Multimodal Embedding (1408-dim)
- VectorSearchService:  Vertex AI Vector Search (Matching Engine)
- LLMService:           Gemini 2 Flash via Vertex AI
- FirestoreService:     Cloud Firestore write-back
"""

from services.embedding_service import EmbeddingService
from services.vector_search_service import VectorSearchService
from services.llm_service import LLMService
from services.firestore_service import FirestoreService

__all__ = [
    "EmbeddingService",
    "VectorSearchService",
    "LLMService",
    "FirestoreService",
]
