"""Unit tests for pesticide catalog lookup and normalization logic."""

from __future__ import annotations

import pytest

from services.firestore_service import FirestoreService


class _FakeSnapshot:
    def __init__(self, doc_id: str, data: dict | None) -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict:
        return dict(self._data or {})


class _FakeDocumentRef:
    def __init__(self, collection: "_FakeCollection", doc_id: str) -> None:
        self._collection = collection
        self._doc_id = doc_id

    def get(self) -> _FakeSnapshot:
        data = self._collection.docs.get(self._doc_id)
        return _FakeSnapshot(self._doc_id, data)


class _FakeQuery:
    def __init__(self, docs: list[tuple[str, dict]]) -> None:
        self._docs = docs

    def limit(self, count: int) -> "_FakeQuery":
        return _FakeQuery(self._docs[:count])

    def stream(self) -> list[_FakeSnapshot]:
        return [_FakeSnapshot(doc_id, data) for doc_id, data in self._docs]


class _FakeCollection:
    def __init__(self, docs: dict[str, dict]) -> None:
        self.docs = docs

    def document(self, doc_id: str) -> _FakeDocumentRef:
        return _FakeDocumentRef(self, doc_id)

    def where(self, field: str, op: str, value: str) -> _FakeQuery:
        if op != "==":
            return _FakeQuery([])

        matched = [
            (doc_id, data)
            for doc_id, data in self.docs.items()
            if str(data.get(field, "")).strip() == str(value).strip()
        ]
        return _FakeQuery(matched)

    def limit(self, count: int) -> _FakeQuery:
        all_docs = list(self.docs.items())
        return _FakeQuery(all_docs[:count])


class _FakeFirestoreClient:
    def __init__(self, collections: dict[str, dict[str, dict]]) -> None:
        self._collections = collections

    def collection(self, name: str) -> _FakeCollection:
        return _FakeCollection(self._collections.get(name, {}))


def _build_service(catalog_docs: dict[str, dict]) -> FirestoreService:
    service = object.__new__(FirestoreService)
    service._db = _FakeFirestoreClient({"pesticideCatalog": catalog_docs})
    service._pesticide_col = "pesticideCatalog"
    return service


@pytest.mark.asyncio
async def test_catalog_recommendation_hit_from_doc_id() -> None:
    service = _build_service(
        {
            "rice_blast": {
                "pestName": "Rice Blast",
                "mostCommonlyUsedPesticides": "Tricyclazole, Isoprothiolane, Propiconazole",
            }
        }
    )

    recommendation = await service.get_pesticide_catalog_recommendation("Rice Blast")

    assert recommendation["recommendationSource"] == "pesticideCatalog"
    assert recommendation["matchedPestName"] == "Rice Blast"
    assert recommendation["recommendedPesticides"] == [
        "Tricyclazole",
        "Isoprothiolane",
        "Propiconazole",
    ]


@pytest.mark.asyncio
async def test_catalog_recommendation_miss_returns_empty() -> None:
    service = _build_service(
        {
            "brown_spot": {
                "pestName": "Brown Spot",
                "mostCommonlyUsedPesticides": "Mancozeb",
            }
        }
    )

    recommendation = await service.get_pesticide_catalog_recommendation("Imaginary Pest")

    assert recommendation == {}


@pytest.mark.asyncio
async def test_catalog_lookup_fallback_normalized_name_scan() -> None:
    service = _build_service(
        {
            "doc_123": {
                "pestName": "Aleurocanthus spiniferus",
                "mostCommonlyUsedPesticides": "Imidacloprid, Acetamiprid",
            }
        }
    )

    recommendation = await service.get_pesticide_catalog_recommendation("Aleurocanthus   spiniferus")

    assert recommendation["matchedPestName"] == "Aleurocanthus spiniferus"
    assert recommendation["recommendedPesticides"] == ["Imidacloprid", "Acetamiprid"]


def test_split_pesticide_list_deduplicates_and_trims() -> None:
    parsed = FirestoreService._split_pesticide_list(
        "Imidacloprid,  Acetamiprid; imidacloprid ;  ",
    )

    assert parsed == ["Imidacloprid", "Acetamiprid"]
