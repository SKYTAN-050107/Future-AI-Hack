const admin = require('firebase-admin')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const turf = require('@turf/turf')

admin.initializeApp()
const db = admin.firestore()

const USERS_COLLECTION = 'users'
const GRID_COLLECTION = 'grids'
const REPORT_COLLECTION = 'scanReports'
const MIN_SPREAD_RADIUS_KM = 0.06
const MAX_SPREAD_RADIUS_KM = 0.45
const DEFAULT_ABNORMAL_SEVERITY = 65
const SPREAD_INTERSECTION_MIN_SQM = 1

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toMillis(value) {
  if (!value) {
    return 0
  }

  if (typeof value?.toMillis === 'function') {
    const millis = Number(value.toMillis())
    return Number.isFinite(millis) ? millis : 0
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return 0
    }
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : value
  }

  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function toSeverityScore(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return NaN
  }

  const normalized = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric
  return clamp(normalized, 0, 100)
}

function resolveSeverityScore(report) {
  const candidates = [
    report?.severityScore,
    report?.severity_score,
    report?.severity,
    report?.confidenceScore,
    report?.confidence,
  ]

  for (const candidate of candidates) {
    const score = toSeverityScore(candidate)
    if (Number.isFinite(score)) {
      return score
    }
  }

  const level = String(
    report?.severityLevel
    || report?.severity_level
    || report?.spreadRisk
    || report?.spread_risk
    || '',
  ).toLowerCase()

  if (level === 'very-high') return 95
  if (level === 'high') return 85
  if (level === 'medium') return 60
  if (level === 'low') return 35

  if (shouldMarkAbnormal(report)) {
    return DEFAULT_ABNORMAL_SEVERITY
  }

  return 0
}

function resolveSpreadRadiusKm(severityScore) {
  const score = clamp(Number(severityScore) || 0, 0, 100)
  const radius = MIN_SPREAD_RADIUS_KM + ((MAX_SPREAD_RADIUS_KM - MIN_SPREAD_RADIUS_KM) * score) / 100
  return Number(radius.toFixed(3))
}

