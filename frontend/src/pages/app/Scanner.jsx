import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconSparkles } from '../../components/icons/UiIcons'

const PENDING_CAPTURE_KEY = 'pg_pending_scan_capture_v1'

function formatCaptureTime(date) {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function captureFrameAsDataUrl(videoElement) {
  const rawWidth = videoElement.videoWidth || 1280
  const rawHeight = videoElement.videoHeight || 720
  const maxWidth = 960
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
  return canvas.toDataURL('image/jpeg', 0.85)
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
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraState, setCameraState] = useState('loading')
  const [statusMessage, setStatusMessage] = useState('Initializing rear camera...')
  const [lastCaptureTime, setLastCaptureTime] = useState('')
  const [isCaptureFlashVisible, setIsCaptureFlashVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
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
            setStatusMessage('Camera ready. Hold leaf inside guide frame.')
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
      isMounted = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

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
      const base64Image = captureFrameAsDataUrl(videoRef.current)
      savePendingCapture({
        source: 'camera',
        base64Image,
        capturedAt: capturedAt.toISOString(),
        userPrompt: 'I just took this photo. Please analyze it and tell me what to do next.',
      })

      navigate('/app/chatbot?fromScan=1')
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
        <div className="pg-scanner-viewfinder-frame" />
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
