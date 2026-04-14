import { useRef, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import { IconSend, IconSprout } from '../../components/icons/UiIcons'
import { useScanHistory } from '../../hooks/useScanHistory'

const WELCOME_MESSAGE = {
  role: 'ai',
  text: 'Hello! I\'m your PadiGuard AI assistant. Ask me about rice diseases, treatment plans, or your scan history. How can I help you today?',
}

export default function Chatbot() {
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const threadRef = useRef(null)
  const { reports } = useScanHistory()

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

    // Check for history-related queries
    const lowerInput = trimmed.toLowerCase()
    const isHistoryQuery = lowerInput.includes('history') || lowerInput.includes('scan') || lowerInput.includes('report')

    window.setTimeout(() => {
      let aiText

      if (isHistoryQuery && reports.length > 0) {
        const latest = reports[0]
        aiText = `Based on your scan history, your latest scan detected **${latest?.disease || 'no issues'}** with a severity of ${Number(latest?.severity || 0)}% and ${Number(latest?.confidence || 0)}% confidence. You have ${reports.length} scan(s) on record. Would you like me to suggest a treatment plan?`
      } else if (isHistoryQuery && reports.length === 0) {
        aiText = 'You don\'t have any scan history yet. Use the scanner to capture a leaf photo and I\'ll help diagnose any issues.'
      } else {
        aiText = 'Thank you for your question. Our swarm diagnosis pipeline is processing your request. This feature will be fully connected to the backend AI agents soon. In the meantime, try asking about your scan history or disease treatments.'
      }

      const aiResponse = { role: 'ai', text: aiText }
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

  const quickPrompts = [
    'Show my scan history',
    'What disease was detected?',
    'Suggest a treatment plan',
  ]

  const handleQuickPrompt = (prompt) => {
    setInput(prompt)
  }

  return (
    <section className="pg-page pg-scanner-chat-page" aria-label="AI Chatbot">
      <SectionHeader
        title="AI Assistant"
        align="center"
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <div className="pg-chat-thread" ref={threadRef}>
        {messages.map((msg, index) => (
          <div
            key={`msg-${index}`}
            className={`pg-chat-message ${msg.role === 'ai' ? 'is-ai' : 'is-user'}`}
          >
            {msg.role === 'ai' ? (
              <div className="pg-chat-avatar" aria-hidden="true">
                <IconSprout className="pg-icon" />
              </div>
            ) : null}
            <div className="pg-chat-bubble">
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {isThinking ? (
          <div className="pg-chat-message is-ai">
            <div className="pg-chat-avatar" aria-hidden="true">
              <IconSprout className="pg-icon" />
            </div>
            <div className="pg-chat-bubble">
              <div className="pg-chat-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        ) : null}

        {messages.length <= 1 ? (
          <div className="pg-chat-quick-prompts">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="pg-chat-quick-btn"
                onClick={() => handleQuickPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
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
