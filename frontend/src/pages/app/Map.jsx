import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import * as turf from '@turf/turf'
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import SectionHeader from '../../components/ui/SectionHeader'
import { db } from '../../firebase'
import { useOffline } from '../../hooks/useOffline'
import { useGrids } from '../../hooks/useGrids'
import { useSessionContext } from '../../hooks/useSessionContext'

const DEFAULT_CENTER = [101.6958, 3.139]
const HEALTH_COLORS = {
  Healthy: '#00FF00',
  'At-Risk': '#FFA500',
  Infected: '#FF0000',
}
const MIN_GRID_AREA_HECTARES = 0.01
const MAX_GRID_AREA_HECTARES = 200
const EMPTY_GRID_HOLD_MS = 9000

function createBufferCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function resolveStoredGeometry(value) {
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

function createSpreadCollection(grids, markers = []) {
  const isPolygonGeometry = (geometry) => {
    const geometryType = geometry?.type
    return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
  }

  const toSeverityScore = (value, fallback = 0) => {
    const raw = Number(value)
    if (!Number.isFinite(raw)) {
      return fallback
    }

    const normalized = raw >= 0 && raw <= 1 ? raw * 100 : raw
    return Math.min(Math.max(normalized, 0), 100)
  }

  const severityToColor = (severityScore) => {
    const score = Math.min(Math.max(Number(severityScore) || 0, 0), 100) / 100
    const start = { r: 34, g: 197, b: 94 }
    const end = { r: 239, g: 68, b: 68 }

    const mix = (left, right) => Math.round(left + (right - left) * score)
    const toHex = (value) => value.toString(16).padStart(2, '0').toUpperCase()

    return `#${toHex(mix(start.r, end.r))}${toHex(mix(start.g, end.g))}${toHex(mix(start.b, end.b))}`
  }

  const intersectPolygons = (leftFeature, rightFeature) => {
    let intersection = null

    try {
      intersection = turf.intersect(turf.featureCollection([leftFeature, rightFeature]))
    } catch {
      intersection = null
    }

    if (!intersection) {
      try {
        intersection = turf.intersect(leftFeature, rightFeature)
      } catch {
        intersection = null
      }
    }

    if (!isPolygonGeometry(intersection?.geometry)) {
      return null
    }

    const areaSqm = turf.area(intersection)
    if (!Number.isFinite(areaSqm) || areaSqm <= 0) {
      return null
    }

    return intersection
  }

  const resolveDerivedSpreadRadiusKm = (sourceGrid, severityScore) => {
    const directRadius = Number(
      sourceGrid?.spreadRadiusKm
      || sourceGrid?.predictedSpreadRadius
      || sourceGrid?.bufferZoneKm
      || 0,
    )

    if (Number.isFinite(directRadius) && directRadius > 0) {
      return directRadius
    }

    const minRadius = 0.06
    const maxRadius = 0.45
    return minRadius + ((maxRadius - minRadius) * Math.min(Math.max(severityScore, 0), 100)) / 100
  }

  const persistedFeatures = grids
    .map((grid) => {
      const spreadGeometry = resolveStoredGeometry(grid?.spreadGeometry) || resolveStoredGeometry(grid?.bufferZone)
      if (!isPolygonGeometry(spreadGeometry)) {
        return null
      }

      const fallbackSeverity =
        grid?.healthState === 'Infected'
          ? 80
          : grid?.healthState === 'At-Risk'
            ? 55
            : 0
      const severityScore = toSeverityScore(grid?.spreadSeverityScore, fallbackSeverity)

      return {
        type: 'Feature',
        id: `${grid.id}-spread`,
        properties: {
          gridId: grid.gridId || grid.id,
          spreadSeverityScore: severityScore,
          spreadColor: String(grid?.spreadColor || '').trim() || severityToColor(severityScore),
          radiusKm: Number(grid?.spreadRadiusKm || grid?.bufferZoneKm || 0),
          sourceGridId: String(grid?.spreadSourceGridId || '').trim(),
        },
        geometry: spreadGeometry,
      }
    })
    .filter(Boolean)

  if (persistedFeatures.length > 0) {
    return {
      type: 'FeatureCollection',
      features: persistedFeatures,
    }
  }

  const polygonGrids = grids
    .map((grid) => {
      const polygon = resolveStoredGeometry(grid?.polygon)
      if (!isPolygonGeometry(polygon)) {
        return null
      }

      return {
        grid,
        feature: turf.feature(polygon, {
          gridDocId: String(grid?.id || ''),
          gridId: String(grid?.gridId || grid?.id || ''),
        }),
      }
    })
    .filter(Boolean)

  const buildMarkerFallbackFeatures = () => {
    if (!Array.isArray(markers) || markers.length === 0) {
      return []
    }

    const zoneFeatures = polygonGrids.map((item) => item.feature)

    return markers
      .filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng))
      .flatMap((marker, markerIndex) => {
        const markerId = String(marker?.id || marker?.captureId || `marker-${markerIndex}`)
        const diagnosisText = String(marker?.diagnosisLabel || '').toLowerCase()
        const healthyLike = /(healthy|normal|safe|ok)/.test(diagnosisText)
        const severityScore = toSeverityScore(
          marker?.severityScore ?? marker?.severity,
          healthyLike ? 35 : 65,
        )
        const radiusKm = 0.05 + ((0.25 - 0.05) * severityScore) / 100

        let markerCircle = null
        try {
          markerCircle = turf.buffer(turf.point([Number(marker.lng), Number(marker.lat)]), radiusKm, {
            units: 'kilometers',
            steps: 48,
          })
        } catch {
          markerCircle = null
        }

        if (!markerCircle || !isPolygonGeometry(markerCircle?.geometry)) {
          return []
        }

        const baseProperties = {
          gridId: marker?.gridId || 'Unlinked zone',
          spreadSeverityScore: severityScore,
          spreadColor: severityToColor(severityScore),
          radiusKm: Number(radiusKm.toFixed(3)),
          sourceGridId: String(marker?.gridId || '').trim(),
          sourceMarkerId: markerId,
          spreadDerived: true,
          spreadFromMarker: true,
        }

        if (zoneFeatures.length === 0) {
          return [{
            type: 'Feature',
            id: `marker-fallback-${markerId}`,
            properties: baseProperties,
            geometry: markerCircle.geometry,
          }]
        }

        const clippedPieces = zoneFeatures
          .map((zoneFeature, zoneIndex) => {
            const clipped = intersectPolygons(markerCircle, zoneFeature)
            if (!clipped) {
              return null
            }

            return {
              type: 'Feature',
              id: `marker-fallback-${markerId}-${zoneIndex}`,
              properties: baseProperties,
              geometry: clipped.geometry,
            }
          })
          .filter(Boolean)

        if (clippedPieces.length > 0) {
          return clippedPieces
        }

        return [{
          type: 'Feature',
          id: `marker-fallback-${markerId}-raw`,
          properties: {
            ...baseProperties,
            spreadUnclipped: true,
          },
          geometry: markerCircle.geometry,
        }]
      })
  }

  if (polygonGrids.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    }
  }

  const infectedCandidates = polygonGrids
    .filter(({ grid }) => String(grid?.healthState || '') === 'Infected')
    .sort((left, right) => {
      const leftMs = toMillis(left.grid?.lastAbnormalAt)
        || Number(left.grid?.lastAbnormalAtMs || 0)
        || toMillis(left.grid?.lastUpdated)
      const rightMs = toMillis(right.grid?.lastAbnormalAt)
        || Number(right.grid?.lastAbnormalAtMs || 0)
        || toMillis(right.grid?.lastUpdated)
      return rightMs - leftMs
    })

  const source = infectedCandidates[0]
  if (!source) {
    const markerFallbackFeatures = buildMarkerFallbackFeatures()
    return {
      type: 'FeatureCollection',
      features: markerFallbackFeatures,
    }
  }

  const sourceSeverity = toSeverityScore(
    source.grid?.spreadSeverityScore ?? source.grid?.severityScore ?? source.grid?.severity,
    80,
  )
  const sourceRadiusKm = resolveDerivedSpreadRadiusKm(source.grid, sourceSeverity)
  const sourceColor = String(source.grid?.spreadColor || '').trim() || severityToColor(sourceSeverity)

  let spreadCircle = null
  try {
    spreadCircle = turf.buffer(turf.centroid(source.feature), sourceRadiusKm, {
      units: 'kilometers',
      steps: 64,
    })
  } catch {
    spreadCircle = null
  }

  if (!spreadCircle || !isPolygonGeometry(spreadCircle?.geometry)) {
    return {
      type: 'FeatureCollection',
      features: [],
    }
  }

  const derivedFeatures = polygonGrids
    .map(({ grid, feature }) => {
      const clipped = intersectPolygons(spreadCircle, feature)
      if (!clipped) {
        return null
      }

      return {
        type: 'Feature',
        id: `${source.grid.id}-derived-${grid.id}`,
        properties: {
          gridId: grid.gridId || grid.id,
          spreadSeverityScore: sourceSeverity,
          spreadColor: sourceColor,
          radiusKm: Number(sourceRadiusKm),
          sourceGridId: source.grid.gridId || source.grid.id,
          spreadDerived: true,
        },
        geometry: clipped.geometry,
      }
    })
    .filter(Boolean)

  if (derivedFeatures.length === 0) {
    const markerFallbackFeatures = buildMarkerFallbackFeatures()
    if (markerFallbackFeatures.length > 0) {
      return {
        type: 'FeatureCollection',
        features: markerFallbackFeatures,
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features: derivedFeatures,
  }
}

function createFeatureCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: grids
      .map((grid) => {
        const polygon = resolveStoredGeometry(grid?.polygon)
        const geometryType = polygon?.type
        if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
          return null
        }

        return {
          type: 'Feature',
          id: grid.id,
          properties: {
            gridId: grid.gridId || grid.id,
            healthState: grid.healthState || 'Healthy',
            areaHectares: grid.areaHectares || 0,
          },
          geometry: polygon,
        }
      })
      .filter(Boolean)
  }
}

