import { useRef, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import { IconSend } from '../../components/icons/UiIcons'

const WELCOME_MESSAGE = {
  role: 'ai',
  text: 'Hello! I\'m your PadiGuard AI assistant. Ask me anything about rice diseases, treatment plans, or farming best practices.',
}

export default function Chatbot() {
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const threadRef = useRef(null)

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight
      }
    })
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isThinking) {
      return
    }

    const userMessage = { role: 'user', text: trimmed }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsThinking(true)
    scrollToBottom()

    // Simulate AI response
    window.setTimeout(() => {
      const aiResponse = {
        role: 'ai',
        text: 'Thank you for your question. Our swarm diagnosis pipeline is processing your request. This feature will be fully connected to the backend AI agents soon.',
      }
      setMessages((prev) => [...prev, aiResponse])
      setIsThinking(false)
      scrollToBottom()
    }, 1200)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="pg-page pg-scanner-chat-page" aria-label="AI Chatbot">
      <SectionHeader
        title="AI Assistant"
        align="left"
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <div className="pg-chat-thread" ref={threadRef}>
        {messages.map((msg, index) => (
          <div
            key={`msg-${index}`}
            className={`pg-chat-message ${msg.role === 'ai' ? 'is-ai' : 'is-user'}`}
          >
            <p>{msg.text}</p>
          </div>
        ))}
        {isThinking ? (
          <div className="pg-chat-message is-ai">
            <p>Thinking…</p>
          </div>
        ) : null}
      </div>

      <div className="pg-chat-input-shell">
        <div className="pg-chat-input-bar">
          <input
            type="text"
            className="pg-chat-text-input"
            placeholder="Ask about rice diseases, treatments..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Type your message"
          />
          <button
            type="button"
            className="pg-chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            aria-label="Send message"
          >
            <IconSend className="pg-icon" />
          </button>
        </div>
      </div>
    </section>
  )
}
