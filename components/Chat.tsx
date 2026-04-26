'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  images?: string[] // preview URLs for display
  timestamp: string
}

interface AttachedImage {
  mimeType: string
  data: string   // base64
  preview: string // object URL for display
}

function getTimestamp() {
  return new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function generateId() {
  // crypto.randomUUID is available only in secure contexts (localhost or HTTPS).
  // Provide a safe fallback for insecure origins (e.g., http://192.168.x.x).
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGES = 4

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      resolve(result.split(',')[1])
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Track all created object URLs so we can revoke them all on unmount
  const allObjectUrlsRef = useRef<string[]>([])

  const canSend = !!input.trim() || attachedImages.length > 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Revoke all object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      allObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  function cancelRequest() {
    abortControllerRef.current?.abort()
  }

  async function addImageFiles(files: FileList | File[]) {
    const fileArray = Array.from(files).filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type))
    if (fileArray.length === 0) return
    const remaining = MAX_IMAGES - attachedImages.length
    if (remaining <= 0) return
    const toAdd = fileArray.slice(0, remaining)
    const newImages: AttachedImage[] = await Promise.all(
      toAdd.map(async (file) => {
        const preview = URL.createObjectURL(file)
        allObjectUrlsRef.current.push(preview)
        return { mimeType: file.type, data: await fileToBase64(file), preview }
      })
    )
    setAttachedImages((prev) => [...prev, ...newImages])
  }

  function removeImage(index: number) {
    setAttachedImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && ALLOWED_IMAGE_TYPES.includes(item.type)) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      await addImageFiles(imageFiles)
    }
  }

  async function send() {
    if (!canSend || loading) return
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      images: attachedImages.map((img) => img.preview),
      timestamp: getTimestamp(),
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    const currentAttachments = attachedImages
    setAttachedImages([])
    setLoading(true)
    setError(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          attachments: currentAttachments.length > 0
            ? currentAttachments.map(({ mimeType, data }) => ({ type: 'blob', mimeType, data }))
            : undefined,
        }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'An error occurred')
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: data.reply,
            timestamp: getTimestamp(),
          },
        ])
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled by the user – no error shown
      } else {
        setError('Failed to connect to server')
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          background: 'linear-gradient(135deg, #faf6f1 0%, #f5ede5 100%)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
          CopChat
        </div>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: 'var(--accent-orange)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
          }}
        >
          🤖
        </div>
      </div>

      {/* Warning */}
      <div
        style={{
          padding: '6px 16px',
          backgroundColor: 'var(--secondary-bg)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        ⚠️ 個人情報や機密情報は入力しないでください
      </div>

      {/* Messages */}
      <div
        className="messages-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 && !loading && (
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              marginTop: '40px',
              fontSize: '14px',
            }}
          >
            メッセージを送信してチャットを開始してください
          </p>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <div
              className="message-row"
              style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '4px',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  flexShrink: 0,
                  marginTop: '2px',
                  backgroundColor:
                    msg.role === 'user' ? 'var(--accent-peachy)' : 'var(--accent-orange)',
                }}
              >
                {msg.role === 'assistant' ? '✨' : '👤'}
              </div>

              <div>
                {/* Bubble */}
                <div
                  className="message-bubble"
                  style={{
                    backgroundColor:
                      msg.role === 'user' ? 'var(--user-bubble)' : 'var(--ai-bubble)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--border-color)',
                  }}
                >
                  {msg.images && msg.images.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: msg.content ? '8px' : 0 }}>
                      {msg.images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt={`添付画像 ${i + 1}`}
                          style={{
                            maxWidth: '160px',
                            maxHeight: '160px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {msg.content}
                </div>
                {/* Timestamp */}
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                  }}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div
            className="message-row"
            style={{ display: 'flex', gap: '8px' }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                flexShrink: 0,
                marginTop: '2px',
                backgroundColor: 'var(--accent-orange)',
              }}
            >
              ✨
            </div>
            <div>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '24px',
                  backgroundColor: 'var(--ai-bubble)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                    height: '20px',
                  }}
                >
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p
            style={{
              textAlign: 'center',
              color: '#e57373',
              fontSize: '14px',
              padding: '4px',
            }}
          >
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div
        style={{
          padding: '12px 12px 20px',
          backgroundColor: 'var(--primary-bg)',
          borderTop: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
            <button
              className="cancel-button"
              onClick={cancelRequest}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: '1px solid #e57373',
                backgroundColor: '#ffcdd2',
                color: '#c62828',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              ✕ キャンセル
            </button>
          </div>
        )}

        {/* Image preview strip */}
        {attachedImages.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '8px',
            }}
          >
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={img.preview}
                  alt={`添付画像 ${i + 1}`}
                  style={{
                    width: '64px',
                    height: '64px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                  }}
                />
                <button
                  onClick={() => removeImage(i)}
                  aria-label={`画像 ${i + 1} を削除`}
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: 'none',
                    backgroundColor: '#e57373',
                    color: '#fff',
                    fontSize: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(',')}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) addImageFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {/* Image attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || attachedImages.length >= MAX_IMAGES}
            title="画像を添付"
            aria-label="画像を添付"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid var(--border-color)',
              backgroundColor: '#fff',
              color: 'var(--text-secondary)',
              fontSize: '18px',
              cursor: loading || attachedImages.length >= MAX_IMAGES ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: loading || attachedImages.length >= MAX_IMAGES ? 0.4 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            🖼️
          </button>

          <textarea
            className="input-field"
            style={{
              flex: 1,
              padding: '12px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: '24px',
              fontSize: '15px',
              fontFamily: 'inherit',
              color: 'var(--text-primary)',
              backgroundColor: '#fff',
              resize: 'none',
              maxHeight: '100px',
              outline: 'none',
              transition: 'all 0.2s ease',
            }}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="メッセージを入力… (Enter で送信、Shift+Enter で改行)"
            disabled={loading}
          />
          <button
            className="send-button"
            onClick={send}
            disabled={loading || !canSend}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background:
                'linear-gradient(135deg, var(--accent-orange) 0%, var(--accent-warm) 100%)',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              cursor: loading || !canSend ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: loading || !canSend ? 0.5 : 1,
              boxShadow: '0 2px 8px rgba(244, 196, 166, 0.3)',
              transition: 'all 0.2s ease',
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
