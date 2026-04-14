import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconList, IconSparkles } from '../../components/icons/UiIcons'
import { useScanHistory } from '../../hooks/useScanHistory'

const STORAGE_KEY = 'pg_chatbot_conversations_v1'

const WELCOME_MESSAGE = {
  role: 'ai',
  text: 'Hello. I am your PadiGuard AI assistant. Ask about disease risk, treatment cost, or recent scan records.',
}

const QUICK_PROMPTS = [
  'Show my recent scan history',
  'What should I spray this week?',
  'Estimate treatment ROI from latest scan',
]

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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

function formatConversationTime(value) {
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildAssistantReply(prompt, reports) {
  const normalized = prompt.toLowerCase()
  const asksHistory = normalized.includes('history') || normalized.includes('scan') || normalized.includes('report')
  const asksTreatment = normalized.includes('treat') || normalized.includes('spray') || normalized.includes('cost')

  if (asksHistory) {
    if (reports.length === 0) {
      return 'No scan history is available yet. Capture a leaf scan and I will summarize risk and next action.'
    }

    const latest = reports[0]
    return `Latest scan: ${latest?.disease || 'Unknown issue'} at ${Number(latest?.severity || 0)}% severity with ${Number(latest?.confidence || 0)}% confidence. I can break down treatment options when you are ready.`
  }

  if (asksTreatment) {
    if (reports.length === 0) {
      return 'I need at least one scan result before recommending a treatment plan. Please run the scanner first.'
    }

    const latest = reports[0]
    const severity = Number(latest?.severity || 0)
    if (severity >= 60) {
      return 'Risk is high. Prioritize treatment within 24 hours, check wind and rain windows, and verify stock before field application.'
    }

    if (severity >= 30) {
      return 'Risk is moderate. Monitor for 24 to 48 hours, prepare spray inventory, and target calm weather for application timing.'
    }

    return 'Risk is low. Continue monitoring, avoid unnecessary chemical use, and log the next scan for trend tracking.'
  }

  return 'Request received. I can help with disease summary, scan trend interpretation, and treatment planning with inventory awareness.'
}

export default function Chatbot() {
  const navigate = useNavigate()
  const { reports, timelineItems, isLoading, error } = useScanHistory()
  const [conversationHistory, setConversationHistory] = useState(loadStoredConversations)
  const [activeConversationId, setActiveConversationId] = useState(createConversationId)
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const threadRef = useRef(null)

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

  const handleSend = (rawText = input) => {
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

    window.setTimeout(() => {
      const aiResponse = { role: 'ai', text: buildAssistantReply(trimmed, reports) }
      setMessages((prev) => {
        const next = [...prev, aiResponse]
        persistConversation(conversationId, next)
        return next
      })
      setIsThinking(false)
    }, 900)
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
