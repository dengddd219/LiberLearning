import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../context/TranslationContext'
import { askBullet } from '../../lib/api'
import { loadAskHistory, saveAskHistory } from '../../lib/notesDb'
import type { AskMessage } from '../../lib/notesTypes'
import { C } from '../../lib/notesUtils'

const MODELS = ['中转站', '通义千问', 'DeepSeek', '豆包'] as const

interface InlineQAProps {
  sessionId: string
  pageNum: number
  bulletIndex: number
  bulletText: string
  bulletAiComment: string
}

export default function InlineQA({
  sessionId,
  pageNum,
  bulletIndex,
  bulletText,
  bulletAiComment,
}: InlineQAProps) {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>('中转站')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }

    loadAskHistory(sessionId, pageNum, bulletIndex).then(setMessages)
  }, [sessionId, pageNum, bulletIndex])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  async function handleSend() {
    const q = input.trim()
    if (!sessionId || !q || streaming) return

    const userMsg: AskMessage = { role: 'user', content: q, model, timestamp: Date.now() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)
    setStreamingText('')

    try {
      let full = ''
      await askBullet(sessionId, pageNum, bulletIndex, bulletText, bulletAiComment, q, model, (chunk) => {
        full += chunk
        setStreamingText(full)
      })
      const aiMsg: AskMessage = { role: 'ai', content: full, model, timestamp: Date.now() }
      const finalMessages = [...newMessages, aiMsg]
      setMessages(finalMessages)
      await saveAskHistory(sessionId, pageNum, bulletIndex, finalMessages)
    } catch (err) {
      const errMsg: AskMessage = {
        role: 'ai',
        content: `出错了：${err instanceof Error ? err.message : '未知错误'}`,
        model,
        timestamp: Date.now(),
      }
      const finalMessages = [...newMessages, errMsg]
      setMessages(finalMessages)
      await saveAskHistory(sessionId, pageNum, bulletIndex, finalMessages)
    } finally {
      setStreaming(false)
      setStreamingText('')
    }
  }

  return (
    <div
      style={{
        marginTop: '8px',
        borderRadius: '8px',
        border: `1px solid ${C.divider}`,
        background: C.bg,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 10px',
          borderBottom: `1px solid ${C.divider}`,
        }}
      >
        <span
          style={{ fontSize: '9px', color: C.muted, fontWeight: '600', letterSpacing: '0.06em' }}
        >
          {t('notes_model_label')}
        </span>
        {MODELS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setModel(item)}
            style={{
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              border: `1px solid ${model === item ? C.secondary : C.divider}`,
              background: model === item ? C.sidebar : 'transparent',
              color: model === item ? C.fg : C.muted,
              cursor: 'pointer',
            }}
          >
            {item}
          </button>
        ))}
      </div>

      {(messages.length > 0 || streaming) && (
        <div
          style={{
            maxHeight: '240px',
            overflowY: 'auto',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {messages.map((msg, index) => (
            <div
              key={index}
              style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '6px 10px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user' ? C.fg : C.white,
                  color: msg.role === 'user' ? C.white : C.fg,
                  fontSize: '13px',
                  lineHeight: '1.55',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {streaming && streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '6px 10px',
                  borderRadius: '12px 12px 12px 2px',
                  background: C.white,
                  color: C.fg,
                  fontSize: '13px',
                  lineHeight: '1.55',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {streamingText}
                <span style={{ opacity: 0.5 }}>▍</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '6px 10px' }}>
        <textarea
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder={t('notes_bullet_placeholder')}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: '13px',
            lineHeight: '1.5',
            color: C.fg,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: 'none',
            background: streaming || !input.trim() ? C.divider : C.fg,
            color: C.white,
            cursor: streaming || !input.trim() ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
