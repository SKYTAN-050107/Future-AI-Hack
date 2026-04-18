import { useCallback } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from '../firebase'

const REPORT_COLLECTION = 'scanReports'

export function useScanReports() {
  const saveScanReport = useCallback(async (report) => {
    if (!db || !isFirebaseConfigured) {
      throw new Error('Firebase is not configured')
    }

    const ownerUid = String(report?.ownerUid || report?.userId || auth?.currentUser?.uid || '').trim()
    if (!ownerUid) {
      throw new Error('Sign in is required to save scan reports')
    }

    const survivalProbValue = Number(report.survivalProb ?? report.survival_prob)

    const payload = {
      ownerUid,
      userId: ownerUid,
      uid: ownerUid,
      disease: report.disease || 'Unknown',
      severity: Number(report.severity || 0),
      confidence: Number(report.confidence || 0),
      spreadRisk: report.spreadRisk || report.spread_risk || 'Unknown',
      cropType: report.cropType || report.crop_type || null,
      treatmentPlan: report.treatmentPlan || report.treatment_plan || null,
      survivalProb: Number.isFinite(survivalProbValue) ? survivalProbValue : null,
      status: report.status || 'normal',
      source: report.source || 'camera',
      gridId: report.gridId || null,
      zone: report.zone || null,
      note: report.note || null,
      captureId: report.captureId || null,
      captureDownloadURL: report.captureDownloadURL || null,
      captureStoragePath: report.captureStoragePath || null,
      captureCapturedAt: report.captureCapturedAt || null,
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
