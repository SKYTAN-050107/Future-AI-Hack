import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconSparkles } from '../../components/icons/UiIcons'

const PENDING_CAPTURE_KEY = 'pg_pending_scan_capture_v1'
const DEFAULT_BACKEND_URL = 'http://localhost:8000'
const BACKEND_URL = String(import.meta.env.VITE_DIAGNOSIS_API_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')
const WS_SCAN_URL = `${BACKEND_URL.replace(/^http/i, 'ws')}/ws/scan`
const LIVE_FRAME_INTERVAL_MS = 900
const LIVE_RESPONSE_TIMEOUT_MS = 9000
const LIVE_FRAME_CAPTURE_OPTIONS = { maxWidth: 960, quality: 0.82 }
const CHAT_CAPTURE_OPTIONS = { maxWidth: 1280, quality: 0.86 }
const PEST_KEYWORDS = ['pest', 'mite', 'insect', 'worm', 'larva', 'hopper', 'bug', 'weevil', 'aphid', 'borer', 'thrip', 'slug', 'snail']

function formatCaptureTime(date) {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
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
    return false
  }

  try {
    window.sessionStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(payload))
    return true
  } catch {
    // Let caller use a fallback transport when storage is constrained.
    return false
  }
}

function isPestDetection(detection) {
  const cropType = String(detection?.cropType || '').toLowerCase()
  const disease = String(detection?.disease || '').toLowerCase()
  if (cropType.includes('pest')) {
    return true
  }
  return PEST_KEYWORDS.some((keyword) => disease.includes(keyword))
}

function isMeaningfulDetection(detection) {
  const cropType = String(detection?.cropType || '').trim().toLowerCase()
  const disease = String(detection?.disease || '').trim().toLowerCase()
  if (!cropType || cropType === 'unknown') {
    return false
  }
  if (!disease || disease === 'unknown' || disease === 'inconclusive') {
    return false
  }
  return true
}

function summarizeLiveDetections(detections) {
  let pests = 0
  for (const detection of detections) {
    if (isPestDetection(detection)) {
      pests += 1
    }
  }

  return {
    plants: Math.max(0, detections.length - pests),
    pests,
  }
}