function resolveRiskLevel(severityScore) {
  const score = clamp(Number(severityScore) || 0, 0, 100)
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

function resolveSpreadColorHex(severityScore) {
  const score = clamp(Number(severityScore) || 0, 0, 100) / 100
  const start = { r: 34, g: 197, b: 94 }
  const end = { r: 239, g: 68, b: 68 }

  const mix = (left, right) => Math.round(left + (right - left) * score)
  const toHex = (value) => value.toString(16).padStart(2, '0').toUpperCase()

  const r = toHex(mix(start.r, end.r))
  const g = toHex(mix(start.g, end.g))
  const b = toHex(mix(start.b, end.b))

  return `#${r}${g}${b}`
}

function serializeGeometry(geometry) {
  if (!geometry) {
    return null
  }
  return JSON.stringify(geometry)
}

function resolveReportTimestampMillis(report, event) {
  const candidates = [
    report?.capturedAt,
    report?.captureCapturedAt,
    report?.timestamp,
    report?.createdAt,
    report?.updatedAt,
    event?.data?.after?.updateTime,
    event?.time,
  ]

  for (const candidate of candidates) {
    const millis = toMillis(candidate)
    if (millis > 0) {
      return millis
    }
  }

  return Date.now()
}

function buildSpreadComputationVersion(reportId, versionMillis) {
  return `${String(reportId || 'unknown').trim()}:${Number(versionMillis || 0)}`
}

function shouldRecomputeSpread(before, after) {
  if (String(after?.healthState || '') !== 'Infected') {
    return false
  }

  const requestedVersion = String(after?.spreadComputationVersion || '').trim()
  const computedVersion = String(after?.spreadComputedVersion || '').trim()

  if (requestedVersion) {
    return requestedVersion !== computedVersion
  }

  if (!before) {
    return true
  }

  return String(before?.healthState || '') !== 'Infected'
}

function intersectPolygonFeatures(leftFeature, rightFeature) {
  let intersection = null

  try {
    // Turf v7 expects a FeatureCollection argument.
    intersection = turf.intersect(turf.featureCollection([leftFeature, rightFeature]))
  } catch {
    intersection = null
  }

  if (!intersection) {
    try {
      // Backward-compatible path for Turf v6-style signatures.
      intersection = turf.intersect(leftFeature, rightFeature)
    } catch {
      intersection = null
    }
  }

  try {
    const geometryType = intersection?.geometry?.type

    if (!intersection || (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon')) {
      return null
    }

    const areaSqm = turf.area(intersection)
    if (!Number.isFinite(areaSqm) || areaSqm < SPREAD_INTERSECTION_MIN_SQM) {
      return null
    }

    return intersection
  } catch {
    return null
  }
}

async function commitGridPatches(patches) {
  const chunkSize = 400

  for (let index = 0; index < patches.length; index += chunkSize) {
    const chunk = patches.slice(index, index + chunkSize)
    const batch = db.batch()

    chunk.forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true })
    })

    await batch.commit()
  }
}

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
  const severity = Number(
    report?.severity
    ?? report?.severityScore
    ?? report?.severity_score
    ?? 0,
  )
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

    const targetData = targetDoc.data() || {}
    const reportOccurredAtMs = resolveReportTimestampMillis(after, event)
    const existingLatestMs = toMillis(targetData?.lastAbnormalAt) || Number(targetData?.lastAbnormalAtMs || 0)

    if (existingLatestMs > reportOccurredAtMs) {
      logger.info(
        `Skipping stale abnormal report ${event.params.reportId}; existing latest abnormal is newer for user=${ownerUid} grid=${targetDoc.id}`,
      )
      return
    }

    const severityScore = resolveSeverityScore(after)
    const spreadRadiusKm = resolveSpreadRadiusKm(severityScore)
    const spreadColor = resolveSpreadColorHex(severityScore)
    const spreadComputationVersion = buildSpreadComputationVersion(
      event.params.reportId,
      toMillis(event?.data?.after?.updateTime) || reportOccurredAtMs,
    )

    await targetDoc.ref.set(
      {
        healthState: 'Infected',
        predictedSpreadRadius: spreadRadiusKm,
        riskLevel: resolveRiskLevel(severityScore),
        spreadSeverityScore: severityScore,
        spreadRadiusKm,
        spreadColor,
        spreadSourceReportId: String(event.params.reportId || ''),
        spreadSourceGridDocId: String(targetDoc.id || ''),
        spreadSourceGridId: String(targetData?.gridId || reportGridKey || targetDoc.id),
        spreadComputationVersion,
        spreadComputedVersion: null,
        lastAbnormalAtMs: reportOccurredAtMs,
        lastAbnormalAt: admin.firestore.Timestamp.fromMillis(reportOccurredAtMs),
        lastAbnormalReportId: String(event.params.reportId || ''),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  },
)

