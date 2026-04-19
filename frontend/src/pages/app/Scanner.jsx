import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import * as turf from '@turf/turf'
import { IconArrowLeft, IconSparkles } from '../../components/icons/UiIcons'
import { useGrids } from '../../hooks/useGrids'
import { useSessionContext } from '../../hooks/useSessionContext'
import { createScanCaptureId, persistUserScanCapture } from '../../services/scanCaptureStore'
import 'mapbox-gl/dist/mapbox-gl.css'

const PENDING_CAPTURE_KEY = 'pg_pending_scan_capture_v1'
const LIVE_FRAME_INTERVAL_MS = 1300
const DEFAULT_CAPTURE_PROMPT = 'I just took this photo. Please analyze it and tell me what to do next.'

const DEFAULT_ZONE_MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12'

function resolveWsScanUrl() {
  if (typeof window === 'undefined') {
    return '/ws/scan'
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws/scan`
}

function formatCaptureTime(date) {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function selectPrimaryDetection(results, frameNumber) {
  if (!Array.isArray(results) || results.length === 0) {
    return null
  }

  const candidates = results
    .map((item, index) => ({
      id: `${frameNumber || 0}-${index}`,
      cropType: String(item?.cropType || 'Unknown'),
      disease: String(item?.disease || 'Unknown'),
      severity: String(item?.severity || 'Low'),
      bbox: item?.bbox || { x: 0, y: 0, width: 0, height: 0 },
    }))
    .filter((item) => Number(item.bbox?.width || 0) > 0 && Number(item.bbox?.height || 0) > 0)

  if (candidates.length === 0) {
    return null
  }

  return candidates.reduce((best, candidate) => {
    if (!best) {
      return candidate
    }

    const candidateScore = Number(candidate.bbox?.detection_score || 0)
    const bestScore = Number(best.bbox?.detection_score || 0)
    if (candidateScore !== bestScore) {
      return candidateScore > bestScore ? candidate : best
    }

    const candidateArea = Number(candidate.bbox?.width || 0) * Number(candidate.bbox?.height || 0)
    const bestArea = Number(best.bbox?.width || 0) * Number(best.bbox?.height || 0)
    if (candidateArea !== bestArea) {
      return candidateArea > bestArea ? candidate : best
    }

    return best
  }, null)
}

function formatDetectionSummary(detection) {
  if (!detection) {
    return 'No crop or pest found in current frame.'
  }

  const cropType = detection.cropType && detection.cropType !== 'Unknown' ? detection.cropType : 'Target'
  return `${cropType} • ${detection.disease} • ${detection.severity}`
}

function captureFrameAsDataUrl(videoElement, options = {}) {
  const maxWidth = Number(options.maxWidth || 960)
  const quality = Number(options.quality || 0.85)
  const rawWidth = videoElement.videoWidth || 1280
  const rawHeight = videoElement.videoHeight || 720
  const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1
  const width = Math.round(rawWidth * scale)
  const height = Math.round(rawHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to capture frame from camera')
  }

  context.drawImage(videoElement, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

function savePendingCapture(payload) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures and let chatbot run without auto-processing.
  }
}

function isFiniteCoordinatePair(position) {
  return Number.isFinite(Number(position?.lat)) && Number.isFinite(Number(position?.lng))
}

function normalizeZonePosition(position) {
  if (!isFiniteCoordinatePair(position)) {
    return null
  }

  return {
    lat: Number(position.lat),
    lng: Number(position.lng),
  }
}

function deriveZonePositionLabel(zoneGeometry, lngLatPoint) {
  try {
    const feature = turf.feature(zoneGeometry)
    const centroid = turf.centroid(feature)
    const [centerLng, centerLat] = centroid.geometry.coordinates
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature)

    const dx = Number(lngLatPoint.lng) - Number(centerLng)
    const dy = Number(lngLatPoint.lat) - Number(centerLat)

    const lngThreshold = Math.max((Number(maxLng) - Number(minLng)) * 0.15, 0.00001)
    const latThreshold = Math.max((Number(maxLat) - Number(minLat)) * 0.15, 0.00001)

    const horizontal = dx > lngThreshold ? 'East' : dx < -lngThreshold ? 'West' : ''
    const vertical = dy > latThreshold ? 'North' : dy < -latThreshold ? 'South' : ''

    const label = `${vertical}${horizontal}`.trim()
    return label || 'Center'
  } catch {
    return 'Marked point'
  }
}

function getZoneMapSourceData(zoneGeometry, gridId) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          gridId,
        },
        geometry: zoneGeometry,
      },
    ],
  }
}

export default function Scanner() {
  const navigate = useNavigate()
  const { user } = useSessionContext()
  const { grids } = useGrids()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)
  const frameTimerRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const frameCounterRef = useRef(0)
  const requestInFlightRef = useRef(false)
  const isMountedRef = useRef(false)
  const zoneMapContainerRef = useRef(null)
  const zoneMapRef = useRef(null)
  const zoneMapMarkerRef = useRef(null)
  const [cameraState, setCameraState] = useState('loading')
  const [statusMessage, setStatusMessage] = useState('Initializing rear camera...')
  const [lastCaptureTime, setLastCaptureTime] = useState('')
  const [isCaptureFlashVisible, setIsCaptureFlashVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalizingCapture, setIsFinalizingCapture] = useState(false)
  const [liveDetections, setLiveDetections] = useState([])
  const [isZoneChoiceOpen, setIsZoneChoiceOpen] = useState(false)
  const [selectedGridId, setSelectedGridId] = useState('')
  const [zoneChoiceError, setZoneChoiceError] = useState('')
  const [zoneMarkerPosition, setZoneMarkerPosition] = useState(null)
  const [zoneMarkerLabel, setZoneMarkerLabel] = useState('')
  const [pendingCaptureDraft, setPendingCaptureDraft] = useState(null)

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
  const isMapboxConfigured = Boolean(mapboxToken && !String(mapboxToken).includes('YOUR_'))

  const zoneOptions = useMemo(() => {
    const uniqueZones = new Map()

    for (const grid of grids || []) {
      const gridId = String(grid?.gridId || grid?.id || '').trim()
      if (!gridId || uniqueZones.has(gridId)) {
        continue
      }

      uniqueZones.set(gridId, {
        value: gridId,
        label: gridId,
        healthState: String(grid?.healthState || 'Healthy'),
        areaHectares: Number(grid?.areaHectares || 0),
        geometry: grid?.polygon || null,
        hasGeometry: ['Polygon', 'MultiPolygon'].includes(String(grid?.polygon?.type || '')),
        centroid: grid?.centroid || null,
      })
    }

    return Array.from(uniqueZones.values())
  }, [grids])

  const selectedZone = useMemo(
    () => zoneOptions.find((zone) => zone.value === selectedGridId) || null,
    [zoneOptions, selectedGridId],
  )

  const canMarkSelectedZone = Boolean(
    isMapboxConfigured
    && selectedZone?.hasGeometry
    && ['Polygon', 'MultiPolygon'].includes(String(selectedZone?.geometry?.type || '')),
  )

  const clearZoneMap = () => {
    if (zoneMapMarkerRef.current) {
      zoneMapMarkerRef.current.remove()
      zoneMapMarkerRef.current = null
    }

    if (zoneMapRef.current) {
      zoneMapRef.current.remove()
      zoneMapRef.current = null
    }
  }

  const applyZoneMarker = (position) => {
    const map = zoneMapRef.current
    const normalized = normalizeZonePosition(position)
    if (!map || !normalized) {
      if (zoneMapMarkerRef.current) {
        zoneMapMarkerRef.current.remove()
        zoneMapMarkerRef.current = null
      }
      return
    }

    const nextLngLat = [normalized.lng, normalized.lat]
    if (!zoneMapMarkerRef.current) {
      zoneMapMarkerRef.current = new mapboxgl.Marker({
        color: '#14B8A6',
      })
        .setLngLat(nextLngLat)
        .addTo(map)
      return
    }

    zoneMapMarkerRef.current.setLngLat(nextLngLat)
  }

  const resetZoneChoiceState = () => {
    clearZoneMap()
    setIsZoneChoiceOpen(false)
    setSelectedGridId('')
    setZoneChoiceError('')
    setZoneMarkerPosition(null)
    setZoneMarkerLabel('')
    setPendingCaptureDraft(null)
  }

  const finalizeCaptureWithZone = async (gridId, markerPosition = null, markerLabel = null) => {
    if (!pendingCaptureDraft) {
      return
    }

    const resolvedGridId = String(gridId || '').trim() || null
    const resolvedMarkerPosition = resolvedGridId ? normalizeZonePosition(markerPosition) : null
    const resolvedMarkerLabel = resolvedGridId ? String(markerLabel || '').trim() || null : null

    if (resolvedGridId && !resolvedMarkerPosition) {
      setZoneChoiceError('Tap on the zone map to mark the exact location before continuing.')
      return
    }

    const { captureId, uid, base64Image, capturedAtIso } = pendingCaptureDraft

    setIsFinalizingCapture(true)
    setStatusMessage('Saving photo to your account...')

    try {
      let persistedCapture = { captureId, persisted: false, downloadURL: null, storagePath: null }

      if (uid) {
        try {
          persistedCapture = await persistUserScanCapture({
            uid,
            captureId,
            base64Image,
            capturedAt: capturedAtIso,
            source: 'camera',
            userPrompt: DEFAULT_CAPTURE_PROMPT,
            gridId: resolvedGridId,
            zoneAssignmentMode: resolvedGridId ? 'selected' : 'skipped',
            zonePosition: resolvedMarkerPosition,
            zonePositionLabel: resolvedMarkerLabel,
          })
        } catch (captureError) {
          console.warn('Failed to persist scanner capture:', captureError)
        }
      }

      savePendingCapture({
        source: 'camera',
        captureId,
        base64Image,
        capturedAt: capturedAtIso,
        userPrompt: DEFAULT_CAPTURE_PROMPT,
        ownerUid: uid || null,
        gridId: resolvedGridId,
        zoneAssignmentMode: resolvedGridId ? 'selected' : 'skipped',
        zonePosition: resolvedMarkerPosition,
        zonePositionLabel: resolvedMarkerLabel,
        captureDownloadURL: persistedCapture.downloadURL || null,
        captureStoragePath: persistedCapture.storagePath || null,
        capturePersisted: Boolean(persistedCapture.persisted),
      })

      resetZoneChoiceState()
      setStatusMessage('Photo saved. Opening PadiGuard AI Assistant...')
      navigate(`/app/chatbot?fromScan=1&captureId=${encodeURIComponent(captureId)}`)
    } catch (error) {
      setStatusMessage(error?.message || 'Capture failed. Please try again.')
    } finally {
      setIsFinalizingCapture(false)
    }
  }

  const handleSkipZone = () => {
    setZoneChoiceError('')
    void finalizeCaptureWithZone(null)
  }

  const handleUseSelectedZone = () => {
    if (!selectedGridId) {
      setZoneChoiceError('Please select a zone or skip zone for photo-only diagnosis.')
      return
    }

    if (!selectedZone?.hasGeometry) {
      setZoneChoiceError('This zone has no map boundary yet. Please select another zone or skip zone.')
      return
    }

    if (!canMarkSelectedZone) {
      setZoneChoiceError('Zone map is unavailable. Configure map access or skip zone for this photo.')
      return
    }

    if (!normalizeZonePosition(zoneMarkerPosition)) {
      setZoneChoiceError('Tap on the zone map to mark the exact location before continuing.')
      return
    }

    setZoneChoiceError('')
    void finalizeCaptureWithZone(selectedGridId, zoneMarkerPosition, zoneMarkerLabel)
  }

  const handleRetakeCapture = () => {
    if (isFinalizingCapture) {
      return
    }

    resetZoneChoiceState()
    setStatusMessage('Capture discarded. Take another photo when ready.')
  }

  useEffect(() => {
    if (!selectedGridId) {
      setZoneMarkerPosition(null)
      setZoneMarkerLabel('')
      return
    }

    setZoneMarkerPosition(null)
    setZoneMarkerLabel('')
    setZoneChoiceError('')
  }, [selectedGridId])

  useEffect(() => {
    if (!isZoneChoiceOpen || !selectedZone || !selectedZone?.hasGeometry || !canMarkSelectedZone) {
      clearZoneMap()
      return undefined
    }

    if (!zoneMapContainerRef.current) {
      return undefined
    }

    mapboxgl.accessToken = mapboxToken
    const zoneGeometry = selectedZone.geometry
    const zoneFeature = turf.feature(zoneGeometry)

    const map = new mapboxgl.Map({
      container: zoneMapContainerRef.current,
      style: DEFAULT_ZONE_MAP_STYLE,
      center: [101.6958, 3.139],
      zoom: 16,
      attributionControl: false,
    })

    zoneMapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right')

    const onMapClick = (event) => {
      const lng = Number(event?.lngLat?.lng)
      const lat = Number(event?.lngLat?.lat)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return
      }

      const candidatePoint = turf.point([lng, lat])
      const isInside = turf.booleanPointInPolygon(candidatePoint, zoneFeature)
      if (!isInside) {
        setZoneChoiceError('Marker must be inside the selected zone boundary.')
        return
      }

      const nextPosition = {
        lat,
        lng,
      }
      setZoneMarkerPosition(nextPosition)
      setZoneMarkerLabel(deriveZonePositionLabel(zoneGeometry, nextPosition))
      setZoneChoiceError('')
      applyZoneMarker(nextPosition)
    }

    map.on('load', () => {
      const sourceData = getZoneMapSourceData(zoneGeometry, selectedZone.value)
      map.addSource('pg-scanner-zone-boundary', {
        type: 'geojson',
        data: sourceData,
      })

      map.addLayer({
        id: 'pg-scanner-zone-fill',
        type: 'fill',
        source: 'pg-scanner-zone-boundary',
        paint: {
          'fill-color': '#22D3EE',
          'fill-opacity': 0.22,
        },
      })

      map.addLayer({
        id: 'pg-scanner-zone-outline',
        type: 'line',
        source: 'pg-scanner-zone-boundary',
        paint: {
          'line-color': '#0E7490',
          'line-width': 2.2,
        },
      })

      const [minLng, minLat, maxLng, maxLat] = turf.bbox(zoneFeature)
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: 44,
          duration: 0,
          maxZoom: 18,
        },
      )

      applyZoneMarker(zoneMarkerPosition)
    })

    map.on('click', onMapClick)

    return () => {
      map.off('click', onMapClick)
      clearZoneMap()
    }
  }, [
    canMarkSelectedZone,
    isZoneChoiceOpen,
    mapboxToken,
    selectedZone,
  ])

  useEffect(() => {
    applyZoneMarker(zoneMarkerPosition)
  }, [zoneMarkerPosition])

  const stopLiveLoop = () => {
    if (frameTimerRef.current) {
      window.clearInterval(frameTimerRef.current)
      frameTimerRef.current = null
    }
    requestInFlightRef.current = false
  }

  const closeLiveSocket = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        // Ignore close errors on unstable mobile networks.
      }
      wsRef.current = null
    }
  }

  const scheduleReconnect = () => {
    if (reconnectTimerRef.current || !isMountedRef.current) {
      return
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      if (isMountedRef.current) {
        connectLiveScan()
      }
    }, 2000)
  }

  const sendLiveFrame = () => {
    const ws = wsRef.current
    const video = videoRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !video || requestInFlightRef.current) {
      return
    }

    const hasVideoPixels = Number(video.videoWidth || 0) > 0 && Number(video.videoHeight || 0) > 0
    if (!hasVideoPixels) {
      return
    }

    try {
      const base64Image = captureFrameAsDataUrl(video, { maxWidth: 720, quality: 0.72 })
      requestInFlightRef.current = true
      frameCounterRef.current += 1
      ws.send(
        JSON.stringify({
          frame_number: frameCounterRef.current,
          grid_id: null,
          base64_image: base64Image,
          regions: [],
        }),
      )
    } catch (error) {
      requestInFlightRef.current = false
      setStatusMessage(error?.message || 'Live frame capture failed.')
    }
  }

  const connectLiveScan = () => {
    if (!isMountedRef.current || cameraState !== 'ready') {
      return
    }

    const current = wsRef.current
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return
    }

    closeLiveSocket()
    stopLiveLoop()

    const ws = new WebSocket(resolveWsScanUrl())
    wsRef.current = ws
    setStatusMessage('Connecting realtime scanner...')

    ws.onopen = () => {
      if (!isMountedRef.current) {
        return
      }
      setStatusMessage('Realtime diagnosis active. Tracking one plant or pest at a time.')
      stopLiveLoop()
      frameTimerRef.current = window.setInterval(sendLiveFrame, LIVE_FRAME_INTERVAL_MS)
      sendLiveFrame()
    }

    ws.onmessage = (event) => {
      requestInFlightRef.current = false
      if (!isMountedRef.current) {
        return
      }

      try {
        const payload = JSON.parse(event.data)
        if (payload?.error) {
          setStatusMessage(String(payload.error))
          return
        }

        const primaryDetection = selectPrimaryDetection(payload?.results, payload?.frame_number)

        setLiveDetections(primaryDetection ? [primaryDetection] : [])
        setStatusMessage(
          primaryDetection
            ? `Tracking one target: ${formatDetectionSummary(primaryDetection)}`
            : 'Realtime diagnosis active. No crop or pest found in current frame.',
        )
      } catch {
        setStatusMessage('Invalid realtime response from diagnosis backend.')
      }
    }

    ws.onerror = () => {
      requestInFlightRef.current = false
      if (isMountedRef.current) {
        setStatusMessage('Realtime connection error. Reconnecting...')
      }
    }

    ws.onclose = () => {
      requestInFlightRef.current = false
      stopLiveLoop()
      if (isMountedRef.current) {
        setLiveDetections([])
        setStatusMessage('Realtime scanner disconnected. Reconnecting...')
        scheduleReconnect()
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    let isMounted = true

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('blocked')
        setStatusMessage('Camera is unavailable on this device.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            if (!isMounted) {
              return
            }

            setCameraState('ready')
            setStatusMessage('Camera ready. Point the lens at a plant or pest.')
          }

          videoRef.current.play().catch(() => {
            if (!isMounted) {
              return
            }
            setCameraState('blocked')
            setStatusMessage('Tap browser camera permission to continue scanning.')
          })
        }
      } catch {
        if (!isMounted) {
          return
        }
        setCameraState('blocked')
        setStatusMessage('Camera permission denied. Enable it to start scanning.')
      }
    }

    startCamera()

    return () => {
      isMountedRef.current = false
      isMounted = false
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      stopLiveLoop()
      closeLiveSocket()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (cameraState === 'ready') {
      connectLiveScan()
      return
    }

    stopLiveLoop()
    closeLiveSocket()
    setLiveDetections([])
  }, [cameraState])

  const handleCapture = async () => {
    if (cameraState !== 'ready') {
      setStatusMessage('Camera is still preparing. Try again in a moment.')
      return
    }

    if (isSubmitting) {
      return
    }

    if (!videoRef.current) {
      setStatusMessage('Camera stream is not ready. Please try again.')
      return
    }

    setIsCaptureFlashVisible(true)
    window.setTimeout(() => {
      setIsCaptureFlashVisible(false)
    }, 110)

    setIsSubmitting(true)
    const capturedAt = new Date()
    setLastCaptureTime(formatCaptureTime(capturedAt))
    setStatusMessage('Frame captured. Preparing zone options...')

    try {
      const captureId = createScanCaptureId()
      const uid = String(user?.uid || '').trim()
      const base64Image = captureFrameAsDataUrl(videoRef.current)
      const capturedAtIso = capturedAt.toISOString()

      setPendingCaptureDraft({
        captureId,
        uid,
        base64Image,
        capturedAtIso,
      })
      setSelectedGridId('')
      setZoneChoiceError('')
      setIsZoneChoiceOpen(true)
      setStatusMessage(
        zoneOptions.length > 0
          ? 'Photo captured. Select a zone or skip for photo-only diagnosis.'
          : 'Photo captured. No saved zones found. Continue with photo-only diagnosis.',
      )
    } catch (error) {
      setStatusMessage(error?.message || 'Capture failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="pg-scanner-page" aria-label="Live crop scanner">
      <div className="pg-scanner-feed-layer">
        <video
          ref={videoRef}
          className={`pg-scanner-video ${cameraState === 'ready' ? 'is-ready' : ''}`}
          autoPlay
          muted
          playsInline
        />

        {liveDetections.length > 0 ? (
          <div className="pg-scanner-detection-overlay" aria-hidden="true">
            {liveDetections.map((detection) => {
              const x = Math.max(0, Math.min(1, Number(detection.bbox?.x || 0)))
              const y = Math.max(0, Math.min(1, Number(detection.bbox?.y || 0)))
              const width = Math.max(0, Math.min(1 - x, Number(detection.bbox?.width || 0)))
              const height = Math.max(0, Math.min(1 - y, Number(detection.bbox?.height || 0)))

              return (
                <div
                  key={detection.id}
                  className="pg-scanner-bbox"
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${width * 100}%`,
                    height: `${height * 100}%`,
                  }}
                >
                  <span className="pg-scanner-bbox-label">
                    {detection.cropType && detection.cropType !== 'Unknown'
                      ? `${detection.cropType} • ${detection.disease}`
                      : `${detection.disease} • ${detection.severity}`}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}

        {cameraState !== 'ready' ? (
          <div className="pg-scanner-loading" role="status" aria-live="polite">
            <p>{statusMessage}</p>
          </div>
        ) : null}
      </div>

      {isCaptureFlashVisible ? <div className="pg-scanner-flash" aria-hidden="true" /> : null}

      <header className="pg-scanner-top-overlay">
        <button
          type="button"
          className="pg-scanner-overlay-btn"
          onClick={() => navigate('/app')}
          aria-label="Back to home"
        >
          <IconArrowLeft className="pg-icon" />
        </button>
        <div className="pg-scanner-top-actions">
          <button
            type="button"
            disabled={isSubmitting || isFinalizingCapture || isZoneChoiceOpen}
            className="pg-scanner-overlay-btn pg-scanner-chatbot-btn"
            onClick={() => navigate('/app/chatbot')}
            aria-label="Open AI chatbot"
          >
            <IconSparkles className="pg-icon" />
          </button>
        </div>
      </header>

      <footer className="pg-scanner-bottom-overlay">
        <p className="pg-scanner-status">
          {lastCaptureTime ? `Last capture at ${lastCaptureTime}` : statusMessage}
        </p>

        <button
          type="button"
          className="pg-scanner-capture-btn"
          onClick={handleCapture}
          disabled={isSubmitting || isFinalizingCapture || isZoneChoiceOpen}
          aria-label="Capture crop photo"
        />
      </footer>

      {isZoneChoiceOpen && pendingCaptureDraft && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pg-scanner-zone-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Optional zone selection"
            >
              <section className="pg-sheet pg-scanner-zone-sheet">
                <span className="pg-sheet-handle" aria-hidden="true" />

                <header className="pg-sheet-header pg-scanner-zone-header">
                  <h2>Zone selection</h2>
                  <button
                    type="button"
                    className="pg-btn pg-btn-ghost pg-btn-inline"
                    onClick={handleRetakeCapture}
                    disabled={isFinalizingCapture}
                  >
                    Retake
                  </button>
                </header>

                <div className="pg-sheet-body pg-scanner-zone-body">
                  <p className="pg-scanner-zone-hint">
                    Choose a zone for better report traceability, or skip zone to diagnose this photo directly.
                  </p>

                  <label className="pg-field-label" htmlFor="pg-scanner-zone-select">
                    Select zone (optional)
                  </label>
                  <select
                    id="pg-scanner-zone-select"
                    className="pg-input pg-scanner-zone-select"
                    value={selectedGridId}
                    onChange={(event) => {
                      setSelectedGridId(event.target.value)
                      if (zoneChoiceError) {
                        setZoneChoiceError('')
                      }
                    }}
                    disabled={isFinalizingCapture || zoneOptions.length === 0}
                  >
                    <option value="">
                      {zoneOptions.length > 0 ? 'Choose one zone...' : 'No zone available'}
                    </option>
                    {zoneOptions.map((zone) => (
                      <option key={zone.value} value={zone.value} disabled={!zone.hasGeometry}>
                        {zone.label} ({zone.healthState}, {zone.areaHectares.toFixed(2)} ha{zone.hasGeometry ? '' : ', no boundary'})
                      </option>
                    ))}
                  </select>

                  {zoneOptions.length === 0 ? (
                    <p className="pg-scanner-zone-list-hint">
                      No saved zones found yet. Continue with photo-only diagnosis.
                    </p>
                  ) : null}

              {selectedGridId && selectedZone?.hasGeometry ? (
                <>
                  <p className="pg-scanner-zone-list-hint">
                    Tap once inside the zone boundary to mark the exact capture location.
                  </p>

                  {canMarkSelectedZone ? (
                    <div ref={zoneMapContainerRef} className="pg-scanner-zone-map" />
                  ) : (
                    <p className="pg-scanner-zone-map-placeholder">
                      Zone map is unavailable because Mapbox token is missing. You can skip zone for this photo.
                    </p>
                  )}

                  {normalizeZonePosition(zoneMarkerPosition) ? (
                    <p className="pg-scanner-zone-marker-hint">
                      Marker saved at {Number(zoneMarkerPosition.lat).toFixed(5)}, {Number(zoneMarkerPosition.lng).toFixed(5)}
                      {zoneMarkerLabel ? ` (${zoneMarkerLabel})` : ''}.
                    </p>
                  ) : null}
                </>
              ) : null}

                  {zoneChoiceError ? <p className="pg-scanner-zone-error">{zoneChoiceError}</p> : null}

                  <div className="pg-sheet-actions pg-scanner-zone-actions">
                    <button
                      type="button"
                      className="pg-btn pg-btn-primary"
                      onClick={handleUseSelectedZone}
                      disabled={isFinalizingCapture || zoneOptions.length === 0}
                    >
                      Continue with selected zone
                    </button>
                    <button
                      type="button"
                      className="pg-btn pg-btn-ghost"
                      onClick={handleSkipZone}
                      disabled={isFinalizingCapture}
                    >
                      Skip zone and diagnose photo
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
