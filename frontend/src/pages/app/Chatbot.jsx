import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { IconArrowLeft, IconImage, IconList, IconSparkles } from '../../components/icons/UiIcons'
import { scanAndAskAssistant } from '../../api/scan'
import { sendAssistantMessage } from '../../api/assistant'
import { db, isFirebaseConfigured } from '../../firebase'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useScanReports } from '../../hooks/useScanReports'
import { useSessionContext } from '../../hooks/useSessionContext'

const STORAGE_KEY = 'pg_chatbot_conversations_v1'
const PENDING_CAPTURE_KEY = 'pg_pending_scan_capture_v1'
const USERS_COLLECTION = 'users'
const CONVERSATION_COLLECTION = 'conversations'

const WELCOME_MESSAGE = {
  role: 'ai',
  text: 'Hello. I am your PadiGuard AI assistant. Ask about disease risk, treatment cost, or recent scan records.',
}

const QUICK_PROMPTS = [
  'Show my recent scan history',
  'What should I spray this week?',
  'Estimate treatment ROI from latest scan',
]

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function hasAllowedPhotoExtension(filename) {
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(String(filename || ''))
}

function isPhotoFile(file) {
  if (!file) {
    return false
  }

  const mime = String(file.type || '').toLowerCase()
  if (mime && ALLOWED_IMAGE_MIME.has(mime)) {
    return true
  }

  if (!mime) {
    return hasAllowedPhotoExtension(file.name)
  }

  return false
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read selected photo.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to decode selected photo.'))
    image.src = dataUrl
  })
}

async function fileToUploadDataUrl(file) {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const maxSide = 1280
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1))
  const width = Math.max(1, Math.round((image.width || 1) * scale))
  const height = Math.max(1, Math.round((image.height || 1) * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to process selected photo.')
  }

  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.86)
}

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeMessage(raw) {
  const role = raw?.role === 'user' ? 'user' : 'ai'
  const text = String(raw?.text || '').trim()
  if (!text) {
    return null
  }

  return { role, text }
}

function normalizeConversationRecord(id, raw) {
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean)
    : []

  if (messages.length === 0) {
    return null
  }

  const firstUserMessage = messages.find((message) => message.role === 'user')
  return {
    id: String(id),
    title: String(raw?.title || firstUserMessage?.text?.slice(0, 56) || 'Conversation'),
    updatedAt: toMillis(raw?.clientUpdatedAt || raw?.updatedAt || raw?.createdAt) || Date.now(),
    messages,
  }
}

function mergeConversationLists(primary, secondary) {
  const byId = new Map()
  const combinedEntries = [...(primary || []), ...(secondary || [])]

  combinedEntries.forEach((entry) => {
    const normalized = normalizeConversationRecord(entry?.id, entry)
    if (!normalized) {
      return
    }

    const existing = byId.get(normalized.id)
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      byId.set(normalized.id, normalized)
    }
  })

  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 24)
}

function areConversationListsEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]
    const b = right[i]

    if (!a || !b) {
      return false
    }

    if (a.id !== b.id || a.title !== b.title || a.updatedAt !== b.updatedAt) {
      return false
    }

    if (!Array.isArray(a.messages) || !Array.isArray(b.messages) || a.messages.length !== b.messages.length) {
      return false
    }

    for (let j = 0; j < a.messages.length; j += 1) {
      if (a.messages[j]?.role !== b.messages[j]?.role || a.messages[j]?.text !== b.messages[j]?.text) {
        return false
      }
    }
  }

  return true
}

function loadStoredConversations() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredConversations(conversations) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  } catch {
    // Ignore write failures in private or constrained storage environments.
  }
}

function loadPendingCapture() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_CAPTURE_KEY)
    if (!raw) {
      return null
    }

    const payload = JSON.parse(raw)
    if (!payload?.base64Image) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

function clearPendingCapture() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(PENDING_CAPTURE_KEY)
  } catch {
    // Ignore storage cleanup failure.
  }
}

function normalizeScanStatus(result) {
  return Number(result?.severity || 0) >= 40 ? 'abnormal' : 'normal'
}

