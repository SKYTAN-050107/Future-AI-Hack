import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'

const REPORT_COLLECTION = 'scanReports'

function toMillis(value) {
  if (!value) {
    return 0
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis()
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  return 0
}

function formatDate(value) {
  const time = toMillis(value)
  if (!time) {
    return 'Recently'
  }

  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time))
}

export function useScanHistory() {
  const [reports, setReports] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!db || !isFirebaseConfigured) {
      setReports([])
      setIsLoading(false)
      setError('Firebase is not configured yet. Scan history is unavailable.')
      return undefined
    }

    const reportRef = collection(db, REPORT_COLLECTION)
    const unsubscribe = onSnapshot(
      reportRef,
      (snapshot) => {
        const next = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))

        setReports(next)
        setIsLoading(false)
        setError(null)
      },
      (snapshotError) => {
        setError(snapshotError.message || 'Unable to load scan history')
        setIsLoading(false)
      },
    )

    return () => unsubscribe()
  }, [])

  const latestReport = reports[0] || null

  const timelineItems = useMemo(
    () =>
      reports.slice(0, 20).map((report) => ({
        id: report.id,
        date: formatDate(report.createdAt),
        title: `${report.disease || 'Unknown issue'} in ${report.gridId || report.zone || 'Unlinked zone'}`,
        detail: `Severity ${Number(report.severity || 0)}%, confidence ${Number(report.confidence || 0)}%, risk ${report.spreadRisk || report.spread_risk || 'Unknown'}.`,
      })),
    [reports],
  )

  return {
    reports,
    latestReport,
    timelineItems,
    isLoading,
    error,
  }
}
