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

function createBufferCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: grids
      .filter((grid) => {
        const geometryType = grid?.bufferZone?.type
        return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
      })
      .map((grid) => ({
        type: 'Feature',
        id: `${grid.id}-buffer`,
        properties: {
          gridId: grid.gridId || grid.id,
          radiusKm: Number(grid.bufferZoneKm || 0),
        },
        geometry: grid.bufferZone,
      })),
  }
}

function createFeatureCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: grids
      .filter((grid) => grid?.polygon?.type === 'Polygon')
      .map((grid) => ({
        type: 'Feature',
        id: grid.id,
        properties: {
          gridId: grid.gridId || grid.id,
          healthState: grid.healthState || 'Healthy',
          areaHectares: grid.areaHectares || 0,
        },
        geometry: grid.polygon,
      })),
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
  } = useGrids()

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

      map.addLayer({
        id: 'pg-grid-buffer-fill',
        type: 'fill',
        source: 'pg-grid-buffers',
        paint: {
          'fill-color': '#FFA500',
          'fill-opacity': 0.12,
        },
      })

      map.addLayer({
        id: 'pg-grid-buffer-outline',
        type: 'line',
        source: 'pg-grid-buffers',
        paint: {
          'line-color': '#C97A00',
          'line-width': 2,
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
        const capturedAt = String(feature.properties?.capturedAt || '').trim()
        const capturedAtLabel = String(feature.properties?.capturedAtLabel || '').trim() || formatCapturedAt(capturedAt)
        const captureImageUrl = String(feature.properties?.captureImageUrl || '').trim()

        const popupContainer = document.createElement('div')
        popupContainer.style.maxWidth = '280px'

        const titleNode = document.createElement('strong')
        titleNode.textContent = diagnosisLabel
        popupContainer.appendChild(titleNode)

        if (capturedAtLabel) {
          const timeNode = document.createElement('div')
          timeNode.style.marginTop = '4px'
          timeNode.textContent = `拍照时间: ${capturedAtLabel}`
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
            fallback.textContent = '图片已失效，请重新拍照获取最新记录。'
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
      map.off('draw.create', onDrawCreate)
      map.off('draw.update', onDrawUpdate)
      map.off('draw.delete', onDrawDelete)
      map.remove()
      mapRef.current = null
      drawRef.current = null
      mapReadyRef.current = false
      setMapReady(false)
    }
  }, [deleteGrid, isFirebaseConfigured, isMapboxConfigured, mapboxToken, saveOrUpdateGridByFeature])

  useEffect(() => {
    if (!mapReady || !mapReadyRef.current || !mapRef.current) {
      return
    }

    const source = mapRef.current.getSource('pg-grids')
    if (source) {
      source.setData(createFeatureCollection(grids))
    }

    const bufferSource = mapRef.current.getSource('pg-grid-buffers')
    if (bufferSource) {
      bufferSource.setData(createBufferCollection(grids))
    }
  }, [grids, mapReady])

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

    const currentName = String(grid?.gridId || '').trim()
    if (nextName === currentName) {
      setActionMessage('Zone name is unchanged.')
      return
    }

    try {
      setRenamingGridId(gridDocId)
      await updateGridName(gridDocId, nextName)
      setActionMessage(`Zone renamed to ${nextName}.`)
      setLastSaveState('saved')
    } catch (renameError) {
      setActionMessage(renameError?.message || 'Failed to rename zone.')
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
  const bufferedCount = grids.filter((item) => item?.bufferZone).length
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
            <span><i className="dot risk" />Buffer zone</span>
          </div>
          <div className="pg-map-metrics">
            <p><strong>Total area</strong><span>{totalHectares.toFixed(2)} ha</span></p>
            <p><strong>Last draw</strong><span>{localAreaHectares.toFixed(2)} ha</span></p>
            <p><strong>Grid zones</strong><span>{grids.length}</span></p>
            <p><strong>Healthy</strong><span>{healthyCount}</span></p>
            <p><strong>At-Risk</strong><span>{riskCount}</span></p>
            <p><strong>Infected</strong><span>{infectedCount}</span></p>
            <p><strong>Buffer zones</strong><span>{bufferedCount}</span></p>
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
                const markerDeleteKey = resolveMarkerDeleteKey(marker)
                const markerTime = String(marker?.capturedAtLabel || '').trim() || 'Unknown time'
                return (
                  <div
                    key={marker.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <small style={{ display: 'block', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {markerName}
                      </small>
                      <small style={{ display: 'block', opacity: 0.78 }}>
                        拍照时间: {markerTime}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="pg-btn"
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
