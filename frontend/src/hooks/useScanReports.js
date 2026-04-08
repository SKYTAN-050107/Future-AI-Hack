import { useCallback } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'

const REPORT_COLLECTION = 'scanReports'

export function useScanReports() {
  const saveScanReport = useCallback(async (report) => {
    if (!db || !isFirebaseConfigured) {
      throw new Error('Firebase is not configured')
    }

    const payload = {
      disease: report.disease || 'Unknown',
      severity: Number(report.severity || 0),
      confidence: Number(report.confidence || 0),
      spreadRisk: report.spreadRisk || report.spread_risk || 'Unknown',
      status: report.status || 'normal',
      source: report.source || 'camera',
      gridId: report.gridId || null,
      zone: report.zone || null,
      note: report.note || null,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    }

    return addDoc(collection(db, REPORT_COLLECTION), payload)
  }, [])

  return {
    saveScanReport,
    isFirebaseConfigured,
  }
}
