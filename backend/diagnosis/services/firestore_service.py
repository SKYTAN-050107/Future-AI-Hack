"""
Firestore service — records scan results and grid health updates.

Writes to:
- ``scanReports`` — triggers the ``updateGridStatus`` Cloud Function.
- ``grids`` — direct health-state writes (triggers ``spatialPropagationAnalysis``).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from google.cloud import firestore

from config import get_settings

logger = logging.getLogger(__name__)


class FirestoreService:
    """Cloud Firestore write-back for scan results and grid health."""

    def __init__(self) -> None:
        settings = get_settings()
        self._db = firestore.Client(project=settings.GCP_PROJECT_ID)
        self._report_col = settings.FIRESTORE_REPORT_COLLECTION
        self._grid_col = settings.FIRESTORE_GRID_COLLECTION

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
        """Write a scan report to Firestore.

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

        doc_ref = self._db.collection(self._report_col).document()
        doc_ref.set(doc_data)

        logger.info(
            "Firestore scanReport %s → grid=%s disease=%s abnormal=%s",
            doc_ref.id, grid_id, disease, is_abnormal,
        )
        return doc_ref.id
