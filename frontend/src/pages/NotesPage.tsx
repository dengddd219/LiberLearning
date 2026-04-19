import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import CanvasToolbar from '../components/CanvasToolbar'
import { getSession, retryPage, generateMyNote, askBullet } from '../lib/api'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useHighlights } from '../hooks/useHighlights'
import HighlightLayer from '../components/HighlightLayer'
import { useTextAnnotations } from '../hooks/useTextAnnotations'
import TextAnnotationLayer from '../components/TextAnnotationLayer'
import NewClassModal from '../components/NewClassModal'
import { useSessionEvents } from '../hooks/useSessionEvents'
import type { SSEEvent } from '../hooks/useSessionEvents'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const SWEEP_STYLE_ID = 'ai-sweep-animation'
if (typeof document !== 'undefined' && !document.getElementById(SWEEP_STYLE_ID)) {
  const style = document.createElement('style')
  style.id = SWEEP_STYLE_ID
  style.textContent = `
    @keyframes ai-shimmer-sweep {
      0% { background-position: 200% 50%; }
      100% { background-position: -100% 50%; }
    }
    .ai-bullet-reveal {
      color: transparent;
      background: linear-gradient(110deg, #333333 40%, #ffffff 50%, #333333 60%);
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: ai-shimmer-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .ai-bullet-placeholder {
      color: #999999;
      transition: opacity 0.3s ease;
    }
  `
  document.head.appendChild(style)
}

// ─── IndexedDB：持久化（ask_history / my_notes / page_chat） ───
const DB_NAME = 'liberstudy_ask'
const STORE_NAME = 'ask_history'
const MY_NOTES_STORE = 'my_notes'
const PAGE_CHAT_STORE = 'page_chat'

function openAskDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(MY_NOTES_STORE)) {
        db.createObjectStore(MY_NOTES_STORE)
      }
      if (!db.objectStoreNames.contains(PAGE_CHAT_STORE)) {
        db.createObjectStore(PAGE_CHAT_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function askKey(sessionId: string, pageNum: number, bulletIndex: number) {
  return `${sessionId}:${pageNum}:${bulletIndex}`
}

function myNoteKey(sessionId: string, pageNum: number) {
  return `${sessionId}:${pageNum}`
}

async function loadMyNote(sessionId: string, pageNum: number): Promise<string> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readonly')
    const req = tx.objectStore(MY_NOTES_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.text ?? '')
    req.onerror = () => resolve('')
  })
}

async function saveMyNote(sessionId: string, pageNum: number, text: string) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readwrite')
    tx.objectStore(MY_NOTES_STORE).put({ text }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function loadPageChat(sessionId: string, pageNum: number): Promise<PageChatMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readonly')
    const req = tx.objectStore(PAGE_CHAT_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

async function savePageChat(sessionId: string, pageNum: number, messages: PageChatMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readwrite')
    tx.objectStore(PAGE_CHAT_STORE).put({ messages }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function loadAskHistory(sessionId: string, pageNum: number, bulletIndex: number): Promise<AskMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(askKey(sessionId, pageNum, bulletIndex))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

async function saveAskHistory(sessionId: string, pageNum: number, bulletIndex: number, messages: AskMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ messages }, askKey(sessionId, pageNum, bulletIndex))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

interface AskMessage {
  role: 'user' | 'ai'
  content: string
  model: string
  timestamp: number
}

interface PageChatMessage {
  role: 'user' | 'ai'
  content: string
  timestamp: number
}

interface Bullet { ppt_text: string; level: number; ai_comment: string | null; timestamp_start: number; timestamp_end: number; }
interface AlignedSegment { start: number; end: number; text: string; similarity?: number }
interface PageData {
  page_num: number
  status?: string
  pdf_url: string
  pdf_page_num: number
  thumbnail_url?: string
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[]; error?: string } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
  aligned_segments?: AlignedSegment[]
}
interface SessionData {
  session_id: string
  status: string
  ppt_filename: string
  audio_url: string
  total_duration: number
  pages: PageData[]
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const FONT_SERIF = "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
const C = {
  bg: '#F7F7F2',       // 次级背景（主内容区）
  sidebar: '#F2F2EC',  // 辅助背景（侧边栏）
  fg: '#292929',       // 主文本色
  secondary: '#72726E',// 次要文本色
  muted: '#D0CFC5',    // 禁用/占位符
  dark: '#292929',     // 深色（与fg一致）
  white: '#FFFFFF',    // 顶层卡片
  divider: '#E3E3DA',  // 分割线
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function stripBullet(text: string): string {
  return text.replace(/^[\s•\-–—*]+/, '')
}

// ─── RevealText：CSS class 方式，对齐 ai-text-enhancement.html ───
function RevealText({
  children,
  revealed,
  muted,
  highlight,
}: {
  children: React.ReactNode
  revealed: boolean
  muted: boolean
  highlight: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (!revealed || settledRef.current) return
    const el = ref.current
    if (!el) return

    // 1. 揭开瞬间：下落 + 彩色流光
    el.classList.add('drop-in', 'shimmer-text')

    // 2. 500ms 后固化为最终颜色
    const t = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
      el.style.color = highlight ? '#92400e' : muted ? '#D0CFC5' : '#292929'
      settledRef.current = true
    }, 500)

    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed])

  return (
    <span ref={ref} style={{ color: 'transparent', display: 'inline' }}>
      {children}
    </span>
  )
}

// ─── LineByLineReveal：测量视觉行后逐行 shimmer 揭开 ───
function LineByLineReveal({
  text,
  startReveal,
  onDone,
}: {
  text: string
  startReveal: boolean
  onDone: () => void
}) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [lines, setLines] = useState<string[]>([])
  const [revealedLines, setRevealedLines] = useState<Set<number>>(new Set())

  // 挂载后测量视觉行
  useEffect(() => {
    const el = measureRef.current
    if (!el || !text) return

    const range = document.createRange()
    const textNode = el.firstChild
    if (!textNode) return

    const measured: string[] = []
    let lineStart = 0
    let prevTop: number | null = null

    for (let i = 0; i <= text.length; i++) {
      range.setStart(textNode, i === text.length ? i - 1 : i)
      range.setEnd(textNode, i === text.length ? i : i + 1)
      const rect = range.getBoundingClientRect()
      const top = Math.round(rect.top)

      if (prevTop !== null && top !== prevTop) {
        measured.push(text.slice(lineStart, i))
        lineStart = i
      }
      prevTop = top
    }
    // 最后一行
    if (lineStart < text.length) {
      measured.push(text.slice(lineStart))
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(measured.length > 0 ? measured : [text])
  }, [text])

  // startReveal 触发时逐行揭开
  useEffect(() => {
    if (!startReveal || lines.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRevealedLines(new Set())

    const INTERVAL = 120
    const timers: number[] = []
    lines.forEach((_, i) => {
      const t = window.setTimeout(() => {
        setRevealedLines(prev => new Set(prev).add(i))
        if (i === lines.length - 1) {
          window.setTimeout(onDone, 500)
        }
      }, i * INTERVAL)
      timers.push(t)
    })
    return () => timers.forEach(clearTimeout)
  }, [startReveal, lines, onDone])

  const baseStyle: React.CSSProperties = {
    fontSize: '14px', lineHeight: '1.625', fontWeight: '400',
    margin: 0, userSelect: 'text',
  }

  return (
    <>
      {/* 不可见的测量层 */}
      <p style={{ ...baseStyle, position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: '100%' }}>
        <span ref={measureRef}>{text}</span>
      </p>
      {/* 逐行渲染层 */}
      <p style={{ ...baseStyle }}>
        {lines.length === 0
          ? <span style={{ color: 'transparent' }}>{text}</span>
          : lines.map((line, i) => (
              <LineRevealSpan key={i} text={line} revealed={revealedLines.has(i)} />
            ))
        }
      </p>
    </>
  )
}

function LineRevealSpan({ text, revealed }: { text: string; revealed: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (!revealed || settledRef.current) return
    const el = ref.current
    if (!el) return
    el.classList.add('drop-in', 'shimmer-text')
    const t = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
      el.style.color = '#72726E'
      settledRef.current = true
    }, 300)
    return () => clearTimeout(t)
  }, [revealed])

  return (
    <span ref={ref} style={{ color: 'transparent', display: 'inline' }}>{text}</span>
  )
}

// ─── StreamingExpandText：AI 扩写完成后全文 drop-in shimmer ───
function StreamingExpandText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (settledRef.current || !text) return
    const el = ref.current
    if (!el) return
    settledRef.current = true
    el.classList.add('drop-in', 'shimmer-text')
    const t = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
    }, 600)
    return () => clearTimeout(t)
  }, [text]) // 依赖 text 变化：每次新内容触发新动画

  return (
    <span
      ref={ref}
      style={{ fontSize: '13px', color: 'transparent', lineHeight: '1.7', whiteSpace: 'pre-wrap', display: 'block' }}
    >
      {text}
    </span>
  )
}

