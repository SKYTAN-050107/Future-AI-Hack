import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconSparkles } from '../../components/icons/UiIcons'
import { useSessionContext } from '../../hooks/useSessionContext'
import { createScanCaptureId, persistUserScanCapture } from '../../services/scanCaptureStore'

const PENDING_CAPTURE_KEY = 'pg_pending_scan_capture_v1'
const LIVE_FRAME_INTERVAL_MS = 1300

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

export default function Scanner() {
  const navigate = useNavigate()
  const { user } = useSessionContext()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)
  const frameTimerRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const frameCounterRef = useRef(0)
  const requestInFlightRef = useRef(false)
  const isMountedRef = useRef(false)
  const [cameraState, setCameraState] = useState('loading')
  const [statusMessage, setStatusMessage] = useState('Initializing rear camera...')
  const [lastCaptureTime, setLastCaptureTime] = useState('')
  const [isCaptureFlashVisible, setIsCaptureFlashVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [liveDetections, setLiveDetections] = useState([])

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
    setStatusMessage('Frame captured. Saving photo to your account...')

    try {
      const captureId = createScanCaptureId()
      const uid = String(user?.uid || '').trim()
      const base64Image = captureFrameAsDataUrl(videoRef.current)
      let persistedCapture = { captureId, persisted: false, downloadURL: null, storagePath: null }

      if (uid) {
        try {
          persistedCapture = await persistUserScanCapture({
            uid,
            captureId,
            base64Image,
            capturedAt: capturedAt.toISOString(),
            source: 'camera',
            userPrompt: 'I just took this photo. Please analyze it and tell me what to do next.',
          })
        } catch (captureError) {
          console.warn('Failed to persist scanner capture:', captureError)
        }
      }

      savePendingCapture({
        source: 'camera',
        captureId,
        base64Image,
        capturedAt: capturedAt.toISOString(),
        userPrompt: 'I just took this photo. Please analyze it and tell me what to do next.',
        ownerUid: uid || null,
        captureDownloadURL: persistedCapture.downloadURL || null,
        captureStoragePath: persistedCapture.storagePath || null,
        capturePersisted: Boolean(persistedCapture.persisted),
      })

      setStatusMessage('Photo saved. Opening PadiGuard AI Assistant...')
      navigate(`/app/chatbot?fromScan=1&captureId=${encodeURIComponent(captureId)}`)
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
            disabled={isSubmitting}
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
          disabled={isSubmitting}
          aria-label="Capture crop photo"
        />
      </footer>
    </section>
  )
}