exports.spatialPropagationAnalysis = onDocumentWritten(
  `${USERS_COLLECTION}/{userId}/${GRID_COLLECTION}/{gridDocId}`,
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    const userId = String(event.params?.userId || '').trim()

    if (!after || !userId || !shouldRecomputeSpread(before, after)) {
      return
    }

    const infectedFeature = polygonToFeature(after)
    if (!infectedFeature) {
      logger.warn('Infected grid has invalid polygon geometry')
      return
    }

    const severityScore = Number.isFinite(Number(after?.spreadSeverityScore))
      ? clamp(Number(after.spreadSeverityScore), 0, 100)
      : DEFAULT_ABNORMAL_SEVERITY
    const spreadRadiusKm = Number.isFinite(Number(after?.spreadRadiusKm))
      ? Number(after.spreadRadiusKm)
      : resolveSpreadRadiusKm(severityScore)
    const spreadColor = String(after?.spreadColor || resolveSpreadColorHex(severityScore))
    const spreadComputationVersion = String(after?.spreadComputationVersion || '').trim() || buildSpreadComputationVersion(
      event.params?.gridDocId,
      Date.now(),
    )
    const sourceGridLabel = String(after?.gridId || after?.mapFeatureId || event.params?.gridDocId || '').trim()

    const infectedCentroid = turf.centroid(infectedFeature)
    const allGridsSnapshot = await getUserGridCollection(userId).get()

    const infectedSpreadCircle = turf.buffer(infectedCentroid, spreadRadiusKm, {
      units: 'kilometers',
      steps: 64,
    })

    const patches = []
    let impactedZones = 0

    allGridsSnapshot.forEach((docSnap) => {
      const data = docSnap.data()
      if (!data) {
        return
      }

      const isSourceGrid = docSnap.id === event.params.gridDocId
      const healthState = String(data.healthState || '')

      const candidateFeature = polygonToFeature(data)

      const basePatch = {
        spreadGeometry: null,
        spreadRadiusKm: null,
        spreadSeverityScore: null,
        spreadColor: null,
        spreadSourceGridDocId: null,
        spreadSourceGridId: null,
        spreadComputationVersion: null,
        spreadComputedVersion: null,
        spreadImpactedAreaHa: null,
        spreadCoverageRatio: null,
        spreadUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        bufferZone: null,
        bufferZoneKm: null,
        bufferZoneReason: null,
        bufferZoneAdvice: null,
        riskDistanceKm: null,
      }

      let nextPatch = { ...basePatch }

      if (candidateFeature) {
        const clippedSpread = intersectPolygonFeatures(infectedSpreadCircle, candidateFeature)

        if (clippedSpread) {
          impactedZones += 1

          const candidateAreaSqm = turf.area(candidateFeature)
          const impactedAreaSqm = turf.area(clippedSpread)
          const coverageRatio = candidateAreaSqm > 0 ? impactedAreaSqm / candidateAreaSqm : null
          const distanceKm = isSourceGrid
            ? 0
            : turf.distance(infectedCentroid, turf.centroid(candidateFeature), { units: 'kilometers' })

          nextPatch = {
            ...nextPatch,
            healthState: isSourceGrid ? 'Infected' : 'At-Risk',
            riskReason: isSourceGrid
              ? 'Latest abnormal scan in this zone'
              : 'Spatial spillover from latest infected zone',
            riskDistanceKm: Number(distanceKm.toFixed(4)),
            riskLevel: resolveRiskLevel(severityScore),
            predictedSpreadRadius: spreadRadiusKm,
            spreadGeometry: serializeGeometry(clippedSpread.geometry),
            spreadRadiusKm,
            spreadSeverityScore: severityScore,
            spreadColor,
            spreadSourceGridDocId: String(event.params.gridDocId),
            spreadSourceGridId: sourceGridLabel || String(event.params.gridDocId),
            spreadComputationVersion,
            spreadComputedVersion: spreadComputationVersion,
            spreadImpactedAreaHa: Number((impactedAreaSqm / 10000).toFixed(4)),
            spreadCoverageRatio: coverageRatio == null ? null : Number(coverageRatio.toFixed(4)),
            spreadUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            bufferZone: isSourceGrid ? serializeGeometry(infectedSpreadCircle.geometry) : null,
            bufferZoneKm: isSourceGrid ? spreadRadiusKm : null,
            bufferZoneReason: isSourceGrid
              ? 'Severity-based spread perimeter from latest abnormal scan'
              : null,
            bufferZoneAdvice: isSourceGrid
              ? 'Prioritize treatment inside highlighted spread area, then nearby impacted zones.'
              : 'Apply preventive treatment only in highlighted impacted area.',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          }
        } else if (!isSourceGrid && healthState === 'At-Risk') {
          nextPatch = {
            ...nextPatch,
            healthState: 'Healthy',
            riskReason: 'No active spillover from latest abnormal event',
            riskLevel: 'low',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          }
        }
      } else if (!isSourceGrid && healthState === 'At-Risk') {
        nextPatch = {
          ...nextPatch,
          healthState: 'Healthy',
          riskReason: 'No active spillover from latest abnormal event',
          riskLevel: 'low',
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }
      }

      patches.push({ ref: docSnap.ref, data: nextPatch })
    })

    await commitGridPatches(patches)

    if (event.data?.after?.ref) {
      await event.data.after.ref.set(
        {
          spreadComputedVersion: spreadComputationVersion,
          spreadComputationVersion,
          spreadSeverityScore: severityScore,
          spreadRadiusKm,
          spreadColor,
          spreadSourceGridDocId: String(event.params.gridDocId),
          spreadSourceGridId: sourceGridLabel || String(event.params.gridDocId),
          predictedSpreadRadius: spreadRadiusKm,
          riskLevel: resolveRiskLevel(severityScore),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }

    logger.info(
      `spatialPropagationAnalysis processed user=${userId} grid=${event.params.gridDocId}; impacted ${impactedZones} zone(s) using severity=${severityScore} radiusKm=${spreadRadiusKm}`,
    )
  },
)
