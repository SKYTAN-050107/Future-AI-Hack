import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconClock, IconAgent } from '../../components/icons/UiIcons'

function formatCaptureTime(date) {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default function Scanner() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraState, setCameraState] = useState('loading')
  const [statusMessage, setStatusMessage] = useState('Initializing rear camera...')
  const [lastCaptureTime, setLastCaptureTime] = useState('')
  const [isCaptureFlashVisible, setIsCaptureFlashVisible] = useState(false)

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

  const handleCapture = () => {
    if (cameraState !== 'ready') {
      setStatusMessage('Camera is still preparing. Try again in a moment.')
      return
    }

    setIsCaptureFlashVisible(true)
    window.setTimeout(() => {
      setIsCaptureFlashVisible(false)
    }, 110)

    const capturedAt = new Date()
    setLastCaptureTime(formatCaptureTime(capturedAt))
    setStatusMessage('Frame captured. Sending to swarm diagnosis pipeline...')
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
          onClick={() => navigate('/app/history')}
          aria-label="Open scan history"
        >
          <IconClock className="pg-icon" />
        </button>
        <button
          type="button"
          className="pg-scanner-overlay-btn"
          onClick={() => navigate('/app/chatbot')}
          aria-label="Open AI chatbot"
        >
          <IconAgent className="pg-icon" />
        </button>
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
          aria-label="Capture crop photo"
        />
      </footer>
    </section>
  )
}
