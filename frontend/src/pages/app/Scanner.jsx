import { useEffect, useRef, useState } from 'react'
import { IconImage, IconSend } from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import { scanDisease } from '../../api/scan'
import { useGrids } from '../../hooks/useGrids'
import { useScanReports } from '../../hooks/useScanReports'

export default function Scanner() {
  const [chatMessages, setChatMessages] = useState([
    {
      id: 1,
      role: 'ai',
      text: 'Take a photo or ask about your crops.',
    },
  ])
  const [messageInput, setMessageInput] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [selectedGridDocId, setSelectedGridDocId] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const fileInputRef = useRef(null)
  const chatScrollRef = useRef(null)
  const { grids } = useGrids()
  const { saveScanReport, isFirebaseConfigured } = useScanReports()

  useEffect(() => {
    if (!selectedGridDocId && grids.length > 0) {
      setSelectedGridDocId(grids[0].id)
    }
  }, [grids, selectedGridDocId])

  useEffect(() => {
    if (!chatScrollRef.current) {
      return
    }
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [chatMessages, isScanning, selectedImage])

  useEffect(() => {
    return () => {
      if (selectedImage?.previewUrl) {
        URL.revokeObjectURL(selectedImage.previewUrl)
      }
    }
  }, [selectedImage])

  const onSelectImage = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (selectedImage?.previewUrl) {
      URL.revokeObjectURL(selectedImage.previewUrl)
    }

    const previewUrl = URL.createObjectURL(file)
    setSelectedImage({ file, previewUrl, name: file.name || 'photo' })
    event.target.value = ''
  }

  const onSendMessage = async () => {
    const textValue = messageInput.trim()
    if (!textValue && !selectedImage) {
      return
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: textValue,
      imageUrl: selectedImage?.previewUrl || null,
      imageName: selectedImage?.name || null,
    }
    setChatMessages((current) => [...current, userMessage])
    setMessageInput('')

    if (!selectedImage) {
      setChatMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: 'ai',
          text: 'Please attach a leaf photo so I can check disease signs.',
        },
      ])
      return
    }

    setIsScanning(true)
    const selectedGrid = grids.find((item) => item.id === selectedGridDocId)
    const result = await scanDisease({
      source: 'camera',
      gridId: selectedGrid?.gridId || null,
    })

    const status = Number(result.severity || 0) >= 50 ? 'abnormal' : 'normal'

    if (isFirebaseConfigured) {
      try {
        await saveScanReport({
          ...result,
          gridId: selectedGrid?.gridId || null,
          status,
          source: 'camera',
        })
        setSyncStatus(selectedGrid?.gridId
          ? `Scan linked to ${selectedGrid.gridId} and synced.`
          : 'Scan synced without grid link.')
      } catch (syncError) {
        setSyncStatus(syncError.message || 'Scan saved locally, but sync failed.')
      }
    } else {
      setSyncStatus('Firebase not configured yet. Scan report not synced.')
    }

    setChatMessages((current) => [
      ...current,
      {
        id: Date.now() + 2,
        role: 'ai',
        text: `${result.disease} detected${selectedGrid?.gridId ? ` for ${selectedGrid.gridId}` : ''}. Severity is around ${result.severity}% with ${result.confidence}% match confidence.`,
      },
    ])
    setSelectedImage(null)
    setIsScanning(false)
  }

  return (
    <section className="pg-scanner-chat-page" aria-label="Crop scanner chat">
      <SectionHeader title="Chat Agent" align="center" />
      <div className="pg-chat-thread" ref={chatScrollRef}>
        {chatMessages.map((message) => (
          <article
            key={message.id}
            className={`pg-chat-message ${message.role === 'user' ? 'is-user' : 'is-ai'}`}
          >
            {message.imageUrl ? (
              <div className="pg-chat-image-wrap">
                <img src={message.imageUrl} alt={message.imageName || 'Selected crop photo'} className="pg-chat-image" />
              </div>
            ) : null}
            {message.text ? <p>{message.text}</p> : null}
          </article>
        ))}
        {isScanning ? (
          <article className="pg-chat-message is-ai">
            <p>Checking your leaf photo…</p>
          </article>
        ) : null}
      </div>

      <div className="pg-chat-input-shell">
        <div className="pg-chat-grid-picker">
          <label htmlFor="gridPicker">Active grid</label>
          <select
            id="gridPicker"
            value={selectedGridDocId}
            onChange={(event) => setSelectedGridDocId(event.target.value)}
            disabled={grids.length === 0}
          >
            {grids.length === 0 ? <option value="">No grids yet</option> : null}
            {grids.map((grid) => (
              <option key={grid.id} value={grid.id}>
                {grid.gridId || grid.id} - {grid.healthState || 'Healthy'}
              </option>
            ))}
          </select>
          {syncStatus ? <small>{syncStatus}</small> : null}
        </div>

        {selectedImage ? (
          <div className="pg-chat-selected-image">
            <img src={selectedImage.previewUrl} alt="Selected leaf preview" className="pg-chat-selected-thumb" />
            <p>{selectedImage.name}</p>
            <button
              type="button"
              className="pg-chat-clear-image"
              onClick={() => {
                if (selectedImage.previewUrl) {
                  URL.revokeObjectURL(selectedImage.previewUrl)
                }
                setSelectedImage(null)
              }}
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="pg-chat-input-bar">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="pg-chat-file-input"
            onChange={onSelectImage}
          />
          <button
            type="button"
            className="pg-chat-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Take or upload photo"
          >
            <IconImage className="pg-icon" />
          </button>
          <input
            className="pg-chat-text-input"
            placeholder="Ask about your crop or send a photo"
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSendMessage()
              }
            }}
          />
          <button
            type="button"
            className="pg-chat-send-btn"
            onClick={onSendMessage}
            disabled={isScanning || (!messageInput.trim() && !selectedImage)}
            aria-label="Send message"
          >
            <IconSend className="pg-icon" />
          </button>
        </div>
      </div>
    </section>
  )
}
