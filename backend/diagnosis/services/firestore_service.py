"""
Firestore service — records scan results and grid health updates.

Writes to:
- ``scanReports`` — triggers the ``updateGridStatus`` Cloud Function.
- ``grids`` — direct health-state writes (triggers ``spatialPropagationAnalysis``).

Uses ``asyncio.to_thread`` to run the synchronous Firestore SDK
without blocking the event loop.
"""

from __future__ import annotations

import asyncio
import logging
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
    ) -> str:
        """Write a scan report to Firestore and update grid health.

        This triggers the ``updateGridStatus`` Cloud Function,
        which sets the grid health to 'Infected' when abnormal.

        Returns:
            Firestore document ID.
        """
        doc_data = {
            "gridId": grid_id,
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

        # Run synchronous Firestore writes in a thread to avoid blocking the event loop
        doc_id = await asyncio.to_thread(self._write_scan_report, doc_data)

        # If abnormal, update the grid health status
        if is_abnormal and grid_id:
            await asyncio.to_thread(
                self._update_grid_health,
                grid_id=grid_id,
                disease=disease,
                severity=severity,
                severityScore=severityScore,
            )

        return doc_id

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
    ) -> None:
        """Update grid document health status to 'Infected'.

        This write triggers the ``spatialPropagationAnalysis`` Cloud Function
        which automatically flags neighboring grids within 200m as 'At-Risk'.
        """
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
            "Firestore grid %s → healthStatus='Infected' (disease=%s)",
            grid_id, disease,
        )
