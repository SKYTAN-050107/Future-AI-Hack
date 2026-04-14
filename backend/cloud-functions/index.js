const admin = require('firebase-admin')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const turf = require('@turf/turf')

admin.initializeApp()
const db = admin.firestore()

const GRID_COLLECTION = 'grids'
const REPORT_COLLECTION = 'scanReports'
const AT_RISK_DISTANCE_KM = 0.2
const BUFFER_ZONE_KM = 0.2

function deserializeGeometry(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  return value
}

function shouldMarkAbnormal(report) {
  const severity = Number(report?.severity || 0)
  const status = String(report?.status || '').toLowerCase()
  const spreadRisk = String(report?.spreadRisk || report?.spread_risk || '').toLowerCase()
  const severityLevel = String(report?.severityLevel || '').toLowerCase()

  return (
    status === 'abnormal' ||
    report?.abnormal === true ||
    severityLevel === 'high' ||
    severity >= 50 ||
    spreadRisk === 'high'
  )
}

function polygonToFeature(gridDoc) {
  const polygon = deserializeGeometry(gridDoc?.polygon)

  if (!polygon || polygon.type !== 'Polygon') {
    return null
  }

  return turf.feature(polygon, {
    gridId: gridDoc.gridId,
  })
}

exports.updateGridStatus = onDocumentWritten(
  `${REPORT_COLLECTION}/{reportId}`,
  async (event) => {
    const after = event.data?.after?.data()

    if (!after) {
      return
    }

    const isAbnormal = shouldMarkAbnormal(after)

    if (!isAbnormal || !after.gridId) {
      return
    }

    const gridSnapshot = await db
      .collection(GRID_COLLECTION)
      .where('gridId', '==', after.gridId)
      .limit(1)
      .get()

    if (gridSnapshot.empty) {
      logger.warn(`No grid found for gridId=${after.gridId}`)
      return
    }

    const targetDoc = gridSnapshot.docs[0]
    await targetDoc.ref.set(
      {
        healthState: 'Infected',
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  },
)

exports.spatialPropagationAnalysis = onDocumentWritten(
  `${GRID_COLLECTION}/{gridDocId}`,
  async (event) => {
    const after = event.data?.after?.data()

    if (!after || after.healthState !== 'Infected') {
      return
    }

    const infectedFeature = polygonToFeature(after)
    if (!infectedFeature) {
      logger.warn('Infected grid has invalid polygon geometry')
      return
    }

    const infectedCentroid = turf.centroid(infectedFeature)
    const allGridsSnapshot = await db.collection(GRID_COLLECTION).get()

    // Persist an optional buffer zone for map-side visualization and spray guidance.
    const infectedBuffer = turf.buffer(infectedFeature, BUFFER_ZONE_KM, {
      units: 'kilometers',
    })

    await event.data.after.ref.set(
      {
        bufferZone: JSON.stringify(infectedBuffer.geometry),
        bufferZoneKm: BUFFER_ZONE_KM,
        bufferZoneReason: 'Preventive spray perimeter around infected section',
        bufferZoneAdvice: 'Prioritize preventive spray in nearby sections within this zone.',
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    const writeBatch = db.batch()
    let updates = 0

    allGridsSnapshot.forEach((docSnap) => {
      if (docSnap.id === event.params.gridDocId) {
        return
      }

      const data = docSnap.data()
      if (!data || data.healthState === 'Infected') {
        return
      }

      const candidateFeature = polygonToFeature(data)
      if (!candidateFeature) {
        return
      }

      const candidateCentroid = turf.centroid(candidateFeature)
      const distanceKm = turf.distance(infectedCentroid, candidateCentroid, {
        units: 'kilometers',
      })

      if (distanceKm <= AT_RISK_DISTANCE_KM) {
        writeBatch.set(
          docSnap.ref,
          {
            healthState: 'At-Risk',
            riskReason: 'Proximity to infected grid',
            riskDistanceKm: Number(distanceKm.toFixed(4)),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        updates += 1
      }
    })

    if (updates > 0) {
      await writeBatch.commit()
    }

    logger.info(
      `spatialPropagationAnalysis processed grid ${event.params.gridDocId}; marked ${updates} neighboring grid(s) as At-Risk`,
    )
  },
)