export default function Scanner() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)
  const frameTimerRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const responseTimeoutRef = useRef(null)
  const frameCounterRef = useRef(0)
  const requestInFlightRef = useRef(false)
  const isMountedRef = useRef(false)
  const [cameraState, setCameraState] = useState('loading')
  const [statusMessage, setStatusMessage] = useState('Initializing rear camera...')
  const [lastCaptureTime, setLastCaptureTime] = useState('')
  const [isCaptureFlashVisible, setIsCaptureFlashVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [liveDetections, setLiveDetections] = useState([])
  const liveSummary = summarizeLiveDetections(liveDetections)

  const clearResponseTimeout = () => {
    if (responseTimeoutRef.current) {
      window.clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
  }

  const stopLiveLoop = () => {
    if (frameTimerRef.current) {
      window.clearInterval(frameTimerRef.current)
      frameTimerRef.current = null
    }
    clearResponseTimeout()
    requestInFlightRef.current = false
  }

  const closeLiveSocket = () => {
    clearResponseTimeout()
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
      console.log('[WS] sendLiveFrame skipped:', { wsReady: ws?.readyState === WebSocket.OPEN, videoReady: !!video, inFlight: requestInFlightRef.current })
      return
    }

    const hasVideoPixels = Number(video.videoWidth || 0) > 0 && Number(video.videoHeight || 0) > 0
    if (!hasVideoPixels) {
      console.log('[WS] No video pixels yet')
      return
    }

    try {
      const base64Image = captureFrameAsDataUrl(video, LIVE_FRAME_CAPTURE_OPTIONS)
      const normalizedBase64 = base64Image.startsWith('data:') && base64Image.includes(',')
        ? base64Image.split(',', 2)[1]
        : base64Image

      console.log('[WS] Sending frame', frameCounterRef.current + 1, 'base64 length:', normalizedBase64.length)
      clearResponseTimeout()
      requestInFlightRef.current = true
      frameCounterRef.current += 1
      ws.send(
        JSON.stringify({
          frame_number: frameCounterRef.current,
          grid_id: null,
          base64_image: null,
          regions: [
            {
              cropped_image_b64: normalizedBase64,
              bbox: {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                mediapipe_label: 'leaf',
                detection_score: 1,
              },
            },
          ],
        }),
      )

      responseTimeoutRef.current = window.setTimeout(() => {
        responseTimeoutRef.current = null
        requestInFlightRef.current = false
        if (!isMountedRef.current) {
          return
        }
        setStatusMessage('Realtime frame timed out. Reconnecting scanner...')
        closeLiveSocket()
        stopLiveLoop()
        scheduleReconnect()
      }, LIVE_RESPONSE_TIMEOUT_MS)
    } catch (error) {
      clearResponseTimeout()
      requestInFlightRef.current = false
      setStatusMessage(error?.message || 'Live frame capture failed.')
    }
  }

  const connectLiveScan = () => {
    if (!isMountedRef.current || cameraState !== 'ready') {
      console.log('[WS] Connect skipped:', { mounted: isMountedRef.current, cameraReady: cameraState === 'ready' })
      return
    }

    const current = wsRef.current
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      console.log('[WS] Already connected')
      return
    }

    closeLiveSocket()
    stopLiveLoop()

    console.log('[WS] Connecting to', WS_SCAN_URL)
    const ws = new WebSocket(WS_SCAN_URL)
    wsRef.current = ws
    setStatusMessage('Connecting realtime scanner...')

    ws.onopen = () => {
      console.log('[WS] Connected')
      clearResponseTimeout()
      if (!isMountedRef.current) {
        return
      }
      setStatusMessage('Realtime diagnosis active. Hold plants inside camera view.')
      stopLiveLoop()
      frameTimerRef.current = window.setInterval(sendLiveFrame, LIVE_FRAME_INTERVAL_MS)
      sendLiveFrame()
    }

    ws.onmessage = (event) => {
      clearResponseTimeout()
      requestInFlightRef.current = false
      if (!isMountedRef.current) {
        return
      }

      console.log('[WS] Received message:', event.data.substring(0, 200))

      try {
        const payload = JSON.parse(event.data)
        if (payload?.error) {
          console.error('[WS] Error from backend:', payload.error)
          setStatusMessage(String(payload.error))
          return
        }

        console.log('[WS] Parsed payload:', { frame_number: payload?.frame_number, results_count: payload?.results?.length })

        const nextDetections = Array.isArray(payload?.results)
          ? payload.results
              .map((item, index) => {
                const detection = {
                  id: `${payload.frame_number || 0}-${index}`,
                  cropType: String(item?.cropType || 'Unknown'),
                  disease: String(item?.disease || 'Unknown'),
                  severity: String(item?.severity || 'Low'),
                  bbox: item?.bbox || { x: 0, y: 0, width: 0, height: 0 },
                }
                console.log('[WS] Result', index, ':', { cropType: detection.cropType, disease: detection.disease, bbox: detection.bbox })
                return detection
              })
              .filter((item) => {
                const hasSize = Number(item.bbox?.width || 0) > 0 && Number(item.bbox?.height || 0) > 0
                console.log('[WS] Filter size check:', item.id, 'hasSize=', hasSize)
                return hasSize
              })
              .filter((item) => {
                const isMeaningful = isMeaningfulDetection(item)
                console.log('[WS] Filter meaningful check:', item.id, 'isMeaningful=', isMeaningful)
                return isMeaningful
              })
          : []

        console.log('[WS] Final detections:', nextDetections.length)
        setLiveDetections(nextDetections)
        if (nextDetections.length > 0) {
          setStatusMessage(`Detected ${nextDetections.length} region(s) in live frame.`)
        } else {
          setStatusMessage('Realtime diagnosis active. No crop region found in current frame.')
        }
      } catch (e) {
        console.error('[WS] Parse error:', e)
        setStatusMessage('Invalid realtime response from diagnosis backend.')
      }
    }

    ws.onerror = () => {
      console.error('[WS] Connection error')
      clearResponseTimeout()
      requestInFlightRef.current = false
      if (isMountedRef.current) {
        setStatusMessage('Realtime connection error. Reconnecting...')
      }
    }

    ws.onclose = () => {
      console.log('[WS] Connection closed')
      clearResponseTimeout()
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
          // Set up event listeners BEFORE assigning srcObject
          videoRef.current.onloadedmetadata = () => {
            console.log('[Camera] onloadedmetadata fired')
            if (!isMounted) {
              return
            }
            setCameraState('ready')
            setStatusMessage('Camera ready. Starting realtime diagnosis...')
          }

          videoRef.current.onerror = (error) => {
            console.error('[Camera] video element error:', error)
            if (!isMounted) {
              return
            }
            setCameraState('blocked')
            setStatusMessage('Camera error. Please refresh and try again.')
          }

          // Assign stream after event listeners are set
          videoRef.current.srcObject = stream

          // Try to play, with proper error handling
          const playPromise = videoRef.current.play()
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((playError) => {
              console.error('[Camera] play error:', playError?.name, playError?.message)
              if (!isMounted) {
                return
              }
              // Only treat as blocked if it's a permission error
              if (playError?.name === 'NotAllowedError') {
                setCameraState('blocked')
                setStatusMessage('Camera permission denied. Please enable camera access.')
              } else {
                console.log('[Camera] play error ignored (metadata may still load):', playError?.message)
              }
            })
          }
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
    setStatusMessage('Frame captured. Opening PadiGuard AI Assistant...')

    try {
      const base64Image = captureFrameAsDataUrl(videoRef.current, CHAT_CAPTURE_OPTIONS)
      const pendingCapture = {
        source: 'camera',
        base64Image,
        capturedAt: capturedAt.toISOString(),
        userPrompt: 'I just took this photo. Please analyze it and tell me what to do next.',
      }

      const saved = savePendingCapture(pendingCapture)

      if (saved) {
        navigate('/app/chatbot?fromScan=1')
      } else {
        navigate('/app/chatbot?fromScan=1', {
          state: { pendingCapture },
        })
      }
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
                <span className="pg-scanner-bbox-label">{`${detection.disease} • ${detection.severity}`}</span>
              </div>
            )
          })}
        </div>

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
            className="pg-scanner-overlay-btn pg-scanner-chatbot-btn"
            onClick={() => navigate('/app/chatbot')}
            aria-label="Open AI chatbot"
          >
            <IconSparkles className="pg-icon" />
          </button>
        </div>
      </header>

      <div className="pg-scanner-viewfinder" aria-hidden="true">
        <div className="pg-scanner-viewfinder-stack">
          <div className="pg-scanner-viewfinder-frame" />
          <p className={`pg-scanner-viewfinder-hint ${liveSummary.pests > 0 ? 'has-alert' : ''}`}>
            {`In frame: ${liveSummary.plants} plant(s), ${liveSummary.pests} pest(s)`}
          </p>
        </div>
      </div>

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
