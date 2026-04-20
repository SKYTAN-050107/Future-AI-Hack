"""
Firestore service — records scan results and grid health updates.

Writes to:
- ``scanReports`` — triggers the ``updateGridStatus`` Cloud Function.
- ``users/{uid}/grids`` (fallback ``grids``) — direct health-state writes.

Uses ``asyncio.to_thread`` to run the synchronous Firestore SDK
without blocking the event loop.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

from google.cloud import firestore

from config import get_settings
from services.firebase_admin_service import get_firestore_client

logger = logging.getLogger(__name__)


class FirestoreService:
    """Cloud Firestore write-back for scan results and grid health."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = get_firestore_client()
        self._report_col = settings.FIRESTORE_REPORT_COLLECTION
        self._grid_col = settings.FIRESTORE_GRID_COLLECTION
        self._candidate_col = settings.FIRESTORE_CANDIDATE_COLLECTION
        self._pesticide_col = getattr(
            settings,
            "FIRESTORE_PESTICIDE_COLLECTION",
            "pesticideCatalog",
        )

    async def get_candidate_metadata_by_id(self, candidate_id: str) -> dict:
        """Read candidate metadata from Firestore using Vector Search candidate ID.

        Args:
            candidate_id: Vector Search neighbor/datapoint ID.

        Returns:
            Metadata dict from Firestore document. Empty dict when not found.
        """
        if not candidate_id:
            return {}
        return await asyncio.to_thread(self._read_candidate_metadata, candidate_id)

    async def record_scan_result(
        self,
        grid_id: str,
        cropType: str,
        disease: str,
        severity: str,
        severityScore: float,
        treatmentPlan: str,
        survivalProb: float,
        is_abnormal: bool,
        user_id: str | None = None,
        recommended_pesticides: list[str] | None = None,
        recommendation_source: str | None = None,
        matched_pest_name: str | None = None,
    ) -> str:
        """Write a scan report to Firestore and update grid health.

        This triggers the ``updateGridStatus`` Cloud Function,
        which sets the grid health to 'Infected' when abnormal.

        Returns:
            Firestore document ID.
        """
        doc_data = {
            "gridId": grid_id,
            "ownerUid": user_id,
            "userId": user_id,
            "uid": user_id,
            "cropType": cropType,
            "disease": disease,
            "severityLevel": severity,
            "severity": severity,
            "severityScore": severityScore,
            "treatmentPlan": treatmentPlan,
            "survivalProb": survivalProb,
            "status": "abnormal" if is_abnormal else "normal",
            "abnormal": is_abnormal,
            "timestamp": datetime.now(timezone.utc),
        }

        if recommended_pesticides:
            doc_data["recommendedPesticides"] = [
                item
                for item in recommended_pesticides
                if str(item).strip()
            ]
        if recommendation_source:
            doc_data["recommendationSource"] = str(recommendation_source).strip()
        if matched_pest_name:
            doc_data["matchedPestName"] = str(matched_pest_name).strip()

        # Run synchronous Firestore writes in a thread to avoid blocking the event loop
        doc_id = await asyncio.to_thread(self._write_scan_report, doc_data)

        # If abnormal, update the grid health status
        if is_abnormal and grid_id:
            await asyncio.to_thread(
                self._update_grid_health,
                grid_id=grid_id,
                user_id=user_id,
                disease=disease,
                severity=severity,
                severityScore=severityScore,
            )

        return doc_id

    async def get_pesticide_catalog_recommendation(self, pest_name: str) -> dict:
        """Return pesticide recommendation metadata for a detected pest name.

        Returns an empty dict when no catalog match exists.
        """
        if not str(pest_name or "").strip():
            return {}

        catalog_entry = await asyncio.to_thread(
            self._read_pesticide_catalog_by_pest_name,
            pest_name,
        )
        if not catalog_entry:
            return {}

        recommended = self._split_pesticide_list(
            catalog_entry.get("mostCommonlyUsedPesticides"),
        )
        if not recommended:
            return {}

        matched_pest_name = str(catalog_entry.get("pestName") or pest_name).strip()
        matched_doc_id = str(catalog_entry.get("_matchedDocId") or "").strip()

        return {
            "matchedPestName": matched_pest_name or str(pest_name).strip(),
            "matchedDocId": matched_doc_id,
            "recommendedPesticides": recommended,
            "recommendationSource": "pesticideCatalog",
        }

    # ── Internal synchronous Firestore operations ─────────────────────

    def _write_scan_report(self, doc_data: dict) -> str:
        """Synchronous write to scanReports collection."""
        doc_ref = self._db.collection(self._report_col).document()
        doc_ref.set(doc_data)

        logger.info(
            "Firestore scanReport %s → grid=%s disease=%s abnormal=%s",
            doc_ref.id,
            doc_data.get("gridId"),
            doc_data.get("disease"),
            doc_data.get("abnormal"),
        )
        return doc_ref.id

    def _read_pesticide_catalog_by_pest_name(self, pest_name: str) -> dict:
        """Synchronous lookup from pesticide catalog by detected pest name."""
        clean_name = str(pest_name or "").strip()
        if not clean_name:
            return {}

        collection = self._db.collection(self._pesticide_col)
        doc_id_candidates = self._build_catalog_doc_id_candidates(clean_name)

        for doc_id in doc_id_candidates:
            snapshot = collection.document(doc_id).get()
            if snapshot.exists:
                data = snapshot.to_dict() or {}
                data["_matchedDocId"] = doc_id
                logger.info(
                    "Pesticide catalog hit by doc id: collection=%s id=%s",
                    self._pesticide_col,
                    doc_id,
                )
                return data

        exact_matches = list(
            collection.where("pestName", "==", clean_name).limit(1).stream(),
        )
        if exact_matches:
            snapshot = exact_matches[0]
            data = snapshot.to_dict() or {}
            data["_matchedDocId"] = str(getattr(snapshot, "id", "")).strip()
            logger.info(
                "Pesticide catalog hit by exact pestName: collection=%s pestName=%s",
                self._pesticide_col,
                clean_name,
            )
            return data

        # Final fallback for case/spacing variance: compare normalized pestName locally.
        target_keys = set(doc_id_candidates)
        snapshots = collection.limit(300).stream()
        for snapshot in snapshots:
            data = snapshot.to_dict() or {}
            candidate_name = data.get("pestName")
            if self._normalize_catalog_key(candidate_name) in target_keys:
                data["_matchedDocId"] = str(getattr(snapshot, "id", "")).strip()
                logger.info(
                    "Pesticide catalog hit by normalized pestName scan: collection=%s pestName=%s",
                    self._pesticide_col,
                    clean_name,
                )
                return data

        logger.info(
            "Pesticide catalog miss: collection=%s pestName=%s",
            self._pesticide_col,
            clean_name,
        )
        return {}

    @staticmethod
    def _normalize_catalog_key(value: object) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())
        normalized = normalized.strip("_")
        return normalized or "unknown_pest"

    @classmethod
    def _build_catalog_doc_id_candidates(cls, pest_name: str) -> list[str]:
        raw = str(pest_name or "").strip()
        if not raw:
            return []

        candidates: list[str] = []

        def add_candidate(text: str) -> None:
            key = cls._normalize_catalog_key(text)
            if key != "unknown_pest" and key not in candidates:
                candidates.append(key)

        add_candidate(raw)

        no_parentheses = re.sub(r"\([^)]*\)", "", raw).strip()
        if no_parentheses and no_parentheses != raw:
            add_candidate(no_parentheses)

        no_prefix = re.sub(r"^the\s+", "", raw, flags=re.IGNORECASE).strip()
        if no_prefix and no_prefix != raw:
            add_candidate(no_prefix)

        return candidates

    @staticmethod
    def _split_pesticide_list(value: object) -> list[str]:
        if isinstance(value, list):
            raw_items = [str(item).strip() for item in value]
        else:
            text = str(value or "").replace("\n", ",")
            raw_items = [segment.strip() for segment in re.split(r"[;,]", text)]

        cleaned: list[str] = []
        seen: set[str] = set()
        for item in raw_items:
            if not item:
                continue
            key = item.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(item)

        return cleaned

    def _read_candidate_metadata(self, candidate_id: str) -> dict:
        """Synchronous read from candidate metadata collection by document ID."""
        doc_ref = self._db.collection(self._candidate_col).document(candidate_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            logger.warning(
                "Candidate metadata not found in Firestore: collection=%s id=%s",
                self._candidate_col,
                candidate_id,
            )
            return {}

        data = snapshot.to_dict() or {}
        logger.info(
            "Firestore candidate metadata loaded: collection=%s id=%s keys=%s",
            self._candidate_col,
            candidate_id,
            list(data.keys()),
        )
        return data

    def _update_grid_health(
        self,
        grid_id: str,
        disease: str,
        severity: str,
        severityScore: float,
        user_id: str | None = None,
    ) -> None:
        """Update grid document health status to 'Infected'.

        Prefers the user-scoped grid collection when ``user_id`` is provided.
        Falls back to the legacy root collection for backward compatibility.
        """
        grid_ref = None

        if user_id:
            user_grid_collection = (
                self._db.collection("users")
                .document(user_id)
                .collection(self._grid_col)
            )

            by_grid_id = list(user_grid_collection.where("gridId", "==", grid_id).limit(1).stream())
            if by_grid_id:
                grid_ref = by_grid_id[0].reference
            else:
                direct_ref = user_grid_collection.document(grid_id)
                if direct_ref.get().exists:
                    grid_ref = direct_ref

        if grid_ref is None:
            grid_ref = self._db.collection(self._grid_col).document(grid_id)

        grid_ref.set(
            {
                "healthStatus": "Infected",
                "lastDetectedDisease": disease,
                "lastSeverity": severity,
                "lastSeverityScore": severityScore,
                "lastInfectionTimestamp": datetime.now(timezone.utc),
            },
            merge=True,  # Don't overwrite existing grid data (e.g., location)
        )

        logger.info(
            "Firestore grid %s (user_id=%s) → healthStatus='Infected' (disease=%s)",
            grid_id,
            user_id,
            disease,
        )
