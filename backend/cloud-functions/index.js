const admin = require('firebase-admin')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const turf = require('@turf/turf')

admin.initializeApp()
const db = admin.firestore()

const USERS_COLLECTION = 'users'
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

function getReportOwnerUid(report) {
  const ownerUid = String(report?.ownerUid || report?.userId || report?.uid || '').trim()
  return ownerUid || null
}

function getUserGridCollection(userId) {
  return db.collection(USERS_COLLECTION).doc(userId).collection(GRID_COLLECTION)
}

async function findTargetGridDoc(userId, gridKey) {
  const userGrids = getUserGridCollection(userId)

  const byGridId = await userGrids.where('gridId', '==', gridKey).limit(1).get()
  if (!byGridId.empty) {
    return byGridId.docs[0]
  }

  const byFeatureId = await userGrids.where('mapFeatureId', '==', gridKey).limit(1).get()
  if (!byFeatureId.empty) {
    return byFeatureId.docs[0]
  }

  const byDocId = await userGrids.doc(gridKey).get()
  if (byDocId.exists) {
    return byDocId
  }

  return null
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
    const ownerUid = getReportOwnerUid(after)
    const reportGridKey = String(after.gridId || after.zone || '').trim()

    if (!isAbnormal || !reportGridKey || !ownerUid) {
      return
    }

    const targetDoc = await findTargetGridDoc(ownerUid, reportGridKey)

    if (!targetDoc) {
      logger.warn(`No user grid found for ownerUid=${ownerUid} and key=${reportGridKey}`)
      return
    }

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
  `${USERS_COLLECTION}/{userId}/${GRID_COLLECTION}/{gridDocId}`,
  async (event) => {
    const after = event.data?.after?.data()
    const userId = String(event.params?.userId || '').trim()

    if (!after || after.healthState !== 'Infected' || !userId) {
      return
    }

    const infectedFeature = polygonToFeature(after)
    if (!infectedFeature) {
      logger.warn('Infected grid has invalid polygon geometry')
      return
    }

    const infectedCentroid = turf.centroid(infectedFeature)
    const allGridsSnapshot = await getUserGridCollection(userId).get()

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
      `spatialPropagationAnalysis processed user=${userId} grid=${event.params.gridDocId}; marked ${updates} neighboring grid(s) as At-Risk`,
    )
  },
)