// ─── InlineQA：bullet 内联问答区 ───
function InlineQA({
  sessionId,
  pageNum,
  bulletIndex,
  bulletText,
  bulletAiComment,
}: {
  sessionId: string
  pageNum: number
  bulletIndex: number
  bulletText: string
  bulletAiComment: string
}) {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('中转站')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    loadAskHistory(sessionId, pageNum, bulletIndex).then(setMessages)
  }, [sessionId, pageNum, bulletIndex])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  async function handleSend() {
    const q = input.trim()
    if (!q || streaming) return

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
      const errMsg: AskMessage = { role: 'ai', content: `出错了：${err instanceof Error ? err.message : '未知错误'}`, model, timestamp: Date.now() }
      const finalMessages = [...newMessages, errMsg]
      setMessages(finalMessages)
      await saveAskHistory(sessionId, pageNum, bulletIndex, finalMessages)
    } finally {
      setStreaming(false)
      setStreamingText('')
    }
  }

  return (
    <div style={{
      marginTop: '8px',
      borderRadius: '8px',
      border: `1px solid ${C.divider}`,
      background: C.bg,
      overflow: 'hidden',
    }}>
      {/* 模型选择 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderBottom: `1px solid ${C.divider}` }}>
        <span style={{ fontSize: '9px', color: C.muted, fontWeight: '600', letterSpacing: '0.06em' }}>{t('notes_model_label')}</span>
        {(['中转站', '通义千问', 'DeepSeek', '豆包'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setModel(m)}
            style={{
              padding: '1px 6px', borderRadius: '4px', fontSize: '10px',
              border: `1px solid ${model === m ? C.secondary : C.divider}`,
              background: model === m ? C.sidebar : 'transparent',
              color: model === m ? C.fg : C.muted,
              cursor: 'pointer',
            }}
          >{m}</button>
        ))}
      </div>

      {/* 对话历史 */}
      {(messages.length > 0 || streaming) && (
        <div style={{ maxHeight: '240px', overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.role === 'user' ? C.fg : C.white,
                color: msg.role === 'user' ? C.white : C.fg,
                fontSize: '13px',
                lineHeight: '1.55',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {streaming && streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: '12px 12px 12px 2px',
                background: C.white,
                color: C.fg,
                fontSize: '13px',
                lineHeight: '1.55',
                whiteSpace: 'pre-wrap',
              }}>
                {streamingText}
                <span style={{ opacity: 0.5 }}>▋</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* 输入框 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '6px 10px' }}>
        <textarea
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={t('notes_bullet_placeholder')}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', fontSize: '13px', lineHeight: '1.5',
            color: C.fg, fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{
            flexShrink: 0, width: '24px', height: '24px',
            borderRadius: '50%', border: 'none',
            background: streaming || !input.trim() ? C.divider : C.fg,
            color: C.white, cursor: streaming || !input.trim() ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── AiBulletRow：点击展开时 ppt_text 向上抹去，然后 ppt_text + AI 解释全部逐项彩虹揭开 ───
function AiBulletRow({
  bullet,
  expanded,
  animationDone,
  onToggle,
  onAnimationDone,
  onTimestampClick,
  translationEnabled,
  translatedPptText,
  translatedAiComment,
  sessionId,
  pageNum,
  bulletIndex,
}: {
  bullet: Bullet
  expanded: boolean
  animationDone: boolean
  onToggle: () => void
  onAnimationDone: () => void
  onTimestampClick: (t: number) => void
  translationEnabled?: boolean
  translatedPptText?: string
  translatedAiComment?: string | null
  sessionId: string
  pageNum: number
  bulletIndex: number
}) {
  const { t } = useTranslation()
  const hasComment = !!bullet.ai_comment
  const indent = bullet.level * 16
  const [hovered, setHovered] = useState(false)

  const [askOpen, setAskOpen] = useState(false)

  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set())
  // ppt_text 是否正在向上退场
  const [pptExiting, setPptExiting] = useState(false)
  // ppt_text swipe-up 完成，隐藏原始 ppt_text（由 reveal 版本接管）
  // animationDone=true 说明已经播过，直接初始化为 true 跳过退场层
  const [pptSwipedAway, setPptSwipedAway] = useState(animationDone)
  // ai 正文逐行揭开是否已触发
  const [startAiLineReveal, setStartAiLineReveal] = useState(false)


  // 展开/收起时控制退场和揭开动画
  useEffect(() => {
    if (!expanded) {
      // 收起：重置动画中间状态（animationDone=true 的不需要重置，下次展开直接走已完成分支）
      if (!animationDone) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRevealedSet(new Set())
        setPptExiting(false)
        setPptSwipedAway(false)
        setStartAiLineReveal(false)
      }
      return
    }
    if (animationDone) return

    const timers: number[] = []
    const after = (delay: number, fn: () => void) => {
      const t = window.setTimeout(fn, delay)
      timers.push(t)
      return t
    }

    // Phase 1：ppt_text 向上退场（swipe-up）
    setPptExiting(true)
    after(320, () => {
      // Phase 2：ppt_text 揭开，等 shimmer 固色
      setPptSwipedAway(true)
      setRevealedSet(new Set([0]))
      after(300, () => {
        // Phase 3：label 揭开
        setRevealedSet(new Set([0, 1]))
        after(250, () => {
          // Phase 4：ai 正文逐行揭开
          setStartAiLineReveal(true)
        })
      })
    })

    return () => timers.forEach(clearTimeout)
  }, [expanded, animationDone])

  const pptRevealed = revealedSet.has(0)
  const labelRevealed = revealedSet.has(1)
  const pptText = translationEnabled && translatedPptText ? translatedPptText : stripBullet(bullet.ppt_text)

  // 始终渲染同一套 DOM，避免 expanded 切换时销毁/重建节点导致闪烁
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        paddingLeft: indent,
        paddingRight: '6px',
        paddingTop: '4px',
        paddingBottom: '4px',
        borderRadius: '6px',
        background: hovered ? 'rgba(175,179,176,0.12)' : 'transparent',
        transition: 'background 120ms',
        marginLeft: -6,
        marginRight: -6,
      }}
    >
      {/* ppt_text 行：收起时是可点击 button，展开动画期间 swipe-up 退场，退场完成后由 reveal 版本接管 */}
      <div style={{ position: 'relative' }}>
        {/* 退场层：始终存在，expanded+pptExiting 时播 swipe-up，pptSwipedAway 后隐藏 */}
        <button
          type="button"
          onClick={() => { if (hasComment) onToggle() }}
          className="text-left w-full"
          style={{
            background: 'none', border: 'none', padding: '4px 0',
            cursor: hasComment ? 'pointer' : 'default',
            display: pptSwipedAway ? 'none' : 'flex',
            alignItems: 'flex-start', gap: '8px', userSelect: 'text',
            width: '100%',
            ...(pptExiting ? { animation: 'swipe-up 0.32s ease-in forwards' } : {}),
          }}
        >
          <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
            {bullet.level === 0 ? '' : '•'}
          </span>
          <span style={{
            fontSize: bullet.level === 0 ? '15px' : '14px',
            color: '#292929', lineHeight: '1.625',
            fontWeight: bullet.level === 0 ? '600' : '400',
            opacity: !expanded
              ? (translationEnabled && !translatedPptText ? 0.4 : (hasComment ? 1 : 0.5))
              : 1,
            transition: 'opacity 0.2s',
          }}>
            {pptText}
          </span>
          {!expanded && hasComment && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
              style={{ flexShrink: 0, marginTop: '4px', color: '#D0CFC5' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>

        {/* reveal 层：swipe-up 完成后接管显示 */}
        {pptSwipedAway && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0' }}>
            <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
              {bullet.level === 0 ? '' : '•'}
            </span>
            <p style={{ fontSize: bullet.level === 0 ? '15px' : '14px', lineHeight: '1.625', fontWeight: bullet.level === 0 ? '600' : '400', margin: 0, minHeight: '1.4em' }}>
              {animationDone
                ? <span style={{ color: '#292929' }}>{pptText}</span>
                : <RevealText revealed={pptRevealed} muted={false} highlight={false}>{pptText}</RevealText>
              }
            </p>
          </div>
        )}
      </div>

      {/* AI 解释区域 — label 揭开后才挂载 */}
      {hasComment && (animationDone || labelRevealed) && (
        <div style={{ marginLeft: '18px', paddingLeft: '14px', borderLeft: '2px solid rgba(85,96,113,0.2)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '1.4em' }}>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'inline', transform: 'translateY(1px)' }}>
                <path d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z" fill="#72726E" />
              </svg>
            </RevealText>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E', textTransform: 'uppercase' }}>
                AI Clarification
              </span>
            </RevealText>
            {bullet.timestamp_start >= 0 && (
              <RevealText revealed={labelRevealed} muted={false} highlight={false}>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onTimestampClick(bullet.timestamp_start) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '9px', color: '#D0CFC5', fontWeight: '700', padding: 0, marginLeft: '4px' }}>
                  {String(Math.floor(bullet.timestamp_start / 60)).padStart(2, '0')}:
                  {String(Math.floor(bullet.timestamp_start % 60)).padStart(2, '0')}
                </button>
              </RevealText>
            )}
          </div>
          <div style={{
            opacity: translationEnabled && !translatedAiComment ? 0.4 : 1,
            transition: 'opacity 0.2s',
            position: 'relative',
          }}>
            {translationEnabled && translatedAiComment
              ? <p style={{ fontSize: '14px', lineHeight: '1.625', fontWeight: '400', margin: 0, userSelect: 'text', color: '#72726E' }}>{translatedAiComment}</p>
              : animationDone
                ? <p style={{ fontSize: '14px', lineHeight: '1.625', fontWeight: '400', margin: 0, userSelect: 'text', color: '#72726E' }}>{bullet.ai_comment}</p>
                : <LineByLineReveal
                    text={bullet.ai_comment as string}
                    startReveal={startAiLineReveal}
                    onDone={onAnimationDone}
                  />
            }
          </div>

          {/* 针对此条提问 — 在 AI 解释区内部 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button
              type="button"
              onClick={() => setAskOpen(v => !v)}
              style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                border: `1px solid ${askOpen ? C.secondary : C.secondary}`,
                background: askOpen ? C.secondary : 'transparent',
                color: askOpen ? '#fff' : C.secondary,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '5px',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {askOpen ? t('notes_bullet_collapse') : t('notes_bullet_ask')}
            </button>
          </div>

          {/* InlineQA 展开区 */}
          {askOpen && (
            <InlineQA
              sessionId={sessionId}
              pageNum={pageNum}
              bulletIndex={bulletIndex}
              bulletText={bullet.ppt_text}
              bulletAiComment={bullet.ai_comment ?? ''}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { openTab } = useTabs()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('ai')

  type PagePhase = 'upload' | 'processing' | 'ready'
  const isNewSession = !sessionId || sessionId === 'new'
  const location = useLocation()
  const initialPhase: PagePhase = location.state?.phase ?? (isNewSession ? 'upload' : 'ready')
  const [pagePhase, setPagePhase] = useState<PagePhase>(initialPhase)
  const [processingSessionId, setProcessingSessionId] = useState<string | undefined>(isNewSession ? undefined : sessionId)
  const navigate = useNavigate()

  const [transcriptJustDone, setTranscriptJustDone] = useState(false)
  const [aiNotesJustDone, setAiNotesJustDone] = useState(false)
  const [revealedPages, setRevealedPages] = useState<Set<number>>(new Set())
  const [pptPageCount, setPptPageCount] = useState<number>(0)

  const handleSSEEvent = useCallback(async (event: SSEEvent) => {
    const sid = processingSessionId
    if (!sid) return

    if (event.event === 'error') {
      setError(typeof event.message === 'string' ? event.message : '处理失败')
      setPagePhase('ready')
      return
    }

    try {
      const data = await getSession(sid)
      setSession(data as SessionData)
      if (loading) setLoading(false)
    } catch { /* ignore fetch errors */ }

    if (event.event === 'ppt_parsed') {
      setLoading(false)
      setPptPageCount(event.data.num_pages)
    }

    if (event.event === 'asr_done') {
      setTranscriptJustDone(true)
    }

    if (event.event === 'page_ready' && typeof event.page_num === 'number') {
      setRevealedPages(prev => new Set(prev).add(event.page_num as number))
    }

    if (event.event === 'all_done') {
      setPagePhase('ready')
      setAiNotesJustDone(true)
      setTimeout(() => setAiNotesJustDone(false), 1500)
    }
  }, [processingSessionId, loading])

  useSessionEvents(processingSessionId, pagePhase === 'processing', handleSSEEvent)

  const handleUploadSuccess = useCallback((newSessionId: string) => {
    setProcessingSessionId(newSessionId)
    setPagePhase('processing')
    setLoading(true)
    window.history.replaceState(null, '', `/notes/${newSessionId}`)
  }, [])
  const [playingSegIdx, setPlayingSegIdx] = useState<number | null>(null)
  const [playProgress, setPlayProgress] = useState(0) // 0–1，当前播放段进度
  const segStartRef = useRef<number | null>(null)
  const segEndRef = useRef<number | null>(null)
  const segTimeUpdateRef = useRef<(() => void) | null>(null)
  const [transcriptClickCount, setTranscriptClickCount] = useState<number>(() => {
    return parseInt(localStorage.getItem('liberstudy_transcript_clicks') ?? '0', 10)
  })
  const [copyToast, setCopyToast] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)
  const [navVisible, setNavVisible] = useState(false)

  // Toolbar state
  const [activeTool, setActiveTool] = useState<'none' | 'highlight' | 'eraser' | 'text'>('none')
  const [highlightColor, setHighlightColor] = useState('#FAFF00')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageInputValue, setPageInputValue] = useState('1')

  // 跨页持久化的展开状态：pageNum → Set<bulletIndex>
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  // 记录哪些 bullet 的 shimmer 动画已播完，跨页持久化，切回来直接显示文本
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const prevPageRef = useRef<number>(1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const wheelTimeoutRef = useRef<number | null>(null)
  const wheelAccumRef = useRef(0)
  const currentPageRef = useRef(currentPage)
  const totalPagesRef = useRef(session?.pages.length ?? 1)

  // Highlight tool state
  const pageContainerRef = useRef<HTMLDivElement | null>(null)
  const { addHighlight, removeHighlight, highlightsForPage } = useHighlights(sessionId ?? '')
  const { addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage } = useTextAnnotations(sessionId ?? '')

  // Translation state
  const { enabled: translationEnabled, setEnabled: setTranslationEnabled, targetLang, setTargetLang, translate, t } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, {
    bullets: string[]
    aiComments: (string | null)[]
    supplement: string | null
    aiExpansion: string | null
  }>>(new Map())

  // Provider 切换（AI Notes 顶部）
  type Provider = '中转站' | '通义千问' | 'DeepSeek' | '豆包'
  const [provider, setProvider] = useState<Provider>('中转站')
  void setProvider // UI 暂未连线

  // My Notes：key=pageNum，值为文本（从 IndexedDB 加载，onChange 时 debounce 保存）
  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const myNoteSaveTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const getMyNoteText = (page: number) => myNoteTexts.get(page) ?? ''

  const handleMyNoteChange = useCallback((page: number, text: string) => {
    setMyNoteTexts(prev => { const m = new Map(prev); m.set(page, text); return m })
    // debounce 500ms 保存
    const timers = myNoteSaveTimerRef.current
    const old = timers.get(page)
    if (old) clearTimeout(old)
    const t = setTimeout(() => {
      if (sessionId) saveMyNote(sessionId, page, text)
      timers.delete(page)
    }, 500)
    timers.set(page, t)
  }, [sessionId])

  // 切换页面时从 IndexedDB 加载 my note
  useEffect(() => {
    if (!sessionId) return
    loadMyNote(sessionId, currentPage).then(text => {
      setMyNoteTexts(prev => {
        if (prev.has(currentPage)) return prev
        const m = new Map(prev); m.set(currentPage, text); return m
      })
    })
  }, [sessionId, currentPage])

  // AI 扩写状态：idle | expanding（扩写中）| expanded（扩写完成）
  type MyNoteExpandState = { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }
  const [myNoteExpandStates, setMyNoteExpandStates] = useState<Map<number, MyNoteExpandState>>(new Map())

  const getMyNoteExpandState = (page: number): MyNoteExpandState =>
    myNoteExpandStates.get(page) ?? { userNote: '', aiText: '', status: 'idle' }

  const patchMyNoteExpandState = useCallback((page: number, patch: Partial<MyNoteExpandState>) =>
    setMyNoteExpandStates(prev => {
      const current = prev.get(page) ?? { userNote: '', aiText: '', status: 'idle' as const }
      const next = new Map(prev)
      next.set(page, { ...current, ...patch })
      return next
    }), [])

  // Page-level chat（My Notes / AI Notes 底部共用，key=pageNum）
  const [pageChatMessages, setPageChatMessages] = useState<Map<number, PageChatMessage[]>>(new Map())
  const [pageChatInput, setPageChatInput] = useState('')
  const [pageChatStreaming, setPageChatStreaming] = useState(false)
  const [pageChatStreamingText, setPageChatStreamingText] = useState('')
  const pageChatBottomRef = useRef<HTMLDivElement>(null)

  // Drawer phase: 'closed' | 'input' | 'full'
  const [drawerPhase, setDrawerPhase] = useState<'closed' | 'input' | 'full'>('closed')
  const [drawerHeightPx, setDrawerHeightPx] = useState<number | null>(null) // null = use default %
  const [drawerModel, setDrawerModel] = useState('Auto')
  const [drawerModelDDOpen, setDrawerModelDDOpen] = useState(false)
  const drawerModelBtnRef = useRef<HTMLButtonElement>(null)

  // 切换页面时收回抽屉
  const drawerPrevPageRef = useRef(currentPage)
  useEffect(() => {
    if (drawerPrevPageRef.current !== currentPage) {
      setDrawerPhase('closed')
      setDrawerHeightPx(null)
      setPageChatInput('')
      drawerPrevPageRef.current = currentPage
    }
  }, [currentPage])

  const getPageChat = (page: number): PageChatMessage[] => pageChatMessages.get(page) ?? []

  // 切换页面时加载 page chat
  useEffect(() => {
    if (!sessionId) return
    loadPageChat(sessionId, currentPage).then(msgs => {
      setPageChatMessages(prev => {
        if (prev.has(currentPage)) return prev
        const m = new Map(prev); m.set(currentPage, msgs); return m
      })
    })
  }, [sessionId, currentPage])

  useEffect(() => {
    pageChatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pageChatMessages, pageChatStreamingText])

  const handlePageChatSend = useCallback(async () => {
    const q = pageChatInput.trim()
    if (!q || pageChatStreaming || !sessionId) return
    const userMsg: PageChatMessage = { role: 'user', content: q, timestamp: Date.now() }
    const currentMsgs = pageChatMessages.get(currentPage) ?? []
    const newMsgs = [...currentMsgs, userMsg]
    setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, newMsgs); return m })
    setPageChatInput('')
    setPageChatStreaming(true)
    setPageChatStreamingText('')

    try {
      const pageData = session?.pages.find(p => p.page_num === currentPage)
      const context = [
        getMyNoteText(currentPage) ? `用户笔记：${getMyNoteText(currentPage)}` : '',
        pageData?.passive_notes?.bullets?.map(b => b.ppt_text).join('\n') ?? '',
      ].filter(Boolean).join('\n\n')

      let full = ''
      await askBullet(sessionId, currentPage, -1, context, '', q, '中转站', (chunk) => {
        full += chunk
        setPageChatStreamingText(full)
      })
      const aiMsg: PageChatMessage = { role: 'ai', content: full, timestamp: Date.now() }
      const finalMsgs = [...newMsgs, aiMsg]
      setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, finalMsgs); return m })
      await savePageChat(sessionId, currentPage, finalMsgs)
    } catch (err) {
      const errMsg: PageChatMessage = { role: 'ai', content: `出错了：${err instanceof Error ? err.message : '未知错误'}`, timestamp: Date.now() }
      const finalMsgs = [...newMsgs, errMsg]
      setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, finalMsgs); return m })
      await savePageChat(sessionId, currentPage, finalMsgs)
    } finally {
      setPageChatStreaming(false)
      setPageChatStreamingText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageChatInput, pageChatStreaming, sessionId, currentPage, pageChatMessages, session, myNoteTexts])

  // Resizable panel state
  const [notesPanelWidth, setNotesPanelWidth] = useState(500)
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(320)

    // Canvas width for react-pdf
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(800)

  useEffect(() => {
    if (!canvasAreaRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(Math.max(400, entry.contentRect.width - 48))
      }
    })
    ro.observe(canvasAreaRef.current)
    return () => ro.disconnect()
  }, [])

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true
    resizeStartXRef.current = e.clientX
    resizeStartWidthRef.current = notesPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = resizeStartXRef.current - ev.clientX
      setNotesPanelWidth(Math.max(100, resizeStartWidthRef.current + delta))
    }

    const onMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [notesPanelWidth])

  // NotesPage 挂载时锁定 body 滚动，防止触摸板带动整页上下滚
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    if (!sessionId || sessionId === 'new') return
    getSession(sessionId)
      .then((data) => {
        setSession(data as SessionData)
        if ((data as SessionData).pages?.length) {
          setPptPageCount((data as SessionData).pages.length)
        }
        openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
        setLoading(false)
        if ((data as SessionData).status === 'processing') {
          setPagePhase('processing')
          setProcessingSessionId(sessionId)
        }
      })
      .catch(() => { setError('无法加载笔记数据'); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Wheel翻页 handler（用 passive:false 原生监听才能 preventDefault）
  const handleWheelRef = useRef<(e: WheelEvent) => void>((e) => {
    // 横向滑动为主时不翻页
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    e.preventDefault()
    e.stopPropagation()

    // 累积 deltaY，超过阈值才翻页（兼容触摸板小增量和鼠标大增量）
    // deltaMode=1 是行模式（鼠标），乘以 40 转换为像素
    const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
    wheelAccumRef.current += delta

    const THRESHOLD = 50
    if (Math.abs(wheelAccumRef.current) < THRESHOLD) return

    const direction = wheelAccumRef.current > 0 ? 1 : -1
    wheelAccumRef.current = 0

    if (wheelTimeoutRef.current) return
    if (direction === 1 && currentPageRef.current < totalPagesRef.current) {
      setCurrentPage(p => p + 1)
    } else if (direction === -1 && currentPageRef.current > 1) {
      setCurrentPage(p => p - 1)
    }
    wheelTimeoutRef.current = window.setTimeout(() => {
      wheelTimeoutRef.current = null
      wheelAccumRef.current = 0
    }, 400)
  })

  // 在 window 捕获阶段监听 wheel，检查事件是否发生在 canvas 区域内
  // 原因：useEffect([]) 运行时 loading 尚未结束，canvasAreaRef.current 为 null，
  // 导致事件永远无法注册。改用 window 级监听 + 区域检测规避此问题。
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const el = canvasAreaRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) return
      handleWheelRef.current(e)
    }
    window.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handler, { capture: true })
  }, [])

  // Keep wheel ref pages in sync
  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    totalPagesRef.current = session?.pages.length ?? 1
  }, [session?.pages.length])

  // 键盘翻页
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        setCurrentPage(p => Math.min(p + 1, session?.pages.length ?? 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        setCurrentPage(p => Math.max(p - 1, 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session?.pages.length])

  // 页码输入框同步 currentPage
  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  const handleTimestampClick = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds
      audioRef.current.play()
    }
  }, [])

  const handleSegmentPlay = useCallback((seg: AlignedSegment, idx: number) => {
    const audio = audioRef.current
    if (!audio) return

    // 点击正在播放的行 → 停止
    if (playingSegIdx === idx) {
      audio.pause()
      segEndRef.current = null
      segStartRef.current = null
      if (segTimeUpdateRef.current) {
        audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
        segTimeUpdateRef.current = null
      }
      setPlayingSegIdx(null)
      setPlayProgress(0)
      return
    }

    // 切换到新行前清除旧监听
    if (segTimeUpdateRef.current) {
      audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
      segTimeUpdateRef.current = null
    }

    // 记录点击次数（最多记到 3，超过后不再更新）
    setTranscriptClickCount((prev) => {
      const next = Math.min(prev + 1, 3)
      localStorage.setItem('liberstudy_transcript_clicks', String(next))
      return next
    })

    segEndRef.current = seg.end
    segStartRef.current = seg.start
    setPlayingSegIdx(idx)
    setPlayProgress(0)
    audio.currentTime = seg.start
    audio.play()

    const onTimeUpdate = () => {
      const start = segStartRef.current!
      const end = segEndRef.current!
      const duration = end - start
      if (duration > 0) {
        setPlayProgress(Math.min((audio.currentTime - start) / duration, 1))
      }
      if (segEndRef.current !== null && audio.currentTime >= segEndRef.current) {
        audio.pause()
        segEndRef.current = null
        segStartRef.current = null
        segTimeUpdateRef.current = null
        setPlayingSegIdx(null)
        setPlayProgress(0)
        audio.removeEventListener('timeupdate', onTimeUpdate)
      }
    }
    segTimeUpdateRef.current = onTimeUpdate
    audio.addEventListener('timeupdate', onTimeUpdate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingSegIdx])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleCopyPage = useCallback(() => {
    if (!session) return
    const page = session.pages.find((p) => p.page_num === currentPage)
    if (!page) return
    const bullets = page.passive_notes?.bullets.map((b) => `• ${b.ppt_text}`).join('\n') ?? ''
    const text = `## 第 ${page.page_num} 页\n\n${bullets}`
    navigator.clipboard.writeText(text)
    setCopyToast(true)
    setTimeout(() => setCopyToast(false), 1500)
  }, [session, currentPage])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleExportMarkdown = useCallback(() => {
    if (!session) return
    const lines: string[] = [`# ${session.ppt_filename}\n`]
    session.pages.forEach((page) => {
      lines.push(`## 第 ${page.page_num} 页`)
      if (page.active_notes) {
        lines.push(`\n> 我的笔记：${page.active_notes.user_note}`)
        lines.push(`\n${page.active_notes.ai_expansion}`)
      }
      if (page.passive_notes) {
        page.passive_notes.bullets.forEach((b) => lines.push(`- ${b.ppt_text}`))
      }
      if (page.page_supplement) {
        lines.push(`\n**脱离课件内容：**\n${page.page_supplement.content}`)
      }
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `LiberStudy_${session.ppt_filename}_${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [session])

  const handleExpandMyNote = useCallback(async (pageNum: number) => {
    if (!sessionId) return
    const userNote = myNoteTexts.get(pageNum) ?? ''
    if (!userNote.trim()) return
    const pptText = session?.pages.find(p => p.page_num === pageNum)?.ppt_text ?? ''
    patchMyNoteExpandState(pageNum, { userNote, aiText: '', status: 'expanding' })
    try {
      await generateMyNote(sessionId, pageNum, userNote, pptText, provider, (chunk) => {
        setMyNoteExpandStates(prev => {
          const current = prev.get(pageNum)
          if (!current) return prev
          const next = new Map(prev)
          next.set(pageNum, { ...current, aiText: current.aiText + chunk })
          return next
        })
      })
      patchMyNoteExpandState(pageNum, { status: 'expanded' })
    } catch {
      patchMyNoteExpandState(pageNum, { status: 'idle' })
    }
  }, [sessionId, session, provider, myNoteTexts, patchMyNoteExpandState])

  const handleRetryPage = useCallback(async (pageNum: number) => {
    if (!sessionId || retrying !== null) return
    setRetrying(pageNum)
    try {
      await retryPage(sessionId, pageNum)
      const data = await getSession(sessionId)
      setSession(data as SessionData)
    } catch {
      // keep current state
    } finally {
      setRetrying(null)
    }
  }, [sessionId, retrying])

  const translatePage = useCallback(async (pageNum: number) => {
    if (!session) return
    const page = session.pages.find((p) => p.page_num === pageNum)
    if (!page) return

    const bullets = page.passive_notes?.bullets ?? []
    const supplement = page.page_supplement?.content ?? null
    const aiExpansion = page.active_notes?.ai_expansion ?? null

    const [translatedBullets, translatedAiComments, translatedSupplement, translatedAiExpansion] =
      await Promise.all([
        Promise.all(bullets.map((b) => translate(b.ppt_text))),
        Promise.all(bullets.map((b) => (b.ai_comment ? translate(b.ai_comment) : Promise.resolve(null)))),
        supplement ? translate(supplement) : Promise.resolve(null),
        aiExpansion ? translate(aiExpansion) : Promise.resolve(null),
      ])

    setTranslatedTexts((prev) => {
      const next = new Map(prev)
      next.set(pageNum, {
        bullets: translatedBullets,
        aiComments: translatedAiComments,
        supplement: translatedSupplement,
        aiExpansion: translatedAiExpansion,
      })
      return next
    })
  }, [session, translate])

  // 翻译已开启时，翻页自动翻译新页
  useEffect(() => {
    if (translationEnabled && session) {
      translatePage(currentPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, translationEnabled, session])

  // 切页时把上一页所有展开中的 bullet 标记为动画完成，跳回来直接显示文本
  useEffect(() => {
    const prevPage = prevPageRef.current
    if (prevPage === currentPage) return
    const expanded = expandedBullets.get(prevPage)
    if (expanded && expanded.size > 0) {
      setAnimatedBullets(prev => {
        const next = new Map(prev)
        const pageSet = new Set(next.get(prevPage) ?? [])
        expanded.forEach(i => pageSet.add(i))
        next.set(prevPage, pageSet)
        return next
      })
    }
    prevPageRef.current = currentPage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])

  if (loading && pagePhase === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: C.muted }}>{t('notes_loading')}</p>
        </div>
      </div>
    )
  }

  if ((error || !session) && pagePhase === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: C.secondary }}>{error ?? t('notes_unknown_error')}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer transition-all duration-150"
            style={{ background: C.sidebar, color: C.fg }}
          >
            {t('notes_retry')}
          </button>
        </div>
      </div>
    )
  }

  const currentPageData = session?.pages.find((p) => p.page_num === currentPage)
  const totalPages = session?.pages.length ?? 0

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: FONT_SERIF }}>

      {/* Main body (below TopAppBar) */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '40px' }}>

        {/* Left slide nav: click-toggle */}
        {navVisible && (
          <aside
            className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{ width: '200px', background: C.sidebar, borderRight: '1px solid rgba(175,179,176,0.1)', zIndex: 15 }}
          >
            <div
              className="flex items-center justify-between flex-shrink-0 px-4"
              style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
            >
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.secondary }}>{t('notes_toc')}</span>
              <button type="button" onClick={() => setNavVisible(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.secondary }}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} onWheel={(e) => e.stopPropagation()}>
              {session.pages.map((page) => {
                const isActive = page.page_num === currentPage
                return (
                  <button
                    type="button"
                    key={page.page_num}
                    onClick={() => setCurrentPage(page.page_num)}
                    aria-label={`跳转到第 ${page.page_num} 张幻灯片`}
                    aria-current={isActive ? 'true' : undefined}
                    className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center w-full border-none p-0"
                    style={{ height: '80px', borderRadius: '6px', background: C.divider, boxShadow: isActive ? '0px 0px 0px 2px rgba(95,94,94,1)' : '0 1px 3px rgba(0,0,0,0.08)', opacity: isActive ? 1 : 0.7 }}
                  >
                    <img
                      src={page.thumbnail_url ? `${API_BASE}${page.thumbnail_url}` : `${API_BASE}/api/sessions/${sessionId}/slide/${page.pdf_page_num}.png`}
                      alt={`第${page.page_num}页`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                    <span className="absolute top-1 left-1.5 flex items-center justify-center" style={{ background: C.fg, color: C.white, fontSize: '8px', fontWeight: '700', borderRadius: '3px', padding: '1px 5px', minWidth: '16px' }}>
                      {page.page_num}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        {/* Center: PPT Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: C.bg }}>

          {/* Toolbar */}
          <CanvasToolbar
            navVisible={navVisible}
            onNavToggle={() => setNavVisible((v) => !v)}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onHighlightColorChange={setHighlightColor}
            translationEnabled={translationEnabled}
            popoverOpen={popoverOpen}
            onPopoverToggle={() => setPopoverOpen((v) => !v)}
            targetLang={targetLang}
            onTargetLangChange={setTargetLang}
            onTranslate={() => { setTranslationEnabled(true); setPopoverOpen(false); translatePage(currentPage) }}
            onShowOriginal={() => { setTranslationEnabled(false); setPopoverOpen(false) }}
            onClosePopover={() => setPopoverOpen(false)}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            currentPage={currentPage}
            totalPages={totalPages}
            pageInputValue={pageInputValue}
            onPageInputChange={setPageInputValue}
            onPageInputCommit={() => {
              const n = parseInt(pageInputValue, 10)
              if (!isNaN(n) && n >= 1 && n <= totalPages) setCurrentPage(n)
              else setPageInputValue(String(currentPage))
            }}
            onPrevPage={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
            onNextPage={() => currentPage < totalPages && setCurrentPage(currentPage + 1)}
            searchOpen={searchOpen}
            onSearchToggle={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery('') }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          {/* Canvas area — single page with wheel navigation */}
          <div
            ref={canvasAreaRef}
            className="flex-1 flex items-center justify-center"
            style={{
              background: 'rgba(232,231,226,0.6)',
              overflowX: zoomLevel > 100 ? 'auto' : 'hidden',
              overflowY: 'hidden',
              touchAction: 'none',
            }}
          >
            {!currentPageData && pagePhase === 'processing' && (
              <div style={{ width: Math.round(canvasWidth * zoomLevel / 100), maxWidth: '100%', aspectRatio: '16/9', borderRadius: '8px', background: C.white, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
                <span style={{ fontSize: '12px', color: C.muted }}>{t('notes_loading')}</span>
              </div>
            )}
            {currentPageData && (() => {
              const pdfUrl = currentPageData.pdf_url ? `${API_BASE}${currentPageData.pdf_url}` : null
              return (
                <div
                  className="relative"
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                >
                  <div
                    ref={pageContainerRef}
                    className="relative rounded-lg overflow-hidden"
                    style={{
                      background: C.white,
                      boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                    }}
                  >
                    {pdfUrl ? (
                      <Document
                        file={pdfUrl}
                        loading={
                          <div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                              style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
                          </div>
                        }
                      >
                        <Page
                          pageNumber={currentPageData.pdf_page_num}
                          width={Math.round(canvasWidth * zoomLevel / 100)}
                          renderTextLayer={true}
                          renderAnnotationLayer={false}
                        />
                      </Document>
                    ) : (
                      <img
                        src={`${API_BASE}/api/sessions/${sessionId}/slide/${currentPageData.pdf_page_num}.png`}
                        alt={`第${currentPageData.page_num}页`}
                        style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block' }}
                        loading="lazy"
                      />
                    )}
                    {/* Play button */}
                    <button
                      onClick={() => handleTimestampClick(currentPageData.page_start_time)}
                      className="absolute top-3 left-3 text-xs px-2 py-0.5 rounded cursor-pointer transition-all duration-150"
                      style={{ background: 'rgba(47,51,49,0.7)', color: C.white }}
                    >
                      ▶ {formatTime(currentPageData.page_start_time)}
                    </button>
                    {/* Highlight layer */}
                    <HighlightLayer
                      pageContainerRef={pageContainerRef}
                      pageNum={currentPage}
                      highlights={highlightsForPage(currentPage)}
                      highlightToolActive={activeTool === 'highlight'}
                      eraserToolActive={activeTool === 'eraser'}
                      highlightColor={highlightColor}
                      onAdd={(rec) => addHighlight({ ...rec, sessionId: sessionId ?? '' })}
                      onRemove={removeHighlight}
                    />
                    {/* Text annotation layer */}
                    <TextAnnotationLayer
                      annotations={annotationsForPage(currentPage)}
                      textToolActive={activeTool === 'text'}
                      onPlaceAnnotation={(x, y) => addAnnotation(currentPage, x, y)}
                      onUpdate={updateAnnotation}
                      onRemove={removeAnnotation}
                    />
                    {/* Slide label bottom-right */}
                    <div
                      className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
                    >
                      SLIDE {String(currentPageData.page_num).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </main>

        {/* Resizer */}
        <div
          onMouseDown={handleResizerMouseDown}
          className="flex-shrink-0 flex items-center justify-center"
          style={{
            width: '8px',
            cursor: 'col-resize',
            background: 'transparent',
            position: 'relative',
            zIndex: 10,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.06)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
        >
          <div style={{ width: '1px', height: '100%', background: 'rgba(175,179,176,0.2)' }} />
        </div>

        {/* Right panel: Notes */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: `${notesPanelWidth}px`, background: C.white, position: 'relative' }}
        >
          {/* Tab bar */}
          <div
            className="flex-shrink-0 flex items-end"
            style={{ padding: '14px 18px 0', borderBottom: `1px solid ${C.divider}`, gap: 0 }}
          >
            {(['my', 'ai', 'transcript'] as const).map((mode) => {
              const label = mode === 'my' ? t('notes_my_tab') : mode === 'ai' ? t('notes_ai_tab') : t('notes_transcript_tab')
              const active = noteMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setNoteMode(mode); if (mode === 'transcript') setTranscriptJustDone(false) }}
                  style={{
                    padding: '6px 16px 10px',
                    fontSize: '13px',
                    fontWeight: active ? '700' : '500',
                    color: active ? C.fg : C.muted,
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${active ? '#798C00' : 'transparent'}`,
                    marginBottom: '-1px',
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  {mode === 'transcript' && pagePhase === 'processing' && !session?.pages?.some(p => (p.aligned_segments?.length ?? 0) > 0) && (
                    <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#EC4899', verticalAlign: 'middle' }} />
                  )}
                  {mode === 'transcript' && transcriptJustDone && (
                    <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
                  )}
                  {mode === 'ai' && pagePhase === 'processing' && session?.pages?.some(p => !p.passive_notes?.bullets?.length) && (
                    <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#8B5CF6', verticalAlign: 'middle' }} />
                  )}
                  {mode === 'ai' && aiNotesJustDone && (
                    <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Notes content area */}
          <div className="flex-1 overflow-y-auto px-6 pb-4" onWheel={(e) => e.stopPropagation()}>

            {noteMode === 'my' ? (() => {
              const myText = getMyNoteText(currentPage)

              return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {/* 始终可见的 textarea，像 Word 打字 */}
                  <textarea
                    value={myText}
                    onChange={e => handleMyNoteChange(currentPage, e.target.value)}
                    placeholder={t('notes_my_placeholder')}
                    style={{
                      flex: 1, width: '100%', resize: 'none', border: 'none', outline: 'none',
                      background: 'transparent', color: C.fg, fontSize: '13px',
                      lineHeight: '1.7', fontFamily: 'inherit', minHeight: '200px',
                      boxSizing: 'border-box', padding: '0', paddingTop: '12px',
                    }}
                  />

                </div>
              )
            })() : noteMode === 'ai' ? (
              /* AI Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* My Notes 块 — AI Notes 区域顶部 */}
                {(() => {
                  const myText = getMyNoteText(currentPage)
                  const expandState = getMyNoteExpandState(currentPage)
                  const hasMyNote = myText.trim().length > 0
                  const isExpanding = expandState.status === 'expanding'
                  const isExpanded = expandState.status === 'expanded'
                  const pptAnnotations = annotationsForPage(currentPage).filter(a => a.text.trim())

                  if (!hasMyNote && !isExpanded && pptAnnotations.length === 0) return null

                  return (
                    <div style={{ paddingTop: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E' }}>{t('notes_my_notes_heading')}</span>
                        {hasMyNote && (
                          <button
                            type="button"
                            onClick={() => handleExpandMyNote(currentPage)}
                            disabled={isExpanding}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '2px 8px', borderRadius: '4px',
                              border: `1px solid ${isExpanding ? '#6366f1' : C.divider}`,
                              background: isExpanding ? 'rgba(99,102,241,0.08)' : 'transparent',
                              color: isExpanding ? '#6366f1' : C.muted,
                              fontSize: '11px', fontWeight: '500', cursor: isExpanding ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                                fill={isExpanding ? '#6366f1' : '#72726E'} />
                            </svg>
                            {isExpanding ? t('notes_expanding') : t('notes_expand')}
                          </button>
                        )}
                      </div>

                      {/* 用户笔记原文（黑色） */}
                      {hasMyNote && (
                        <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}>
                          {myText}
                        </p>
                      )}

                      {/* PPT 批注（只读展示） */}
                      {pptAnnotations.length > 0 && (
                        <div style={{ marginTop: hasMyNote ? '10px' : '0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', color: C.muted }}>{t('notes_annotation_label')}</span>
                          {pptAnnotations.map(a => (
                            <p key={a.id} style={{
                              fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0,
                              padding: '6px 10px', borderRadius: '6px', background: C.sidebar,
                              whiteSpace: 'pre-wrap',
                            }}>
                              {a.text}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* AI 扩写流式展示（灰色） */}
                      {(isExpanding || isExpanded) && expandState.aiText && (
                        <div
                          style={{
                            marginTop: '10px',
                            paddingLeft: '14px',
                            borderLeft: '2px solid rgba(85,96,113,0.2)',
                          }}
                        >
                          {isExpanding ? (
                            <div
                              style={{ fontSize: '13px', color: '#72726E', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}
                            >
                              {expandState.aiText}
                              <span style={{ opacity: 0.5 }}>▋</span>
                            </div>
                          ) : (
                            <StreamingExpandText text={expandState.aiText} />
                          )}
                        </div>
                      )}

                      {/* 分隔线 — My Notes 与 AI Notes 分开 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', marginBottom: '4px' }}>
                        <div style={{ flex: 1, height: '1px', background: C.divider }} />
                        <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted, whiteSpace: 'nowrap' }}>
                          AI NOTES
                        </span>
                        <div style={{ flex: 1, height: '1px', background: C.divider }} />
                      </div>
                    </div>
                  )
                })()}

                {/* Active notes (user note + AI expansion) — 原始 session 数据 */}
                {currentPageData?.active_notes ? (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        ACTIVE ANNOTATION
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ fontSize: '11px', color: '#D0CFC5', fontWeight: '500' }}>
                        {formatTime(currentPageData.page_start_time)}
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                    </div>
                    <p style={{ fontSize: '14px', color: C.fg, fontWeight: '500', lineHeight: '1.6', marginBottom: '12px' }}>
                      {currentPageData.active_notes.user_note}
                    </p>
                    {/* AI clarification block */}
                    <div style={{ borderLeft: '2px solid rgba(85,96,113,0.2)', paddingLeft: '16px' }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                            fill="#72726E"
                          />
                        </svg>
                        <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: C.secondary, textTransform: 'uppercase' }}>
                          AI Clarification
                        </span>
                      </div>
                      <p style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6',
                        opacity: translationEnabled && !translatedTexts.get(currentPage)?.aiExpansion ? 0.4 : 1,
                        transition: 'opacity 0.2s',
                      }}>
                        {translationEnabled && translatedTexts.get(currentPage)?.aiExpansion
                          ? translatedTexts.get(currentPage)!.aiExpansion!
                          : currentPageData.active_notes.ai_expansion}
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Passive notes — error state */}
                {currentPageData?.passive_notes?.error && (
                  <div
                    className="rounded-lg p-4"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#B45309' }}>
                        笔记生成失败
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#92400E', lineHeight: '1.5', marginBottom: '8px' }}>
                      {currentPageData.passive_notes.error}
                    </p>
                    <button
                      onClick={() => handleRetryPage(currentPageData.page_num)}
                      disabled={retrying === currentPageData.page_num}
                      className="text-xs px-3 py-1.5 rounded cursor-pointer transition-all duration-150 disabled:opacity-50"
                      style={{
                        background: '#F59E0B',
                        color: C.white,
                        border: 'none',
                        fontWeight: '500',
                      }}
                    >
                      {retrying === currentPageData.page_num ? '重新生成中…' : '重新生成'}
                    </button>
                  </div>
                )}

                {/* PPT bullets + AI 解释（点击展开，打字机） */}
                {currentPageData?.passive_notes?.bullets && currentPageData.passive_notes.bullets.length > 0 && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.1em', color: '#777C79', textTransform: 'uppercase' }}>
                        AI Notes
                      </span>
                    </div>
                    <div
                      className={revealedPages.has(currentPage) ? 'ai-bullet-reveal' : ''}
                      style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                    >
                      {currentPageData.passive_notes.bullets.map((bullet, i) => (
                        <AiBulletRow
                          key={`${currentPage}-${i}`}
                          bullet={bullet}
                          expanded={expandedBullets.get(currentPage)?.has(i) ?? false}
                          animationDone={animatedBullets.get(currentPage)?.has(i) ?? false}
                          onToggle={() => {
                            setExpandedBullets(prev => {
                              const next = new Map(prev)
                              const pageSet = new Set(next.get(currentPage) ?? [])
                              if (pageSet.has(i)) pageSet.delete(i)
                              else pageSet.add(i)
                              next.set(currentPage, pageSet)
                              return next
                            })
                          }}
                          onAnimationDone={() => {
                            setAnimatedBullets(prev => {
                              const next = new Map(prev)
                              const pageSet = new Set(next.get(currentPage) ?? [])
                              pageSet.add(i)
                              next.set(currentPage, pageSet)
                              return next
                            })
                          }}
                          onTimestampClick={handleTimestampClick}
                          translationEnabled={translationEnabled}
                          translatedPptText={translatedTexts.get(currentPage)?.bullets[i]}
                          translatedAiComment={translatedTexts.get(currentPage)?.aiComments[i]}
                          sessionId={sessionId ?? ''}
                          pageNum={currentPage}
                          bulletIndex={i}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Processing placeholder: show ppt_text as grey text */}
                {pagePhase === 'processing' && !currentPageData?.passive_notes && currentPageData?.ppt_text && (
                  <div className="ai-bullet-placeholder" style={{ padding: '8px 0' }}>
                    {currentPageData.ppt_text.split('\n').filter(Boolean).map((line, i) => (
                      <div key={`draft-${i}`} style={{ fontSize: '13px', lineHeight: '1.8', color: C.muted }}>
                        • {line}
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                      <span className="inline-block w-3 h-3 border-2 border-transparent rounded-full animate-spin" style={{ borderColor: '#D0CFC5', borderTopColor: '#8B5CF6' }} />
                      <span style={{ fontSize: '11px', color: C.muted }}>AI 正在生成笔记...</span>
                    </div>
                  </div>
                )}

                {/* No data at all */}
                {!currentPageData?.active_notes && !currentPageData?.passive_notes?.error && (!currentPageData?.passive_notes || currentPageData.passive_notes.bullets.length === 0) && !(pagePhase === 'processing' && currentPageData?.ppt_text) && (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>{t('notes_no_ai_notes')}</p>
                  </div>
                )}

                {/* Page supplement (off-slide content) */}
                {currentPageData?.page_supplement && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        {t('notes_off_slide')}
                      </span>
                    </div>
                    <div
                      className="rounded-lg p-3"
                      style={{ background: 'rgba(85,96,113,0.05)', border: '1px solid rgba(85,96,113,0.1)' }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => handleTimestampClick(currentPageData.page_supplement!.timestamp_start)}
                          className="text-xs cursor-pointer transition-all duration-150 hover:opacity-70"
                          style={{ color: '#D0CFC5', background: 'none', border: 'none', padding: 0 }}
                        >
                          {formatTime(currentPageData.page_supplement.timestamp_start)} - {formatTime(currentPageData.page_supplement.timestamp_end)}
                        </button>
                      </div>
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6',
                        opacity: translationEnabled && !translatedTexts.get(currentPage)?.supplement ? 0.4 : 1,
                        transition: 'opacity 0.2s',
                      }}>
                        {translationEnabled && translatedTexts.get(currentPage)?.supplement
                          ? translatedTexts.get(currentPage)!.supplement!
                          : currentPageData.page_supplement.content}
                      </p>
                    </div>
                  </div>
                )}

              </div>
            ) : noteMode === 'transcript' ? (
              /* Transcript mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div className="mb-3" style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '20px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                    TRANSCRIPT
                  </span>
                  {transcriptClickCount < 2 && (
                    <span style={{ fontSize: '10px', color: C.muted, opacity: 0.7 }}>
                      点击句子播放，再次点击停止
                    </span>
                  )}
                </div>
                {currentPageData?.aligned_segments && currentPageData.aligned_segments.length > 0 ? (
                  currentPageData.aligned_segments.map((seg, i) => (
                    <div
                      key={i}
                      onClick={() => handleSegmentPlay(seg, i)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '10px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        background: playingSegIdx === i ? 'rgba(85,107,47,0.08)' : 'transparent',
                        transition: 'background 120ms',
                        borderLeft: playingSegIdx === i ? '2px solid #6B7F3A' : '2px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (playingSegIdx !== i) (e.currentTarget as HTMLDivElement).style.background = 'rgba(175,179,176,0.12)'
                      }}
                      onMouseLeave={(e) => {
                        if (playingSegIdx !== i) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                      }}
                    >
                      {/* 时间戳胶囊：播放时从左向右绿色填充，文字跟随变白 */}
                      {playingSegIdx === i ? (
                        <span
                          style={{
                            flexShrink: 0,
                            position: 'relative',
                            display: 'inline-flex',
                            alignItems: 'center',
                            fontSize: '11px',
                            fontWeight: '600',
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: '36px',
                            height: '20px',
                            alignSelf: 'flex-start',
                            marginTop: '2px',
                            borderRadius: '999px',
                            border: '1.5px solid #6B7F3A',
                            padding: '0 6px',
                            overflow: 'hidden',
                          }}
                        >
                          {/* 绿色填充背景 */}
                          <span
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, bottom: 0,
                              width: `${playProgress * 100}%`,
                              background: '#6B7F3A',
                              transition: 'width 80ms linear',
                              borderRadius: '999px',
                            }}
                          />
                          {/* 底层：绿色文字（填充区右侧可见） */}
                          <span style={{ position: 'relative', color: '#6B7F3A', zIndex: 1 }}>
                            {formatTime(seg.start)}
                          </span>
                          {/* 顶层：白色文字，clip 到填充宽度内 */}
                          <span
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, bottom: 0, right: 0,
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: '6px',
                              color: 'white',
                              fontSize: '11px',
                              fontWeight: '600',
                              fontVariantNumeric: 'tabular-nums',
                              clipPath: `inset(0 ${(1 - playProgress) * 100}% 0 0)`,
                              transition: 'clip-path 80ms linear',
                              zIndex: 2,
                              pointerEvents: 'none',
                            }}
                          >
                            {formatTime(seg.start)}
                          </span>
                        </span>
                      ) : (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '11px',
                            color: '#D0CFC5',
                            fontWeight: '600',
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: '36px',
                            marginTop: '2px',
                            lineHeight: 1.6,
                          }}
                        >
                          {formatTime(seg.start)}
                        </span>
                      )}
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0, flex: 1 }}>
                        {seg.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>{t('notes_no_transcript')}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Bottom: drawer chat (My Notes / AI Notes) */}
          {noteMode !== 'transcript' && (() => {
            const pageChat = getPageChat(currentPage)
            const drawerHeight = drawerPhase === 'full'
              ? (drawerHeightPx != null ? `${drawerHeightPx}px` : '80%')
              : drawerPhase === 'input' ? '210px' : '0px'
            const models = [
              { id: 'Auto', label: 'Auto', logo: '✦', cls: 'logo-auto' },
              { id: 'Sonnet 4.6', label: 'Sonnet 4.6', logo: '✦', cls: 'logo-claude' },
              { id: 'Opus 4.6', label: 'Opus 4.6', logo: '✦', cls: 'logo-claude' },
              { id: 'Gemini 3.1 Pro', label: 'Gemini 3.1 Pro', logo: 'G', cls: 'logo-gemini' },
              { id: 'GPT-5.2', label: 'GPT-5.2', logo: 'G', cls: 'logo-gpt' },
              { id: 'GPT-5.4', label: 'GPT-5.4', logo: 'G', cls: 'logo-gpt' },
            ]
            return (
              <>
                {/* Overlay: click to collapse drawer — relative to <aside> */}
                {drawerPhase !== 'closed' && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0,
                      bottom: drawerHeight,
                      zIndex: 25,
                      cursor: 'default',
                    }}
                    onClick={() => { setDrawerModelDDOpen(false); setDrawerPhase('closed') }}
                  />
                )}

                {/* Drawer panel — relative to <aside> */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0, right: 0, bottom: 0,
                    background: C.white,
                    borderRadius: '14px 14px 0 0',
                    boxShadow: drawerPhase !== 'closed' ? `0 -1px 0 ${C.divider}, 0 -10px 36px rgba(0,0,0,0.07)` : 'none',
                    zIndex: 30,
                    height: drawerHeight,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'height 0.42s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.2s ease',
                  }}
                >
                  {/* Drag handle — resize drawer height */}
                  <div
                    style={{
                      flexShrink: 0, height: '14px', cursor: 'ns-resize',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const startY = e.clientY
                      const aside = e.currentTarget.closest('aside') as HTMLElement | null
                      const asideH = aside?.getBoundingClientRect().height ?? 600
                      const startH = drawerHeightPx ?? (asideH * 0.8)
                      const onMove = (ev: MouseEvent) => {
                        const delta = startY - ev.clientY
                        const next = Math.min(Math.max(startH + delta, 180), asideH - 52)
                        setDrawerHeightPx(next)
                      }
                      const onUp = () => {
                        document.removeEventListener('mousemove', onMove)
                        document.removeEventListener('mouseup', onUp)
                      }
                      document.addEventListener('mousemove', onMove)
                      document.addEventListener('mouseup', onUp)
                    }}
                  >
                    <div style={{
                      width: '32px', height: '3px', borderRadius: '2px',
                      background: '#D0CFC5',
                    }} />
                  </div>
                  {/* Drawer top bar */}
                  <div style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px 9px',
                    borderBottom: `1px solid ${C.divider}`,
                    opacity: drawerPhase !== 'closed' ? 1 : 0,
                    transition: 'opacity 0.18s ease 0.1s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: '600', color: C.fg }}>
                      AI Chat
                      <span style={{
                        fontSize: '10px', fontWeight: '600', color: C.secondary,
                        background: C.sidebar, border: `1px solid ${C.divider}`,
                        borderRadius: '4px', padding: '1px 6px',
                      }}>
                        Page {currentPage}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDrawerPhase('closed') }}
                      style={{
                        width: '26px', height: '26px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', background: 'transparent', cursor: 'pointer', color: C.secondary,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>

                  {/* Chat history (only in full phase) */}
                  <div
                    ref={pageChatBottomRef}
                    style={{
                      flex: 1, overflowY: 'auto', padding: '12px 14px',
                      display: 'flex', flexDirection: 'column', gap: '8px',
                      opacity: drawerPhase === 'full' ? 1 : 0,
                      transition: 'opacity 0.22s ease',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {pageChat.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '86%', padding: '7px 11px', fontSize: '13px', lineHeight: '1.55',
                          borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          background: msg.role === 'user' ? C.fg : C.sidebar,
                          color: msg.role === 'user' ? C.white : C.fg,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {pageChatStreaming && pageChatStreamingText && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{
                          maxWidth: '86%', padding: '7px 11px', fontSize: '13px', lineHeight: '1.55',
                          borderRadius: '12px 12px 12px 2px', background: C.sidebar, color: C.fg, whiteSpace: 'pre-wrap',
                        }}>
                          {pageChatStreamingText}<span style={{ opacity: 0.5 }}>▋</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input area */}
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '10px 14px 14px',
                      opacity: drawerPhase !== 'closed' ? 1 : 0,
                      transform: drawerPhase !== 'closed' ? 'translateY(0)' : 'translateY(5px)',
                      transition: 'opacity 0.2s ease 0.14s, transform 0.2s ease 0.14s',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Context tag */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      background: C.sidebar, border: `1px solid ${C.divider}`,
                      borderRadius: '5px', padding: '2px 7px', fontSize: '11px', color: C.secondary,
                      marginBottom: '7px',
                    }}>
                      📄 Page {currentPage}
                    </div>

                    {/* Input box */}
                    <div style={{
                      border: `1.5px solid ${C.divider}`,
                      borderRadius: '10px',
                      padding: '8px 11px 6px',
                    }}>
                      <textarea
                        rows={1}
                        value={pageChatInput}
                        onChange={e => setPageChatInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            if (pageChatInput.trim()) {
                              handlePageChatSend()
                              setDrawerPhase('full')
                            }
                          }
                        }}
                        placeholder={t('notes_page_chat_placeholder')}
                        style={{
                          width: '100%', resize: 'none', border: 'none', outline: 'none',
                          background: 'transparent', fontSize: '13px', lineHeight: '1.5',
                          color: C.fg, fontFamily: 'inherit', maxHeight: '80px', overflowY: 'auto',
                          caretColor: '#798C00', display: 'block', minHeight: '34px',
                        }}
                      />

                      {/* Toolbar */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        paddingTop: '6px', borderTop: `1px solid ${C.divider}`, marginTop: '4px',
                      }}>
                        {/* Left: model picker */}
                        <div style={{ position: 'relative' }}>
                          <button
                            ref={drawerModelBtnRef}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDrawerModelDDOpen(v => !v) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                              color: C.secondary, background: C.sidebar, border: `1px solid ${C.divider}`,
                              cursor: 'pointer',
                            }}
                          >
                            {drawerModel}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>
                          {drawerModelDDOpen && (() => {
                            const rect = drawerModelBtnRef.current?.getBoundingClientRect()
                            return (
                              <div
                                onClick={e => e.stopPropagation()}
                                style={{
                                  position: 'fixed',
                                  bottom: rect ? window.innerHeight - rect.top + 6 : 'auto',
                                  left: rect ? rect.left : 0,
                                  width: '220px', background: C.white,
                                  borderRadius: '10px',
                                  boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
                                  padding: '5px 0', zIndex: 9999,
                                }}
                              >
                              {models.map((m, idx) => (
                                <div key={m.id}>
                                  {idx === 1 && <div style={{ height: '1px', background: C.divider, margin: '3px 0' }} />}
                                  <div
                                    style={{
                                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                      padding: '8px 12px', cursor: 'pointer',
                                    }}
                                    onClick={() => { setDrawerModel(m.id); setDrawerModelDDOpen(false) }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.sidebar}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                      <div style={{
                                        width: '20px', height: '20px', borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: m.cls === 'logo-gemini' || m.cls === 'logo-gpt' ? '9px' : '11px',
                                        fontWeight: '700', color: '#fff',
                                        background: m.cls === 'logo-auto'
                                          ? 'linear-gradient(135deg,#EAE9E0,#D0CFC5)'
                                          : m.cls === 'logo-claude' ? '#d97757'
                                          : m.cls === 'logo-gemini' ? 'linear-gradient(135deg,#4285f4,#ea4335,#fbbc05,#34a853)'
                                          : '#10a37f',
                                        ...(m.cls === 'logo-auto' ? { color: '#798C00' } : {}),
                                      }}>
                                        {m.logo}
                                      </div>
                                      <span style={{ fontSize: '13px', color: C.fg }}>
                                        {m.label}
                                        {idx > 0 && (
                                          <span style={{
                                            fontSize: '10px', color: '#798C00',
                                            background: 'rgba(121,140,0,0.10)',
                                            borderRadius: '4px', padding: '1px 5px', marginLeft: '5px', fontWeight: '500',
                                          }}>Beta</span>
                                        )}
                                      </span>
                                    </div>
                                    {drawerModel === m.id && (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#798C00" strokeWidth="2.5" strokeLinecap="round">
                                        <polyline points="20 6 9 17 4 12"/>
                                      </svg>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            )
                          })()}
                        </div>

                        {/* Right: mic + send */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button type="button" style={{
                            width: '26px', height: '26px', borderRadius: '5px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted,
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <rect x="9" y="2" width="6" height="11" rx="3"/>
                              <path d="M5 10a7 7 0 0 0 14 0"/>
                              <line x1="12" y1="19" x2="12" y2="22"/>
                              <line x1="9" y1="22" x2="15" y2="22"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (pageChatInput.trim()) {
                                handlePageChatSend()
                                setDrawerPhase('full')
                              }
                            }}
                            disabled={pageChatStreaming || !pageChatInput.trim()}
                            style={{
                              width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                              background: pageChatStreaming || !pageChatInput.trim() ? C.muted : '#798C00',
                              color: C.white,
                              cursor: pageChatStreaming || !pageChatInput.trim() ? 'default' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'background 0.15s',
                            }}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Collapsed capsule — bottom bar, always in flow */}
                <div
                  style={{
                    flexShrink: 0,
                    borderTop: `1px solid ${C.divider}`,
                    padding: '10px 14px 16px',
                    opacity: drawerPhase === 'closed' ? 1 : 0,
                    pointerEvents: drawerPhase === 'closed' ? 'auto' : 'none',
                    transition: 'opacity 0.15s ease',
                  }}
                >
                  <div
                    onClick={() => setDrawerPhase('input')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '9px',
                      background: C.sidebar, border: `1px solid ${C.divider}`,
                      borderRadius: '14px', padding: '9px 14px', cursor: 'text',
                    }}
                  >
                    <div style={{
                      width: '17px', height: '17px', borderRadius: '50%', flexShrink: 0,
                      background: 'conic-gradient(from 0deg, #798C00, #b5c833, #798C00)',
                    }} />
                    <span style={{ fontSize: '13px', color: C.muted }}>Ask AI about this page…</span>
                  </div>
                </div>
              </>
            )
          })()}
        </aside>
      </div>

      {/* Global Footer */}
      <footer
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          height: '40px',
          background: C.bg,
          borderTop: '1px solid rgba(175,179,176,0.1)',
          color: '#D0CFC5',
          fontSize: '11px',
        }}
      >
        LiberStudy · {new Date().getFullYear()}
      </footer>

      {/* Copy toast */}
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-12 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg z-50"
          style={{ background: C.fg, color: C.white }}
        >
          已复制到剪贴板
        </div>
      )}

      {/* Audio player (hidden, driven by timestamp clicks) */}
      {session?.audio_url && (
        <audio ref={audioRef} src={`${API_BASE}${session.audio_url}`} preload="metadata" style={{ display: 'none' }} />
      )}

      {/* Upload overlay — shown when no session yet */}
      {pagePhase === 'upload' && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 50, backgroundColor: 'rgba(20, 24, 22, 0.6)' }}>
          <NewClassModal onUploadSuccess={handleUploadSuccess} onClose={() => navigate('/')} />
        </div>
      )}
    </div>
  )
}