function createGridId() {
  return `GRID_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function extractMarkerPosition(value) {
  if (!value) {
    return null
  }

  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0])
    const lat = Number(value[1])
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng }
    }
    return null
  }

  const lat = Number(value?.lat ?? value?.latitude ?? value?._lat)
  const lng = Number(value?.lng ?? value?.lon ?? value?.longitude ?? value?._long)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  return { lat, lng }
}

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

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCapturedAt(value) {
  const millis = toMillis(value)
  if (millis <= 0) {
    return ''
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(millis))
  } catch {
    return new Date(millis).toISOString()
  }
}

function mergeSourceRefs(...refLists) {
  const seen = new Set()
  const merged = []

  refLists.flat().forEach((ref) => {
    if (!ref) {
      return
    }

    const sourceType = String(ref?.sourceType || '').trim()
    const sourceDocId = String(ref?.sourceDocId || '').trim()
    if (!sourceType || !sourceDocId) {
      return
    }

    const key = `${sourceType}:${sourceDocId}`
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    merged.push({
      sourceType,
      sourceDocId,
    })
  })

  return merged
}

function resolveMarkerDeleteKey(marker) {
  const captureId = String(marker?.captureId || '').trim()
  if (captureId) {
    return captureId
  }

  const sourceRefs = Array.isArray(marker?.sourceRefs) ? marker.sourceRefs : []
  const primaryRef = sourceRefs[0]
  if (primaryRef) {
    return `${String(primaryRef.sourceType || '').trim()}:${String(primaryRef.sourceDocId || '').trim()}`
  }

  return String(marker?.id || '').trim()
}

function toMarkerRecord(data, idHint, sourcePrefix) {
  const markerPosition = extractMarkerPosition(data?.zonePosition || data?.zone_position)
  if (!markerPosition) {
    return null
  }

  const sourceType = String(sourcePrefix || '').trim() || 'unknown'
  const sourceDocId = String(idHint || '').trim()
  const captureIdFromData = String(data?.captureId || '').trim()
  const gridId = String(data?.gridId || data?.zone || '').trim() || 'Unlinked zone'
  const captureId = captureIdFromData || sourceDocId || `${sourceType}-${Math.random().toString(36).slice(2, 8)}`
  const capturedAtRaw = data?.capturedAt || data?.captureCapturedAt || data?.timestamp || data?.createdAt || null
  const capturedAtMs = toMillis(capturedAtRaw)
  const capturedAt = capturedAtMs > 0 ? new Date(capturedAtMs).toISOString() : ''
  const captureImageUrl = String(
    data?.captureDownloadURL
    || data?.capture_download_url
    || data?.downloadURL
    || data?.download_url
    || data?.imageUrl
    || data?.image_url
    || '',
  ).trim()
  const diagnosisLabel = String(
    data?.disease
    || data?.diagnosis
    || data?.result
    || data?.resultLabel
    || data?.matchedPestName
    || data?.matched_pest_name
    || data?.pestName
    || data?.pest_name
    || '',
  ).trim()
  const cropType = String(
    data?.cropType
    || data?.crop_type
    || data?.crop
    || data?.cropName
    || data?.crop_name
    || '',
  ).trim()

  return {
    id: `${sourcePrefix}-${captureId}`,
    captureId,
    gridId,
    lat: Number(markerPosition.lat),
    lng: Number(markerPosition.lng),
    capturedAt,
    capturedAtMs,
    capturedAtLabel: formatCapturedAt(capturedAtRaw),
    captureImageUrl,
    diagnosisLabel,
    cropType,
    zonePositionLabel: String(data?.zonePositionLabel || data?.zone_position_label || '').trim(),
    sourceRefs: mergeSourceRefs({ sourceType, sourceDocId }),
  }
}

function mergeMarkerRecords(...markerLists) {
  const byCapture = new Map()

  markerLists.flat().forEach((marker) => {
    if (!marker) {
      return
    }

    const key = String(marker.captureId || marker.id)
    const existing = byCapture.get(key)
    if (!existing) {
      byCapture.set(key, marker)
      return
    }

    const existingMs = Number(existing.capturedAtMs || 0)
    const incomingMs = Number(marker.capturedAtMs || 0)
    const primary = incomingMs >= existingMs ? marker : existing
    const secondary = incomingMs >= existingMs ? existing : marker

    byCapture.set(key, {
      ...primary,
      gridId: String(primary.gridId || secondary.gridId || '').trim() || 'Unlinked zone',
      capturedAtLabel: String(primary.capturedAtLabel || secondary.capturedAtLabel || '').trim(),
      captureImageUrl: String(primary.captureImageUrl || secondary.captureImageUrl || '').trim(),
      diagnosisLabel: String(primary.diagnosisLabel || secondary.diagnosisLabel || '').trim(),
      cropType: String(primary.cropType || secondary.cropType || '').trim(),
      zonePositionLabel: String(primary.zonePositionLabel || secondary.zonePositionLabel || '').trim(),
      sourceRefs: mergeSourceRefs(primary.sourceRefs, secondary.sourceRefs),
    })
  })

  return Array.from(byCapture.values()).sort(
    (left, right) => Number(right.capturedAtMs || 0) - Number(left.capturedAtMs || 0),
  )
}

function createScanMarkerCollection(markers) {
  return {
    type: 'FeatureCollection',
    features: markers
      .filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng))
      .map((marker) => ({
        type: 'Feature',
        id: marker.id,
        properties: {
          captureId: marker.captureId || '',
          gridId: marker.gridId || 'Unlinked zone',
          capturedAt: marker.capturedAt || '',
          capturedAtLabel: marker.capturedAtLabel || '',
          captureImageUrl: marker.captureImageUrl || '',
          diagnosisLabel: marker.diagnosisLabel || null,
          cropType: marker.cropType || '',
          zonePositionLabel: marker.zonePositionLabel || '',
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(marker.lng), Number(marker.lat)],
        },
      })),
  }
}

export default function MapPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const drawRef = useRef(null)
  const mapReadyRef = useRef(false)

  const [mapReady, setMapReady] = useState(false)
  const [actionMessage, setActionMessage] = useState('Draw a polygon to create your first grid section.')
  const [localAreaHectares, setLocalAreaHectares] = useState(0)
  const [pendingFeature, setPendingFeature] = useState(null)
  const [pendingZoneName, setPendingZoneName] = useState('')
  const [zoneNameDrafts, setZoneNameDrafts] = useState({})
  const [zoneCropTypeDrafts, setZoneCropTypeDrafts] = useState({})
  const [isSavingPending, setIsSavingPending] = useState(false)
  const [deletingGridId, setDeletingGridId] = useState('')
  const [renamingGridId, setRenamingGridId] = useState('')
  const [deletingMarkerKey, setDeletingMarkerKey] = useState('')
  const [lastSaveState, setLastSaveState] = useState('idle')
  const [scanMarkers, setScanMarkers] = useState([])
  const [markerLoadError, setMarkerLoadError] = useState('')
  const centroidTargetRef = useRef({ center: DEFAULT_CENTER, hasSaved: false })
  const { user } = useSessionContext()

  const { isOnline } = useOffline()
  const {
    grids,
    isLoading,
    error,
    isFirebaseConfigured,
    saveOrUpdateGridByFeature,
    deleteGrid,
    updateGridName,
    updateGridCropType,
  } = useGrids()
  const spreadCollection = useMemo(() => createSpreadCollection(grids, scanMarkers), [grids, scanMarkers])
  const gridCollection = useMemo(() => createFeatureCollection(grids), [grids])
  const lastStableGridCollectionRef = useRef({ type: 'FeatureCollection', features: [] })
  const lastStableSpreadCollectionRef = useRef({ type: 'FeatureCollection', features: [] })
  const emptyGridHoldUntilRef = useRef(0)
  const [gridHoldTick, setGridHoldTick] = useState(0)

  const hasSpreadContext = useMemo(
    () => (
      grids.some((item) => item?.healthState === 'Infected' || item?.healthState === 'At-Risk')
      || scanMarkers.length > 0
    ),
    [grids, scanMarkers.length],
  )

  const effectiveGridCollection = useMemo(() => {
    const nextCount = Array.isArray(gridCollection?.features) ? gridCollection.features.length : 0
    const previousCount = Array.isArray(lastStableGridCollectionRef.current?.features)
      ? lastStableGridCollectionRef.current.features.length
      : 0

    if (nextCount > 0) {
      emptyGridHoldUntilRef.current = 0
      return gridCollection
    }

    if (grids.length > 0 && nextCount === 0 && previousCount > 0) {
      return lastStableGridCollectionRef.current
    }

    if (grids.length === 0 && nextCount === 0 && previousCount > 0) {
      const now = Date.now()
      if (emptyGridHoldUntilRef.current === 0) {
        emptyGridHoldUntilRef.current = now + EMPTY_GRID_HOLD_MS
      }

      const holdActive = now < emptyGridHoldUntilRef.current
      if (holdActive || isLoading || Boolean(error)) {
        return lastStableGridCollectionRef.current
      }

      emptyGridHoldUntilRef.current = 0
    }

    return gridCollection
  }, [error, gridCollection, gridHoldTick, grids.length, isLoading])

  const effectiveSpreadCollection = useMemo(() => {
    const nextCount = Array.isArray(spreadCollection?.features) ? spreadCollection.features.length : 0
    const previousCount = Array.isArray(lastStableSpreadCollectionRef.current?.features)
      ? lastStableSpreadCollectionRef.current.features.length
      : 0

    if (hasSpreadContext && nextCount === 0 && previousCount > 0) {
      return lastStableSpreadCollectionRef.current
    }

    return spreadCollection
  }, [hasSpreadContext, spreadCollection])

  useEffect(() => {
    const holdUntil = emptyGridHoldUntilRef.current
    if (!holdUntil) {
      return undefined
    }

    const waitMs = holdUntil - Date.now()
    if (waitMs <= 0) {
      return undefined
    }

    const timerId = window.setTimeout(() => {
      setGridHoldTick((value) => value + 1)
    }, waitMs + 40)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [error, gridHoldTick, grids.length, isLoading])

  useEffect(() => {
    const nextCount = Array.isArray(effectiveGridCollection?.features) ? effectiveGridCollection.features.length : 0
    if (nextCount > 0) {
      lastStableGridCollectionRef.current = effectiveGridCollection
      return
    }

    if (grids.length === 0 && emptyGridHoldUntilRef.current === 0 && !isLoading && !error) {
      lastStableGridCollectionRef.current = effectiveGridCollection
    }
  }, [effectiveGridCollection, error, grids.length, isLoading])

  useEffect(() => {
    const nextCount = Array.isArray(effectiveSpreadCollection?.features) ? effectiveSpreadCollection.features.length : 0
    if (nextCount > 0 || !hasSpreadContext) {
      lastStableSpreadCollectionRef.current = effectiveSpreadCollection
    }
  }, [effectiveSpreadCollection, hasSpreadContext])

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
  const isMapboxConfigured = Boolean(mapboxToken && !mapboxToken.includes('YOUR_'))

  useEffect(() => {
    const uid = String(user?.uid || '').trim()
    if (!db || !isFirebaseConfigured || !uid) {
      setScanMarkers([])
      setMarkerLoadError('')
      return undefined
    }

    let captureMarkers = []
    let ownerReportMarkers = []
    let userReportMarkers = []

    const pushMergedMarkers = () => {
      setScanMarkers(
        mergeMarkerRecords(captureMarkers, ownerReportMarkers, userReportMarkers),
      )
      setMarkerLoadError('')
    }

    const captureQuery = query(collection(db, 'users', uid, 'scanCaptures'))
    const ownerReportQuery = query(collection(db, 'scanReports'), where('ownerUid', '==', uid))
    const userReportQuery = query(collection(db, 'scanReports'), where('userId', '==', uid))

    const unsubscribeCaptures = onSnapshot(
      captureQuery,
      (snapshot) => {
        captureMarkers = snapshot.docs
          .map((item) => toMarkerRecord(item.data() || {}, item.id, 'capture'))
          .filter(Boolean)
        pushMergedMarkers()
      },
      (snapshotError) => {
        setMarkerLoadError(snapshotError?.message || 'Unable to load scan markers from captures.')
      },
    )

    const unsubscribeOwnerReports = onSnapshot(
      ownerReportQuery,
      (snapshot) => {
        ownerReportMarkers = snapshot.docs
          .map((item) => toMarkerRecord(item.data() || {}, item.id, 'report-owner'))
          .filter(Boolean)
        pushMergedMarkers()
      },
      (snapshotError) => {
        setMarkerLoadError(snapshotError?.message || 'Unable to load scan markers from reports.')
      },
    )

    const unsubscribeUserReports = onSnapshot(
      userReportQuery,
      (snapshot) => {
        userReportMarkers = snapshot.docs
          .map((item) => toMarkerRecord(item.data() || {}, item.id, 'report-user'))
          .filter(Boolean)
        pushMergedMarkers()
      },
      (snapshotError) => {
        setMarkerLoadError(snapshotError?.message || 'Unable to load scan markers from reports.')
      },
    )

    return () => {
      unsubscribeCaptures()
      unsubscribeOwnerReports()
      unsubscribeUserReports()
    }
  }, [isFirebaseConfigured, user?.uid])

  const deleteMarkerRecord = useCallback(async (marker) => {
    const uid = String(user?.uid || '').trim()
    const safeCaptureId = String(marker?.captureId || '').trim()
    const sourceRefs = mergeSourceRefs(marker?.sourceRefs)

    if (!db || !isFirebaseConfigured) {
      throw new Error('Marker delete requires Firebase configuration.')
    }

    if (!uid) {
      throw new Error('Sign in is required to delete markers.')
    }

    if (!safeCaptureId && sourceRefs.length === 0) {
      throw new Error('Missing marker source for delete.')
    }

    let deletedCapture = false
    const deletedReportIds = new Set()

    await Promise.all(sourceRefs.map(async (ref) => {
      if (ref.sourceType === 'capture') {
        await deleteDoc(doc(db, 'users', uid, 'scanCaptures', ref.sourceDocId))
        deletedCapture = true
        return
      }

      if (ref.sourceType === 'report-owner' || ref.sourceType === 'report-user') {
        await deleteDoc(doc(db, 'scanReports', ref.sourceDocId))
        deletedReportIds.add(ref.sourceDocId)
      }
    }))

    if (safeCaptureId) {
      await deleteDoc(doc(db, 'users', uid, 'scanCaptures', safeCaptureId))
      deletedCapture = true
    }

    if (safeCaptureId) {
      const reportsSnapshot = await getDocs(
        query(collection(db, 'scanReports'), where('captureId', '==', safeCaptureId)),
      )

      const ownedReportIds = new Set()
      reportsSnapshot.docs.forEach((item) => {
        const data = item.data() || {}
        const isOwned = (
          String(data?.ownerUid || '').trim() === uid
          || String(data?.userId || '').trim() === uid
          || String(data?.uid || '').trim() === uid
        )
        if (isOwned) {
          ownedReportIds.add(String(item.id))
        }
      })

      await Promise.all(
        Array.from(ownedReportIds)
          .filter((reportId) => !deletedReportIds.has(reportId))
          .map((reportId) => deleteDoc(doc(db, 'scanReports', reportId))),
      )

      ownedReportIds.forEach((reportId) => {
        deletedReportIds.add(reportId)
      })
    }

    return {
      deletedReportCount: deletedReportIds.size,
      deletedCapture,
    }
  }, [isFirebaseConfigured, user?.uid])

  const centroidTarget = useMemo(() => {
    const points = grids
      .filter((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng))
      .map((grid) => ({
        lat: Number(grid.centroid.lat),
        lng: Number(grid.centroid.lng),
        area: Number(grid.areaHectares || 0),
      }))

    if (points.length === 0) {
      return {
        center: DEFAULT_CENTER,
        hasSaved: false,
      }
    }

    const totalArea = points.reduce((sum, point) => sum + (point.area > 0 ? point.area : 0), 0)
    const useWeighted = totalArea > 0

    const weighted = points.reduce(
      (acc, point) => {
        const weight = useWeighted ? point.area : 1
        return {
          lat: acc.lat + point.lat * weight,
          lng: acc.lng + point.lng * weight,
          weight: acc.weight + weight,
        }
      },
      { lat: 0, lng: 0, weight: 0 },
    )

    const centerLat = weighted.weight > 0 ? weighted.lat / weighted.weight : DEFAULT_CENTER[1]
    const centerLng = weighted.weight > 0 ? weighted.lng / weighted.weight : DEFAULT_CENTER[0]

    return {
      center: [centerLng, centerLat],
      hasSaved: true,
    }
  }, [grids])

  useEffect(() => {
    centroidTargetRef.current = centroidTarget
  }, [centroidTarget])

  useEffect(() => {
    const nextName = String(pendingFeature?.properties?.gridId || '').trim()
    setPendingZoneName(nextName)
  }, [pendingFeature])

  useEffect(() => {
    setZoneNameDrafts((prev) => {
      const next = {}

      grids.forEach((grid) => {
        const key = String(grid.id)
        next[key] = Object.prototype.hasOwnProperty.call(prev, key)
          ? String(prev[key] || '')
          : String(grid.gridId || '')
      })

      return next
    })
  }, [grids])

  useEffect(() => {
    setZoneCropTypeDrafts((prev) => {
      const next = {}

      grids.forEach((grid) => {
        const key = String(grid.id)
        next[key] = Object.prototype.hasOwnProperty.call(prev, key)
          ? String(prev[key] || '')
          : String(grid.cropType || '')
      })

      return next
    })
  }, [grids])

  useEffect(() => {
    if (!isMapboxConfigured || !mapContainerRef.current || mapRef.current) {
      return undefined
    }

    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: DEFAULT_CENTER,
      zoom: 15,
      attributionControl: false,
    })

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

    const centroidControl = {
      map: null,
      container: null,
      button: null,
      handleClick: null,
      onAdd(controlMap) {
        this.map = controlMap
        const container = document.createElement('div')
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group pg-map-centroid-ctrl'

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'pg-map-centroid-btn'
        button.setAttribute('aria-label', 'Go to farm centroid')
        button.title = 'Go to farm centroid'
        button.innerHTML = '<span class="pg-map-centroid-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1.5"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg></span>'

        this.handleClick = () => {
          const { center, hasSaved } = centroidTargetRef.current
          this.map.easeTo({
            center,
            zoom: hasSaved ? Math.max(this.map.getZoom(), 15) : 13,
            duration: 700,
          })
          setActionMessage(
            hasSaved
              ? 'Centered map to your saved farm centroid.'
              : 'No saved grid yet. Returned to default map center.',
          )
        }

        button.addEventListener('click', this.handleClick)
        container.appendChild(button)

        this.container = container
        this.button = button

        return container
      },
      onRemove() {
        if (this.button && this.handleClick) {
          this.button.removeEventListener('click', this.handleClick)
        }

        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container)
        }

        this.map = null
        this.container = null
        this.button = null
        this.handleClick = null
      },
    }
    map.addControl(centroidControl, 'top-right')

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: 'draw_polygon',
    })

    map.addControl(draw, 'top-left')

    const fitToUserLocation = () => {
      if (!navigator.geolocation) {
        return
      }

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          map.easeTo({
            center: [coords.longitude, coords.latitude],
            zoom: 16,
            duration: 800,
          })
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 },
      )
    }

    const validateFeature = (feature, areaHectares) => {
      if (!feature || feature.geometry?.type !== 'Polygon') {
        return 'Only polygon grids are supported.'
      }

      if (!feature.id) {
        return 'Unable to save this shape. Please redraw the polygon.'
      }

      if (areaHectares < MIN_GRID_AREA_HECTARES) {
        return 'Polygon is too small. Draw at least 0.01 hectares.'
      }

      if (areaHectares > MAX_GRID_AREA_HECTARES) {
        return 'Polygon is too large. Split this section into smaller grids.'
      }

      const kinkCollection = turf.kinks(feature)
      if ((kinkCollection.features || []).length > 0) {
        return 'Polygon crosses itself. Redraw for a clean boundary.'
      }

      return null
    }

    const saveFeature = async (feature, mode = 'auto') => {
      if (!feature || feature.geometry?.type !== 'Polygon') {
        return
      }

      const areaHectares = turf.area(feature) / 10000
      const centroid = turf.centroid(feature)

      const validationError = validateFeature(feature, areaHectares)
      if (validationError) {
        setActionMessage(validationError)
        setLastSaveState('failed')
        return
      }

      setLocalAreaHectares(areaHectares)

      if (!isFirebaseConfigured) {
        setActionMessage('Grid save requires Firebase configuration and authenticated access.')
        setLastSaveState('failed')
        return
      }

      setLastSaveState('pending')
      await saveOrUpdateGridByFeature({
        mapFeatureId: String(feature.id),
        gridId: feature.properties?.gridId || createGridId(),
        polygon: feature.geometry,
        areaHectares,
        centroid: {
          lat: centroid.geometry.coordinates[1],
          lng: centroid.geometry.coordinates[0],
        },
      })

      setActionMessage(mode === 'manual' ? 'Grid confirmed and synced.' : 'Grid auto-saved and synced. Confirm if you want to re-sync.')
      setLastSaveState('saved')
      setPendingFeature(mode === 'manual' ? null : feature)
    }

    const onDrawCreate = async (event) => {
      for (const feature of event.features || []) {
        setPendingFeature(feature)
        setPendingZoneName(String(feature?.properties?.gridId || '').trim())
        try {
          await saveFeature(feature)
        } catch (saveError) {
          setActionMessage(saveError.message || 'Failed to save grid')
          setLastSaveState('failed')
        }
      }
    }

    const onDrawUpdate = async (event) => {
      for (const feature of event.features || []) {
        setPendingFeature(feature)
        setPendingZoneName(String(feature?.properties?.gridId || '').trim())
        try {
          await saveFeature(feature)
        } catch (saveError) {
          setActionMessage(saveError.message || 'Failed to update grid')
          setLastSaveState('failed')
        }
      }
    }

    const onDrawDelete = async (event) => {
      if (!isFirebaseConfigured) {
        setActionMessage('Grid delete requires Firebase configuration and authenticated access.')
        setLastSaveState('idle')
        return
      }

      for (const feature of event.features || []) {
        if (!feature?.id) {
          continue
        }

        try {
          await deleteGrid(String(feature.id))
          setActionMessage('Grid removed.')
          setLastSaveState('saved')
          setPendingFeature(null)
        } catch (deleteError) {
          setActionMessage(deleteError.message || 'Failed to delete grid')
          setLastSaveState('failed')
        }
      }
    }

    map.on('load', () => {
      if (!map.getSource('pg-grids')) {
        map.addSource('pg-grids', {
          type: 'geojson',
          data: createFeatureCollection([]),
        })
      }

      if (!map.getSource('pg-grid-buffers')) {
        map.addSource('pg-grid-buffers', {
          type: 'geojson',
          data: createBufferCollection([]),
        })
      }

      if (!map.getSource('pg-grid-spread')) {
        map.addSource('pg-grid-spread', {
          type: 'geojson',
          data: createSpreadCollection([]),
        })
      }

      if (!map.getSource('pg-scan-markers')) {
        map.addSource('pg-scan-markers', {
          type: 'geojson',
          data: createScanMarkerCollection([]),
        })
      }

      map.addLayer({
        id: 'pg-grid-fill',
        type: 'fill',
        source: 'pg-grids',
        paint: {
          'fill-color': [
            'match',
            ['get', 'healthState'],
            'Healthy',
            HEALTH_COLORS.Healthy,
            'At-Risk',
            HEALTH_COLORS['At-Risk'],
            'Infected',
            HEALTH_COLORS.Infected,
            '#CCCCCC',
          ],
          'fill-opacity': 0.34,
        },
      })

      map.addLayer({
        id: 'pg-grid-outline',
        type: 'line',
        source: 'pg-grids',
        paint: {
          'line-color': '#18424B',
          'line-width': 2,
        },
      })

      const spreadColorExpression = [
        'case',
        ['>', ['length', ['coalesce', ['get', 'spreadColor'], '']], 0],
        ['get', 'spreadColor'],
        [
          'interpolate',
          ['linear'],
          ['to-number', ['coalesce', ['get', 'spreadSeverityScore'], 0]],
          0,
          '#22C55E',
          50,
          '#F59E0B',
          100,
          '#EF4444',
        ],
      ]

      const spreadFillOpacityExpression = [
        'case',
        ['boolean', ['coalesce', ['get', 'spreadFromMarker'], false], false],
        [
          'interpolate',
          ['linear'],
          ['to-number', ['coalesce', ['get', 'spreadSeverityScore'], 0]],
          0,
          0.16,
          100,
          0.36,
        ],
        [
          'interpolate',
          ['linear'],
          ['to-number', ['coalesce', ['get', 'spreadSeverityScore'], 0]],
          0,
          0.08,
          100,
          0.28,
        ],
      ]

      const spreadOutlineColorExpression = [
        'case',
        ['boolean', ['coalesce', ['get', 'spreadFromMarker'], false], false],
        [
          'interpolate',
          ['linear'],
          ['to-number', ['coalesce', ['get', 'spreadSeverityScore'], 0]],
          0,
          '#166534',
          50,
          '#B45309',
          100,
          '#991B1B',
        ],
        [
          'interpolate',
          ['linear'],
          ['to-number', ['coalesce', ['get', 'spreadSeverityScore'], 0]],
          0,
          '#15803D',
          50,
          '#D97706',
          100,
          '#B91C1C',
        ],
      ]

      map.addLayer({
        id: 'pg-grid-spread-fill',
        type: 'fill',
        source: 'pg-grid-spread',
        paint: {
          'fill-color': spreadColorExpression,
          'fill-opacity': spreadFillOpacityExpression,
        },
      })

      map.addLayer({
        id: 'pg-grid-spread-outline',
        type: 'line',
        source: 'pg-grid-spread',
        paint: {
          'line-color': spreadOutlineColorExpression,
          'line-width': [
            'case',
            ['boolean', ['coalesce', ['get', 'spreadFromMarker'], false], false],
            3,
            2.35,
          ],
          'line-opacity': [
            'case',
            ['boolean', ['coalesce', ['get', 'spreadFromMarker'], false], false],
            0.95,
            0.86,
          ],
          'line-dasharray': [2, 2],
        },
      })

      map.addLayer({
        id: 'pg-scan-marker-circle',
        type: 'circle',
        source: 'pg-scan-markers',
        paint: {
          'circle-radius': 6,
          'circle-color': '#14B8A6',
          'circle-stroke-color': '#E0F2FE',
          'circle-stroke-width': 2,
          'circle-opacity': 0.96,
        },
      })

      map.addLayer({
        id: 'pg-scan-marker-label',
        type: 'symbol',
        source: 'pg-scan-markers',
        layout: {
          'text-field': ['coalesce', ['get', 'diagnosisLabel'], ['get', 'gridId']],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        },
        paint: {
          'text-color': '#F8FAFC',
          'text-halo-color': '#0F172A',
          'text-halo-width': 1.3,
        },
      })

      map.on('click', 'pg-scan-marker-circle', (event) => {
        const feature = event?.features?.[0]
        if (!feature || feature.geometry?.type !== 'Point') {
          return
        }

        const [lng, lat] = feature.geometry.coordinates || []
        const diagnosisLabel = String(feature.properties?.diagnosisLabel || '').trim() || 'Pending diagnosis'
        const markerCropType = String(feature.properties?.cropType || '').trim()
        const capturedAt = String(feature.properties?.capturedAt || '').trim()
        const capturedAtLabel = String(feature.properties?.capturedAtLabel || '').trim() || formatCapturedAt(capturedAt)
        const captureImageUrl = String(feature.properties?.captureImageUrl || '').trim()

        const popupContainer = document.createElement('div')
        popupContainer.style.maxWidth = '280px'

        const titleNode = document.createElement('strong')
        titleNode.textContent = diagnosisLabel
        popupContainer.appendChild(titleNode)

        if (markerCropType) {
          const cropNode = document.createElement('div')
          cropNode.style.marginTop = '4px'
          cropNode.textContent = `crop type: ${markerCropType}`
          popupContainer.appendChild(cropNode)
        }

        if (capturedAtLabel) {
          const timeNode = document.createElement('div')
          timeNode.style.marginTop = '4px'
          timeNode.textContent = `time of capture: ${capturedAtLabel}`
          popupContainer.appendChild(timeNode)
        }

        if (captureImageUrl) {
          const imageWrap = document.createElement('div')
          imageWrap.style.marginTop = '8px'
          imageWrap.style.borderRadius = '8px'
          imageWrap.style.overflow = 'hidden'
          imageWrap.style.border = '1px solid rgba(148, 163, 184, 0.35)'

          const imageNode = document.createElement('img')
          imageNode.src = captureImageUrl
          imageNode.alt = `${diagnosisLabel} capture`
          imageNode.style.display = 'block'
          imageNode.style.width = '100%'
          imageNode.style.maxHeight = '180px'
          imageNode.style.objectFit = 'cover'

          imageNode.addEventListener('error', () => {
            imageWrap.innerHTML = ''
            const fallback = document.createElement('div')
            fallback.style.padding = '8px'
            fallback.style.fontSize = '12px'
            fallback.style.opacity = '0.85'
            fallback.textContent = 'The image has expired. Please take a new photo to obtain the latest record.'
            imageWrap.appendChild(fallback)
          }, { once: true })

          imageWrap.appendChild(imageNode)
          popupContainer.appendChild(imageWrap)
        }

        new mapboxgl.Popup({ offset: 14 })
          .setLngLat([Number(lng), Number(lat)])
          .setDOMContent(popupContainer)
          .addTo(map)
      })

      map.on('mouseenter', 'pg-scan-marker-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', 'pg-scan-marker-circle', () => {
        map.getCanvas().style.cursor = ''
      })

      fitToUserLocation()
      mapReadyRef.current = true
      setMapReady(true)
      setActionMessage('Map ready. Draw polygon areas to build your farm grid.')
    })

    map.on('draw.create', onDrawCreate)
    map.on('draw.update', onDrawUpdate)
    map.on('draw.delete', onDrawDelete)

    mapRef.current = map
    drawRef.current = draw

    return () => {
      mapReadyRef.current = false
      setMapReady(false)

      // Detach refs first so downstream effects never touch a disposing map instance.
      mapRef.current = null
      drawRef.current = null

      try {
        map.off('draw.create', onDrawCreate)
        map.off('draw.update', onDrawUpdate)
        map.off('draw.delete', onDrawDelete)
      } catch (listenerCleanupError) {
        console.warn('Map listener cleanup skipped:', listenerCleanupError)
      }

      try {
        map.getCanvas().style.cursor = ''
      } catch {
        // Cursor reset is best-effort only.
      }

      try {
        map.remove()
      } catch (mapCleanupError) {
        console.warn('Map instance cleanup failed:', mapCleanupError)
      }
    }
  }, [deleteGrid, isFirebaseConfigured, isMapboxConfigured, mapboxToken, saveOrUpdateGridByFeature])

  useEffect(() => {
    if (!mapReady || !mapReadyRef.current || !mapRef.current) {
      return
    }

    const source = mapRef.current.getSource('pg-grids')
    if (source) {
      source.setData(effectiveGridCollection)
    }

    const bufferSource = mapRef.current.getSource('pg-grid-buffers')
    if (bufferSource) {
      bufferSource.setData(createBufferCollection(grids))
    }

    const spreadSource = mapRef.current.getSource('pg-grid-spread')
    if (spreadSource) {
      spreadSource.setData(effectiveSpreadCollection)
    }
  }, [effectiveGridCollection, effectiveSpreadCollection, mapReady])

  useEffect(() => {
    if (!mapReady || !mapReadyRef.current || !mapRef.current) {
      return
    }

    const markerSource = mapRef.current.getSource('pg-scan-markers')
    if (markerSource) {
      markerSource.setData(createScanMarkerCollection(scanMarkers))
    }
  }, [mapReady, scanMarkers])

  const onConfirmSave = async () => {
    if (!pendingFeature) {
      setActionMessage('Draw or edit a grid first, then confirm save.')
      return
    }

    const resolvedZoneName = String(pendingZoneName || pendingFeature?.properties?.gridId || '').trim() || createGridId()

    setIsSavingPending(true)
    try {
      await saveOrUpdateGridByFeature({
        mapFeatureId: String(pendingFeature.id),
        gridId: resolvedZoneName,
        polygon: pendingFeature.geometry,
        areaHectares: turf.area(pendingFeature) / 10000,
        centroid: {
          lat: turf.centroid(pendingFeature).geometry.coordinates[1],
          lng: turf.centroid(pendingFeature).geometry.coordinates[0],
        },
      })
      setActionMessage(`Zone ${resolvedZoneName} confirmed and synced.`)
      setLastSaveState('saved')
      setPendingFeature(null)
      setPendingZoneName('')
    } catch (errorMessage) {
      setActionMessage(errorMessage.message || 'Failed to confirm save')
      setLastSaveState('failed')
    } finally {
      setIsSavingPending(false)
    }
  }

  const handleDeletePersistedGrid = async (grid) => {
    if (!grid?.id) {
      return
    }

    if (!isFirebaseConfigured) {
      setActionMessage('Grid delete requires Firebase configuration and authenticated access.')
      setLastSaveState('failed')
      return
    }

    const gridLabel = grid.gridId || grid.id
    const shouldDelete = window.confirm(`Delete saved polygon ${gridLabel}?`)
    if (!shouldDelete) {
      return
    }

    try {
      setDeletingGridId(String(grid.id))
      await deleteGrid(String(grid.id))
      if (String(pendingFeature?.id || '') === String(grid.mapFeatureId || grid.id)) {
        setPendingFeature(null)
      }
      setActionMessage(`Removed ${gridLabel}.`)
      setLastSaveState('saved')
    } catch (deleteError) {
      setActionMessage(deleteError?.message || `Failed to delete ${gridLabel}.`)
      setLastSaveState('failed')
    } finally {
      setDeletingGridId('')
    }
  }

  const handleDeleteScanMarker = async (marker) => {
    const captureId = String(marker?.captureId || '').trim()
    const markerDeleteKey = resolveMarkerDeleteKey(marker)

    if (!isFirebaseConfigured || !db) {
      setActionMessage('Marker delete requires Firebase configuration and authenticated access.')
      setLastSaveState('failed')
      return
    }

    const diagnosisLabel = String(marker?.diagnosisLabel || marker?.gridId || captureId).trim()
    const shouldDelete = window.confirm(`Delete marker "${diagnosisLabel}" and its saved scan records?`)
    if (!shouldDelete) {
      return
    }

    try {
      setDeletingMarkerKey(markerDeleteKey)
      const result = await deleteMarkerRecord(marker)
      setActionMessage(`Deleted marker ${diagnosisLabel}. Removed ${result.deletedReportCount} linked reports${result.deletedCapture ? ' and capture record' : ''}.`)
      setLastSaveState('saved')
    } catch (deleteError) {
      setActionMessage(deleteError?.message || 'Failed to delete scan marker.')
      setLastSaveState('failed')
    } finally {
      setDeletingMarkerKey('')
    }
  }

  const handleRenamePersistedGrid = async (grid) => {
    const gridDocId = String(grid?.id || '').trim()
    if (!gridDocId) {
      return
    }

    const nextName = String(zoneNameDrafts[gridDocId] || '').trim()
    if (!nextName) {
      setActionMessage('Zone name cannot be empty.')
      setLastSaveState('failed')
      return
    }

    const nextCropType = String(zoneCropTypeDrafts[gridDocId] || '').trim()

    const currentName = String(grid?.gridId || '').trim()
    const currentCropType = String(grid?.cropType || '').trim()
    const shouldUpdateName = nextName !== currentName
    const shouldUpdateCropType = nextCropType !== currentCropType

    if (!shouldUpdateName && !shouldUpdateCropType) {
      setActionMessage('Zone details are unchanged.')
      return
    }

    try {
      setRenamingGridId(gridDocId)

      if (shouldUpdateName) {
        await updateGridName(gridDocId, nextName)
      }

      if (shouldUpdateCropType) {
        await updateGridCropType(gridDocId, nextCropType)
      }

      const renameMessage = shouldUpdateName ? `Zone renamed to ${nextName}.` : 'Zone name unchanged.'
      const cropTypeMessage = shouldUpdateCropType
        ? (nextCropType ? ` Crop type set to ${nextCropType}.` : ' Crop type cleared.')
        : ''
      setActionMessage(`${renameMessage}${cropTypeMessage}`.trim())
      setLastSaveState('saved')
    } catch (renameError) {
      setActionMessage(renameError?.message || 'Failed to save zone details.')
      setLastSaveState('failed')
    } finally {
      setRenamingGridId('')
    }
  }

  const totalHectares = useMemo(
    () => grids.reduce((sum, item) => sum + Number(item.areaHectares || 0), 0),
    [grids],
  )

  const syncStatusLabel = !isFirebaseConfigured
    ? 'Disabled'
    : isLoading
      ? 'Syncing...'
      : error
        ? (String(error).toLowerCase().includes('sign in') ? 'Auth required' : 'Error')
        : 'Ready'

  const healthyCount = grids.filter((item) => item.healthState === 'Healthy').length
  const riskCount = grids.filter((item) => item.healthState === 'At-Risk').length
  const infectedCount = grids.filter((item) => item.healthState === 'Infected').length
  const spreadZoneCount = Array.isArray(effectiveSpreadCollection?.features) ? effectiveSpreadCollection.features.length : 0
  const riskRecommendations = grids
    .filter((item) => item.healthState === 'At-Risk' || item.healthState === 'Infected')
    .slice(0, 4)

  return (
    <section className="pg-page pg-page-map">
      <SectionHeader title="Map" align="center" />

      <article className="pg-map-stage">
        <div className="pg-map-canvas-wrap">
          {!isMapboxConfigured ? (
            <div className="pg-map-placeholder">
              <p>Mapbox key is missing</p>
              <small>Add VITE_MAPBOX_TOKEN in frontend/.env to load the live map.</small>
            </div>
          ) : (
            <>
              <div ref={mapContainerRef} className="pg-map-canvas" />
              {!mapReady ? <div className="pg-map-loading">Loading map...</div> : null}
            </>
          )}
        </div>

        <aside className="pg-map-controls">
          <h3>Grid controls</h3>
          <p className="pg-map-status">{actionMessage}</p>
          <p className="pg-map-status">
            Save status:{' '}
            <strong>
              {lastSaveState === 'pending'
                ? 'Pending sync'
                : lastSaveState === 'saved'
                  ? 'Saved'
                  : lastSaveState === 'failed'
                    ? 'Needs attention'
                    : 'Idle'}
            </strong>
          </p>
          <div className="pg-cta-row">
            <label className="pg-field-label" htmlFor="pg-map-zone-name">Zone name</label>
            <input
              id="pg-map-zone-name"
              className="pg-input"
              type="text"
              value={pendingZoneName}
              placeholder="Enter zone name"
              maxLength={56}
              onChange={(event) => setPendingZoneName(event.target.value)}
            />
            <button
              type="button"
              className="pg-btn pg-btn-primary"
              onClick={onConfirmSave}
              disabled={!pendingFeature || isSavingPending || !isFirebaseConfigured}
            >
              {isSavingPending ? 'Saving…' : 'Confirm grid save'}
            </button>
          </div>
          <div className="pg-map-legend">
            <span><i className="dot healthy" />Healthy</span>
            <span><i className="dot risk" />At-Risk</span>
            <span><i className="dot infected" />Infected</span>
            <span><i className="dot risk" />Spread zone</span>
          </div>
          <div className="pg-map-metrics">
            <p><strong>Total area</strong><span>{totalHectares.toFixed(2)} ha</span></p>
            <p><strong>Last draw</strong><span>{localAreaHectares.toFixed(2)} ha</span></p>
            <p><strong>Grid zones</strong><span>{grids.length}</span></p>
            <p><strong>Healthy</strong><span>{healthyCount}</span></p>
            <p><strong>At-Risk</strong><span>{riskCount}</span></p>
            <p><strong>Infected</strong><span>{infectedCount}</span></p>
            <p><strong>Spread zones</strong><span>{spreadZoneCount}</span></p>
            <p><strong>Marked scans</strong><span>{scanMarkers.length}</span></p>
            <p><strong>Connection</strong><span>{isOnline ? 'Online' : 'Offline'}</span></p>
            <p><strong>Sync</strong><span>{syncStatusLabel}</span></p>
          </div>

          {error ? (
            <p className="pg-map-status" style={{ marginTop: 8 }}>
              <strong>Sync detail:</strong> {error}
            </p>
          ) : null}

          {markerLoadError ? (
            <p className="pg-map-status" style={{ marginTop: 8 }}>
              <strong>Marker sync detail:</strong> {markerLoadError}
            </p>
          ) : null}

          {scanMarkers.length > 0 ? (
            <article className="pg-card" style={{ marginTop: 12 }}>
              <h3>Marked scan points</h3>
              {scanMarkers.slice(0, 12).map((marker) => {
                const markerName = String(marker?.diagnosisLabel || marker?.gridId || marker?.captureId || 'Unknown scan').trim()
                const markerCropType = String(marker?.cropType || '').trim() || 'Not set'
                const markerDeleteKey = resolveMarkerDeleteKey(marker)
                const markerTime = String(marker?.capturedAtLabel || '').trim() || 'Unknown time'
                return (
                  <div
                    key={marker.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <small style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                        Crop Type: {markerCropType}
                      </small>
                      <small style={{ display: 'block', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {markerName}
                      </small>
                      <small style={{ display: 'block', opacity: 0.78 }}>
                        Time of capture: {markerTime}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="pg-btn pg-btn-ghost"
                      style={{
                        padding: '8px 12px',
                        minHeight: 'auto',
                        fontSize: '0.8rem',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        marginLeft: 'auto',
                        borderColor: 'rgba(var(--danger-rgb), 0.45)',
                        color: 'var(--danger)',
                      }}
                      onClick={() => handleDeleteScanMarker(marker)}
                      disabled={!markerDeleteKey || deletingMarkerKey === markerDeleteKey}
                    >
                      {deletingMarkerKey === markerDeleteKey ? 'Deleting…' : 'Delete marker'}
                    </button>
                  </div>
                )
              })}
            </article>
          ) : null}

          {grids.length > 0 ? (
            <article className="pg-card" style={{ marginTop: 12 }}>
              <h3>Saved polygons</h3>
              {grids.slice(0, 10).map((grid) => (
                <div
                  key={grid.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    marginBottom: 16,
                    paddingBottom: 16,
                    borderBottom: '1px solid rgba(var(--border-rgb), 0.3)',
                  }}
                >
                  <small style={{ display: 'block', fontWeight: 600, color: 'var(--pg-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {grid.gridId || grid.id} ({Number(grid.areaHectares || 0).toFixed(2)} ha)
                  </small>

                  <small style={{ display: 'block', opacity: 0.8 }}>
                    Crop type: {String(grid.cropType || '').trim() || 'Not set'}
                  </small>
                  
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="pg-input"
                      type="text"
                      style={{ flex: 1, minWidth: 0, margin: 0 }}
                      value={zoneNameDrafts[String(grid.id)] || ''}
                      maxLength={56}
                      onChange={(event) => {
                        const value = event.target.value
                        const key = String(grid.id)
                        setZoneNameDrafts((prev) => ({
                          ...prev,
                          [key]: value,
                        }))
                      }}
                    />

                    <input
                      className="pg-input"
                      type="text"
                      style={{ flex: 1, minWidth: 0, margin: 0 }}
                      value={zoneCropTypeDrafts[String(grid.id)] || ''}
                      maxLength={56}
                      placeholder="Crop type (e.g. Paddy)"
                      onChange={(event) => {
                        const value = event.target.value
                        const key = String(grid.id)
                        setZoneCropTypeDrafts((prev) => ({
                          ...prev,
                          [key]: value,
                        }))
                      }}
                    />
                    
                    <button
                      type="button"
                      className="pg-btn pg-btn-ghost"
                      style={{ padding: '8px 12px', minHeight: 'auto', fontSize: '0.8rem' }}
                      onClick={() => handleRenamePersistedGrid(grid)}
                      disabled={renamingGridId === grid.id || deletingGridId === grid.id}
                    >
                      {renamingGridId === grid.id ? 'Save…' : 'Save'}
                    </button>
                    
                    <button
                      type="button"
                      className="pg-btn"
                      style={{ padding: '8px 12px', minHeight: 'auto', fontSize: '0.8rem', background: 'rgba(var(--danger-rgb), 0.1)', color: 'var(--danger)', border: '1px solid rgba(var(--danger-rgb), 0.4)' }}
                      onClick={() => handleDeletePersistedGrid(grid)}
                      disabled={deletingGridId === grid.id || renamingGridId === grid.id}
                    >
                      {deletingGridId === grid.id ? 'Del…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </article>
          ) : null}

          {riskRecommendations.length > 0 ? (
            <article className="pg-card" style={{ marginTop: 12 }}>
              <h3>Risk recommendations</h3>
              {riskRecommendations.map((grid) => (
                <p key={grid.id} className="pg-map-status" style={{ marginBottom: 8 }}>
                  <strong>{grid.gridId || grid.id}</strong>: {grid.bufferZoneAdvice || grid.riskReason || 'Monitor nearby spread and prepare preventive spray.'}
                  {Number(grid.riskDistanceKm || 0) > 0 ? ` (${Number(grid.riskDistanceKm).toFixed(3)} km)` : ''}
                </p>
              ))}
            </article>
          ) : null}
        </aside>
      </article>
    </section>
  )
}