function formatConversationTime(value) {
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function Chatbot() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useSessionContext()
  const { reports, timelineItems, isLoading, error } = useScanHistory()
  const { saveScanReport } = useScanReports()
  const [conversationHistory, setConversationHistory] = useState(loadStoredConversations)
  const [activeConversationId, setActiveConversationId] = useState(createConversationId)
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [isAutoProcessing, setIsAutoProcessing] = useState(false)
  const threadRef = useRef(null)
  const photoInputRef = useRef(null)
  const autoScanTriggeredRef = useRef(false)
  const migratedConversationUsersRef = useRef(new Set())

  const migrateLegacyConversationsForUser = useCallback(async (uid) => {
    if (!uid || !db || !isFirebaseConfigured || migratedConversationUsersRef.current.has(uid)) {
      return
    }

    const legacyRootCollection = collection(db, CONVERSATION_COLLECTION)
    const docsById = new Map()
    const ownerFields = ['ownerUid', 'userId', 'uid']

    for (const fieldName of ownerFields) {
      const snapshot = await getDocs(query(legacyRootCollection, where(fieldName, '==', uid)))
      snapshot.docs.forEach((item) => {
        docsById.set(item.id, item)
      })
    }

    if (docsById.size === 0) {
      migratedConversationUsersRef.current.add(uid)
      return
    }

    await Promise.all(
      [...docsById.values()].map(async (legacyDoc) => {
        const normalized = normalizeConversationRecord(legacyDoc.id, legacyDoc.data() || {})
        if (normalized) {
          await setDoc(
            doc(db, USERS_COLLECTION, uid, CONVERSATION_COLLECTION, normalized.id),
            {
              id: normalized.id,
              ownerUid: uid,
              title: normalized.title,
              messages: normalized.messages,
              clientUpdatedAt: normalized.updatedAt,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        }

        await deleteDoc(legacyDoc.ref)
      }),
    )

    migratedConversationUsersRef.current.add(uid)
  }, [])

  const firstSeverity = Number(reports[0]?.severity || 0)
  const lastSeverity = Number(reports[reports.length - 1]?.severity || 0)
  const trendDelta = reports.length > 1 ? firstSeverity - lastSeverity : 0

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight
      }
    })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isThinking])

  useEffect(() => {
    saveStoredConversations(conversationHistory)
  }, [conversationHistory])

  useEffect(() => {
    const uid = String(user?.uid || '').trim()
    if (!uid || !db || !isFirebaseConfigured) {
      return undefined
    }

    let unsubscribe = () => {}
    let cancelled = false

    const connectConversationStream = async () => {
      try {
        await migrateLegacyConversationsForUser(uid)
      } catch (migrationError) {
        console.warn('Legacy conversation migration skipped:', migrationError)
      }

      if (cancelled) {
        return
      }

      const conversationsRef = collection(db, USERS_COLLECTION, uid, CONVERSATION_COLLECTION)
      unsubscribe = onSnapshot(
        conversationsRef,
        (snapshot) => {
          const remoteEntries = snapshot.docs
            .map((item) => normalizeConversationRecord(item.id, item.data() || {}))
            .filter(Boolean)

          setConversationHistory((prev) => {
            const merged = mergeConversationLists(prev, remoteEntries)
            return areConversationListsEqual(prev, merged) ? prev : merged
          })
        },
        () => {
          // Keep local chat UX even if remote conversation sync fails.
        },
      )
    }

    connectConversationStream()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [migrateLegacyConversationsForUser, user?.uid])

  useEffect(() => {
    const uid = String(user?.uid || '').trim()
    if (!uid || !db || !isFirebaseConfigured || conversationHistory.length === 0) {
      return
    }

    const safeEntries = conversationHistory
      .map((entry) => normalizeConversationRecord(entry?.id, entry))
      .filter(Boolean)

    if (safeEntries.length === 0) {
      return
    }

    const persist = async () => {
      try {
        await Promise.all(
          safeEntries.map((entry) =>
            setDoc(
              doc(db, USERS_COLLECTION, uid, CONVERSATION_COLLECTION, entry.id),
              {
                id: entry.id,
                ownerUid: uid,
                title: entry.title,
                messages: entry.messages,
                clientUpdatedAt: entry.updatedAt,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            ),
          ),
        )
      } catch {
        // Keep local chat UX even if remote conversation sync fails.
      }
    }

    persist()
  }, [conversationHistory, user?.uid])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const fromScan = params.get('fromScan') === '1'
    if (!fromScan || isAutoProcessing || isThinking) {
      return
    }

    if (autoScanTriggeredRef.current) {
      return
    }

    const pendingCapture = loadPendingCapture()
    if (!pendingCapture?.base64Image) {
      autoScanTriggeredRef.current = true
      navigate('/app/chatbot', { replace: true })
      return
    }

    autoScanTriggeredRef.current = true

    const conversationId = activeConversationId || createConversationId()
    if (activeConversationId !== conversationId) {
      setActiveConversationId(conversationId)
    }

    const userText = pendingCapture.userPrompt || 'I just captured this crop photo. Please diagnose and advise.'
    const userMessage = { role: 'user', text: userText }

    setMessages((prev) => {
      const next = [...prev, userMessage]
      persistConversation(conversationId, next)
      return next
    })

    setIsAutoProcessing(true)
    setIsThinking(true)
    navigate('/app/chatbot', { replace: true })

    scanAndAskAssistant({
      source: pendingCapture.source || 'camera',
      gridId: pendingCapture.gridId || null,
      base64Image: pendingCapture.base64Image,
      userPrompt: userText,
    })
      .then(async (response) => {
        try {
          await saveScanReport({
            ...response,
            source: pendingCapture.source || 'camera',
            status: normalizeScanStatus(response),
          })
        } catch {
          // Keep chat flow smooth even when persistence fails.
        }

        const diagnosisLine = `Diagnosis: ${response.disease} | Severity ${response.severity}% | Confidence ${response.confidence}% | Risk ${response.spread_risk}.`
        const assistantText = `${response.assistant_reply}\n\n${diagnosisLine}`

        const aiMessage = { role: 'ai', text: assistantText }
        setMessages((prev) => {
          const next = [...prev, aiMessage]
          persistConversation(conversationId, next)
          return next
        })
      })
      .catch((scanError) => {
        const aiMessage = {
          role: 'ai',
          text: scanError?.message || 'I could not process that photo right now. Please capture again and retry.',
        }
        setMessages((prev) => {
          const next = [...prev, aiMessage]
          persistConversation(conversationId, next)
          return next
        })
      })
      .finally(() => {
        clearPendingCapture()
        setIsAutoProcessing(false)
        setIsThinking(false)
      })
  }, [
    activeConversationId,
    isAutoProcessing,
    isThinking,
    location.search,
    navigate,
    saveScanReport,
  ])

  const persistConversation = (conversationId, nextMessages) => {
    const firstUserMessage = nextMessages.find((message) => message.role === 'user')
    if (!firstUserMessage) {
      return
    }

    const nextEntry = {
      id: conversationId,
      title: firstUserMessage.text.slice(0, 56),
      updatedAt: Date.now(),
      messages: nextMessages,
    }

    setConversationHistory((prev) => [
      nextEntry,
      ...prev.filter((item) => item.id !== conversationId),
    ].slice(0, 24))
  }

  const handleSend = async (rawText = input) => {
    const trimmed = rawText.trim()
    if (!trimmed || isThinking) {
      return
    }

    const conversationId = activeConversationId || createConversationId()
    if (activeConversationId !== conversationId) {
      setActiveConversationId(conversationId)
    }

    const userMessage = { role: 'user', text: trimmed }
    setMessages((prev) => {
      const next = [...prev, userMessage]
      persistConversation(conversationId, next)
      return next
    })
    setInput('')
    setIsThinking(true)

    try {
      const response = await sendAssistantMessage({
        userPrompt: trimmed,
        userId: String(user?.uid || '').trim(),
        zone: reports[0]?.gridId || reports[0]?.zone || null,
      })

      const assistantText = String(response?.assistant_reply || '').trim() || 'No assistant response received.'
      appendAssistantMessage(conversationId, assistantText)
    } catch (messageError) {
      appendAssistantMessage(
        conversationId,
        messageError?.message || 'I could not process your request right now. Please try again.',
      )
    } finally {
      setIsThinking(false)
    }
  }

  const appendAssistantMessage = (conversationId, text) => {
    const aiMessage = { role: 'ai', text }
    setMessages((prev) => {
      const next = [...prev, aiMessage]
      persistConversation(conversationId, next)
      return next
    })
  }

  const handlePhotoUpload = async (file) => {
    if (!file || isThinking) {
      return
    }

    const conversationId = activeConversationId || createConversationId()
    if (activeConversationId !== conversationId) {
      setActiveConversationId(conversationId)
    }

    if (!isPhotoFile(file)) {
      appendAssistantMessage(conversationId, '仅支持照片格式上传（JPG、PNG、WEBP、HEIC、HEIF）。')
      if (photoInputRef.current) {
        photoInputRef.current.value = ''
      }
      return
    }

    if (Number(file.size || 0) > MAX_UPLOAD_BYTES) {
      appendAssistantMessage(conversationId, '照片体积过大，请上传 12MB 以内的图片。')
      if (photoInputRef.current) {
        photoInputRef.current.value = ''
      }
      return
    }

    const userPrompt = '我刚上传了一张作物照片，请告诉我这是什么问题，并给出治疗方案。'
    const userMessage = {
      role: 'user',
      text: `已上传照片：${file.name}`,
    }

    setMessages((prev) => {
      const next = [...prev, userMessage]
      persistConversation(conversationId, next)
      return next
    })

    setIsThinking(true)

    try {
      const base64Image = await fileToUploadDataUrl(file)
      const response = await scanAndAskAssistant({
        source: 'upload',
        base64Image,
        userPrompt,
      })

      try {
        await saveScanReport({
          ...response,
          source: 'upload',
          status: normalizeScanStatus(response),
        })
      } catch {
        // Keep chat response flow even if report persistence fails.
      }

      const diagnosisLine = `Diagnosis: ${response.disease} | Severity ${response.severity}% | Confidence ${response.confidence}% | Risk ${response.spread_risk}.`
      appendAssistantMessage(conversationId, `${response.assistant_reply}\n\n${diagnosisLine}`)
    } catch (uploadError) {
      appendAssistantMessage(
        conversationId,
        uploadError?.message || '照片分析失败，请稍后重试。',
      )
    } finally {
      setIsThinking(false)
      if (photoInputRef.current) {
        photoInputRef.current.value = ''
      }
    }
  }

  const handlePhotoInputChange = (event) => {
    const file = event.target?.files?.[0]
    if (!file) {
      return
    }

    handlePhotoUpload(file)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleQuickPrompt = (prompt, submit = false) => {
    if (submit) {
      handleSend(prompt)
      return
    }

    setInput(prompt)
  }

  const handleNewChat = () => {
    setActiveConversationId(createConversationId())
    setMessages([WELCOME_MESSAGE])
    setInput('')
    setIsThinking(false)
    setIsHistoryOpen(false)
  }

  const handleSelectConversation = (conversation) => {
    setActiveConversationId(conversation.id)
    setMessages(conversation.messages)
    setInput('')
    setIsThinking(false)
    setIsHistoryOpen(false)
  }

  return (
    <section className="pg-chatbot-page" aria-label="AI chatbot">
      {isHistoryOpen ? (
        <button
          type="button"
          className="pg-chatbot-history-backdrop"
          aria-label="Close history panel"
          onClick={() => setIsHistoryOpen(false)}
        />
      ) : null}

      <aside className={`pg-chatbot-history-panel ${isHistoryOpen ? 'is-open' : ''}`} aria-label="Chat history panel">
        <div className="pg-chatbot-history-head">
          <h2>Chat History</h2>
          <button
            type="button"
            className="pg-chatbot-history-close"
            onClick={() => setIsHistoryOpen(false)}
          >
            Close
          </button>
        </div>

        <button type="button" className="pg-chatbot-gemini-btn" onClick={handleNewChat}>
          <IconSparkles className="pg-icon" />
          <span>New AI Chat</span>
        </button>

        <div className="pg-chatbot-conversation-list" aria-live="polite">
          {conversationHistory.length === 0 ? (
            <p className="pg-chatbot-history-empty">No previous conversations yet.</p>
          ) : (
            conversationHistory.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`pg-chatbot-history-item ${conversation.id === activeConversationId ? 'is-active' : ''}`}
                onClick={() => handleSelectConversation(conversation)}
              >
                <strong>{conversation.title || 'Conversation'}</strong>
                <span>{formatConversationTime(conversation.updatedAt)}</span>
                <small>{conversation.messages[conversation.messages.length - 1]?.text || 'No messages'}</small>
              </button>
            ))
          )}
        </div>

        <article className="pg-chatbot-history-summary">
          <h3>Field Scan History</h3>
          <p>
            {isLoading
              ? 'Loading scan history...'
              : reports.length <= 1
                ? 'Capture at least two scans to track trend movement.'
                : `Severity changed by ${Math.abs(trendDelta)}% across recent records.`}
          </p>
          {error ? <small>{error}</small> : null}
        </article>

        <div className="pg-chatbot-history-list" aria-live="polite">
          {timelineItems.length === 0 ? (
            <p className="pg-chatbot-history-empty">No history entries yet.</p>
          ) : (
            timelineItems.slice(0, 14).map((item) => (
              <button
                key={item.id}
                type="button"
                className="pg-chatbot-history-item"
                onClick={() => handleQuickPrompt(`Explain this scan: ${item.title}. ${item.detail}`, true)}
              >
                <strong>{item.title}</strong>
                <span>{item.date}</span>
                <small>{item.detail}</small>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="pg-chatbot-main">
        <header className="pg-chatbot-toolbar">
          <div className="pg-chatbot-toolbar-left">
            <button
              type="button"
              className="pg-chatbot-toolbar-btn"
              aria-label="Back to scanner"
              onClick={() => navigate('/app/scan')}
            >
              <IconArrowLeft className="pg-icon" />
            </button>

            <button
              type="button"
              className="pg-chatbot-toolbar-btn"
              aria-label="Toggle chat history"
              aria-expanded={isHistoryOpen}
              onClick={() => setIsHistoryOpen((prev) => !prev)}
            >
              <IconList className="pg-icon" />
            </button>
          </div>

          <p className="pg-chatbot-toolbar-title">PadiGuard AI Assistant</p>

          <button type="button" className="pg-chatbot-toolbar-gemini" onClick={handleNewChat}>
            <IconSparkles className="pg-icon" />
          </button>
        </header>

        <div className="pg-chatbot-thread" ref={threadRef}>
          {messages.map((message, index) => (
            <article
              key={`chat-msg-${index}`}
              className={`pg-chatbot-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
            >
              <p className="pg-chatbot-message-role">{message.role === 'user' ? 'You' : 'Assistant'}</p>
              <div className="pg-chatbot-message-bubble">
                <p>{message.text}</p>
              </div>
            </article>
          ))}

          {isThinking ? (
            <article className="pg-chatbot-message is-assistant">
              <p className="pg-chatbot-message-role">Assistant</p>
              <div className="pg-chatbot-message-bubble">
                <div className="pg-chatbot-typing" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ) : null}

          {messages.length <= 1 ? (
            <div className="pg-chatbot-quick-row">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="pg-chatbot-quick-btn"
                  onClick={() => handleQuickPrompt(prompt, true)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="pg-chatbot-composer-wrap">
          <div className="pg-chatbot-composer">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="pg-chatbot-photo-input"
              onChange={handlePhotoInputChange}
              aria-label="Upload crop photo"
            />
            <button
              type="button"
              className="pg-chatbot-upload-btn"
              onClick={() => photoInputRef.current?.click()}
              disabled={isThinking}
              aria-label="Upload photo"
              title="Upload photo"
            >
              <IconImage className="pg-icon" />
            </button>
            <input
              type="text"
              className="pg-chatbot-input"
              placeholder="Message PadiGuard AI"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Type your message"
            />
            <button
              type="button"
              className="pg-chatbot-send-btn"
              onClick={() => handleSend()}
              disabled={!input.trim() || isThinking}
              aria-label="Send message"
            >
              <IconSparkles className="pg-icon" />
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}
