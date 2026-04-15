import { useParams, useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import TranslationPopover from '../components/TranslationPopover'
import { getSession, retryPage } from '../lib/api'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useHighlights } from '../hooks/useHighlights'
import HighlightLayer from '../components/HighlightLayer'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

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
  bg: '#F0EFEA',
  sidebar: '#E8E7E2',
  fg: '#1A1916',
  secondary: '#6B6A64',
  muted: '#9B9A94',
  dark: '#3D3B35',
  white: '#FAFAF8',
  divider: '#E4E3DE',
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── ai-enhance-animation.tsx RevealText（原版，未改动）───
const SHIMMER_DURATION = 500  // ms

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

    el.classList.add('shimmer-text')

    const t = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
      el.style.color = highlight ? '#92400e' : muted ? '#9ca3af' : '#111827'
      el.style.backgroundImage = ''
      el.style.webkitTextFillColor = ''
      settledRef.current = true
    }, SHIMMER_DURATION)

    return () => clearTimeout(t)
  }, [revealed])

  return (
    <span ref={ref} style={{ color: 'transparent', display: 'inline' }}>
      {children}
    </span>
  )
}

// 每个词的揭开间隔（ms），模拟光波从左到右扫过
const WORD_REVEAL_INTERVAL = 35

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
}) {
  const hasComment = !!bullet.ai_comment
  const indent = bullet.level * 16

  // 把 ai_comment 按空格切成词组（保留空格作为分隔）
  const words = hasComment
    ? (bullet.ai_comment as string).split(/(\s+)/).filter(Boolean)
    : []

  // 每个词的揭开状态
  const [revealedCount, setRevealedCount] = useState(0)

  // 展开时逐词揭开，完成后通知父组件
  useEffect(() => {
    if (!expanded) {
      setRevealedCount(0)
      return
    }
    if (animationDone) return
    setRevealedCount(0)
    let i = 0
    const interval = setInterval(() => {
      i++
      setRevealedCount(i)
      if (i >= words.length) {
        clearInterval(interval)
        setTimeout(onAnimationDone, SHIMMER_DURATION + 100)
      }
    }, WORD_REVEAL_INTERVAL)
    return () => clearInterval(interval)
  }, [expanded])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: indent }}>
      {/* PPT 原文行 */}
      <button
        type="button"
        onClick={() => { if (hasComment) onToggle() }}
        className="text-left w-full transition-all duration-150"
        style={{
          background: 'none', border: 'none', padding: '4px 0',
          cursor: hasComment ? 'pointer' : 'default',
          display: 'flex', alignItems: 'flex-start', gap: '8px', userSelect: 'text',
        }}
      >
        <span style={{ color: '#AFB3B0', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
          {bullet.level === 0 ? '' : '•'}
        </span>
        <span style={{
          fontSize: bullet.level === 0 ? '15px' : '14px',
          color: '#1A1916', lineHeight: '1.625',
          fontWeight: bullet.level === 0 ? '600' : '500',
          opacity: translationEnabled && !translatedPptText ? 0.4 : (hasComment ? 1 : 0.5),
          transition: 'opacity 0.2s',
        }}>
          {translationEnabled && translatedPptText ? translatedPptText : bullet.ppt_text}
        </span>
        {hasComment && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
            style={{ flexShrink: 0, marginTop: '4px', color: '#9B9A94', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {/* AI 解释面板：条件渲染，animationDone 时直接显示固化文字跳过动画 */}
      {expanded && hasComment && (
        <div style={{ marginLeft: '18px', paddingLeft: '14px', borderLeft: '2px solid rgba(85,96,113,0.2)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z" fill="#556071" />
            </svg>
            <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: '#556071', textTransform: 'uppercase' }}>
              AI Clarification
            </span>
            {bullet.timestamp_start >= 0 && (
              <button type="button"
                onClick={(e) => { e.stopPropagation(); onTimestampClick(bullet.timestamp_start) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '9px', color: '#AFB3B0', fontWeight: '700', padding: 0, marginLeft: '4px' }}>
                {String(Math.floor(bullet.timestamp_start / 60)).padStart(2, '0')}:
                {String(Math.floor(bullet.timestamp_start % 60)).padStart(2, '0')}
              </button>
            )}
          </div>
          {/* 正文：animationDone=true 直接显示；否则逐词 shimmer 揭开 */}
          <p style={{ fontSize: '14px', lineHeight: '1.625', fontWeight: '400', margin: 0, userSelect: 'text',
            opacity: translationEnabled && !translatedAiComment ? 0.4 : 1,
            transition: 'opacity 0.2s',
          }}>
            {translationEnabled && translatedAiComment
              ? <span style={{ color: '#111827' }}>{translatedAiComment}</span>
              : animationDone
                ? <span style={{ color: '#111827' }}>{bullet.ai_comment}</span>
                : words.map((word, wi) => (
                    <RevealText key={wi} revealed={wi < revealedCount} muted={false} highlight={false}>
                      {word}
                    </RevealText>
                  ))
            }
          </p>
        </div>
      )}
    </div>
  )
}

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('ai')
  const [copyToast, setCopyToast] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)
  const [navVisible, setNavVisible] = useState(false)
  // 跨页持久化的展开状态：pageNum → Set<bulletIndex>
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  // 记录哪些 bullet 的 shimmer 动画已播完，跨页持久化，切回来直接显示文本
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const audioRef = useRef<HTMLAudioElement>(null)
  const wheelTimeoutRef = useRef<number | null>(null)

  // Highlight tool state
  const pageContainerRef = useRef<HTMLDivElement | null>(null)
  const [activeTool, setActiveTool] = useState<'highlight' | 'eraser' | null>(null)
  const [highlightColor, setHighlightColor] = useState('#FAFF00')
  const { addHighlight, removeHighlight, highlightsForPage } = useHighlights(sessionId ?? '')

  // Translation state
  const { enabled: translationEnabled, setEnabled: setTranslationEnabled, targetLang, setTargetLang, translate } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, {
    bullets: string[]
    aiComments: (string | null)[]
    supplement: string | null
    aiExpansion: string | null
  }>>(new Map())

  // Resizable panel state
  const [notesPanelWidth, setNotesPanelWidth] = useState(320)
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
        setCanvasWidth(Math.max(400, entry.contentRect.width - 192))
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

  useEffect(() => {
    if (!sessionId) return
    getSession(sessionId)
      .then((data) => {
        setSession(data as SessionData)
        openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
        setLoading(false)
      })
      .catch(() => { setError('无法加载笔记数据'); setLoading(false) })
  }, [sessionId])

  // Wheel翻页 handler
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (wheelTimeoutRef.current) return
    const direction = e.deltaY > 0 ? 1 : -1
    if (direction === 1 && currentPage < (session?.pages.length ?? 1)) {
      setCurrentPage(p => p + 1)
    } else if (direction === -1 && currentPage > 1) {
      setCurrentPage(p => p - 1)
    }
    wheelTimeoutRef.current = window.setTimeout(() => {
      wheelTimeoutRef.current = null
    }, 300)
  }, [currentPage, session?.pages.length])

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

  const handleTimestampClick = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds
      audioRef.current.play()
    }
  }, [])

  const handleCopyPage = useCallback(() => {
    if (!session) return
    const page = session.pages.find((p) => p.page_num === currentPage)
    if (!page) return
    const bullets = page.passive_notes?.bullets.map((b) => `• ${b.text}`).join('\n') ?? ''
    const text = `## 第 ${page.page_num} 页\n\n${bullets}`
    navigator.clipboard.writeText(text)
    setCopyToast(true)
    setTimeout(() => setCopyToast(false), 1500)
  }, [session, currentPage])

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
        page.passive_notes.bullets.forEach((b) => lines.push(`- ${b.text}`))
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
  }, [currentPage, translationEnabled, session])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: C.muted }}>加载笔记中…</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: C.secondary }}>{error ?? '未知错误'}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer transition-all duration-150"
            style={{ background: C.sidebar, color: C.fg }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  const currentPageData = session.pages.find((p) => p.page_num === currentPage)
  const totalPages = session.pages.length

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: FONT_SERIF }}>

      {/* Main body (below TopAppBar) */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '64px' }}>

        {/* Left hover nav: Lecture Slides */}
        <div
          className="relative flex-shrink-0"
          style={{ width: '8px', zIndex: 15 }}
          onMouseEnter={() => setNavVisible(true)}
          onMouseLeave={() => setNavVisible(false)}
        >
          {/* Trigger strip — always visible */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: '8px',
              background: C.fg,
              borderRadius: '4px 0 0 4px',
              cursor: 'ew-resize',
            }}
          />

          {/* Slide nav panel — hover to show */}
          <aside
            style={{
              position: 'absolute',
              top: 0,
              left: '8px',
              bottom: 0,
              width: navVisible ? '200px' : '0px',
              opacity: navVisible ? 1 : 0,
              transition: 'width 200ms ease, opacity 200ms ease',
              overflow: 'hidden',
              zIndex: 20,
            }}
          >
            <div
              className="h-full flex flex-col overflow-hidden"
              style={{ background: C.sidebar, width: '200px', borderRight: '1px solid rgba(175,179,176,0.1)' }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between flex-shrink-0 px-4"
                style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
              >
                <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.secondary }}>
                  LECTURE SLIDES
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.secondary, opacity: 0.6 }}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </div>

              {/* Thumbnails */}
              <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {session.pages.map((page) => {
                  const isActive = page.page_num === currentPage
                  return (
                    <button
                      type="button"
                      key={page.page_num}
                      onClick={() => { setCurrentPage(page.page_num); setNavVisible(false) }}
                      aria-label={`跳转到第 ${page.page_num} 张幻灯片`}
                      aria-current={isActive ? 'true' : undefined}
                      className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center w-full border-none p-0"
                      style={{
                        height: '80px',
                        borderRadius: '6px',
                        background: C.divider,
                        boxShadow: isActive
                          ? '0px 0px 0px 2px rgba(95,94,94,1)'
                          : '0 1px 3px rgba(0,0,0,0.08)',
                        opacity: isActive ? 1 : 0.7,
                      }}
                    >
                      <img
                        src={page.thumbnail_url
                          ? `${API_BASE}${page.thumbnail_url}`
                          : `${API_BASE}/api/sessions/${sessionId}/slide/${page.pdf_page_num}.png`}
                        alt={`第${page.page_num}页`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        loading="lazy"
                      />
                      <span
                        className="absolute top-1 left-1.5 flex items-center justify-center"
                        style={{
                          background: C.fg,
                          color: C.white,
                          fontSize: '8px',
                          fontWeight: '700',
                          borderRadius: '3px',
                          padding: '1px 5px',
                          minWidth: '16px',
                        }}
                      >
                        {page.page_num}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </aside>
        </div>

        {/* Center: PPT Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: C.bg }}>

          {/* PDF-style Toolbar */}
          <div
            className="flex items-center justify-between px-4 flex-shrink-0"
            style={{
              height: '48px',
              background: C.white,
              borderBottom: '1px solid rgba(175,179,176,0.15)',
              boxShadow: '0px 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            {/* Left: Navigation */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="上一页"
                onClick={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
                className="cursor-pointer transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-black/5 disabled:opacity-30 border-none bg-transparent"
                disabled={currentPage <= 1}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="text-xs" style={{ color: C.muted }}>
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                aria-label="下一页"
                onClick={() => currentPage < totalPages && setCurrentPage(currentPage + 1)}
                className="cursor-pointer transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-black/5 disabled:opacity-30 border-none bg-transparent"
                disabled={currentPage >= totalPages}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Right: Translate + Download */}
            <div className="flex items-center gap-2" style={{ position: 'relative' }}>
              {/* 翻译按钮 */}
              <button
                onClick={() => setPopoverOpen((v) => !v)}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
                title="翻译"
                style={{ color: translationEnabled ? '#1A1916' : '#9B9A94' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>

              {/* 翻译弹窗 */}
              {popoverOpen && (
                <TranslationPopover
                  enabled={translationEnabled}
                  targetLang={targetLang}
                  onTargetLangChange={setTargetLang}
                  onClose={() => setPopoverOpen(false)}
                  onTranslate={() => {
                    setTranslationEnabled(true)
                    setPopoverOpen(false)
                    translatePage(currentPage)
                  }}
                  onShowOriginal={() => {
                    setTranslationEnabled(false)
                    setPopoverOpen(false)
                  }}
                />
              )}

              {/* 导出按钮 */}
              <button
                onClick={handleExportMarkdown}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
                title="导出 Markdown"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Canvas area — single page with wheel navigation */}
          <div
            ref={canvasAreaRef}
            className="flex-1 flex items-center justify-center overflow-hidden"
            style={{ background: 'rgba(232,231,226,0.6)' }}
            onWheel={handleWheel}
          >
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
                          width={canvasWidth}
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
          style={{ width: `${notesPanelWidth}px`, background: C.white }}
        >
          {/* Detailed Note 入口 */}
          <div className="px-4 pt-3 pb-1 flex justify-end">
            <button
              onClick={() => navigate(`/notes/detail/${sessionId}`)}
              className="text-xs px-3 py-1 rounded-full cursor-pointer transition-all duration-150"
              style={{
                background: 'rgba(175,179,176,0.15)',
                color: '#556071',
                border: '1px solid rgba(175,179,176,0.2)',
              }}
            >
              Detailed Note →
            </button>
          </div>

          {/* Pill toggle */}
          <div className="flex-shrink-0 px-6 pt-4 pb-4">
            <div
              role="group"
              aria-label="笔记模式"
              className="flex items-center p-1"
              style={{ background: C.sidebar, borderRadius: '9999px' }}
            >
              {/* My Notes */}
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'my'}
                onClick={() => setNoteMode('my')}
                className="flex-1 flex items-center justify-center cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: '500',
                  background: noteMode === 'my' ? C.white : 'transparent',
                  color: noteMode === 'my' ? C.fg : C.muted,
                  boxShadow: noteMode === 'my' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  border: 'none',
                  fontSize: '12px',
                }}
              >
                My Notes
              </button>
              {/* AI Notes */}
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'ai'}
                onClick={() => setNoteMode('ai')}
                className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'ai' ? '600' : '500',
                  background: noteMode === 'ai' ? C.white : 'transparent',
                  color: noteMode === 'ai' ? C.fg : C.muted,
                  boxShadow: noteMode === 'ai' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  border: 'none',
                  fontSize: '12px',
                }}
              >
                {/* Left sparkle icon */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                    fill={noteMode === 'ai' ? C.fg : C.muted}
                  />
                </svg>
                AI Notes
                {/* Right sparkle icon — only when active */}
                {noteMode === 'ai' && (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                      fill={C.fg}
                    />
                  </svg>
                )}
              </button>
              {/* Transcript */}
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'transcript'}
                onClick={() => setNoteMode('transcript')}
                className="flex-1 flex items-center justify-center cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: '500',
                  background: noteMode === 'transcript' ? C.white : 'transparent',
                  color: noteMode === 'transcript' ? C.fg : C.muted,
                  boxShadow: noteMode === 'transcript' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  border: 'none',
                  fontSize: '12px',
                }}
              >
                Transcript
              </button>
            </div>
          </div>

          {/* Notes content area */}
          <div className="flex-1 overflow-y-auto px-6 pb-4">

            {noteMode === 'my' ? (
              /* My Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {currentPageData?.active_notes ? (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        ACTIVE ANNOTATION
                      </span>
                    </div>
                    {/* Timestamp row */}
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ fontSize: '11px', color: '#AFB3B0', fontWeight: '500' }}>
                        {formatTime(currentPageData.page_start_time)}
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                    </div>
                    <p style={{ fontSize: '14px', color: C.fg, fontWeight: '500', lineHeight: '1.6' }}>
                      {currentPageData.active_notes.user_note}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>该页暂无用户笔记</p>
                  </div>
                )}
              </div>
            ) : noteMode === 'ai' ? (
              /* AI Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Active notes (user note + AI expansion) */}
                {currentPageData?.active_notes ? (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        ACTIVE ANNOTATION
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ fontSize: '11px', color: '#AFB3B0', fontWeight: '500' }}>
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
                            fill="#556071"
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* No data at all */}
                {!currentPageData?.active_notes && !currentPageData?.passive_notes?.error && (!currentPageData?.passive_notes || currentPageData.passive_notes.bullets.length === 0) && (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>该页暂无 AI 笔记</p>
                  </div>
                )}

                {/* Page supplement (off-slide content) */}
                {currentPageData?.page_supplement && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        OFF-SLIDE CONTENT
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
                          style={{ color: '#AFB3B0', background: 'none', border: 'none', padding: 0 }}
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
                <div className="mb-3">
                  <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                    TRANSCRIPT
                  </span>
                </div>
                {currentPageData?.aligned_segments && currentPageData.aligned_segments.length > 0 ? (
                  currentPageData.aligned_segments.map((seg, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
                    >
                      <button
                        type="button"
                        onClick={() => handleTimestampClick(seg.start)}
                        style={{
                          flexShrink: 0,
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: '11px',
                          color: '#AFB3B0',
                          fontWeight: '600',
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: '36px',
                          textAlign: 'left',
                          marginTop: '2px',
                        }}
                      >
                        {formatTime(seg.start)}
                      </button>
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0 }}>
                        {seg.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>该页暂无转录文本</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Bottom: copy button */}
          <div
            className="flex-shrink-0 p-4"
            style={{ borderTop: '1px solid rgba(175,179,176,0.15)' }}
          >
            <button
              type="button"
              aria-label="复制当前页笔记"
              title="复制当前页笔记到剪贴板"
              onClick={handleCopyPage}
              className="w-full flex items-center justify-center gap-2 text-sm cursor-pointer transition-all duration-150 py-2.5 rounded-full"
              style={{
                background: C.sidebar,
                color: C.secondary,
                border: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制当前页笔记
            </button>
          </div>
        </aside>
      </div>

      {/* Global Footer */}
      <footer
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          height: '40px',
          background: C.bg,
          borderTop: '1px solid rgba(175,179,176,0.1)',
          color: '#AFB3B0',
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
      {session.audio_url && (
        <audio ref={audioRef} src={`${API_BASE}${session.audio_url}`} preload="metadata" style={{ display: 'none' }} />
      )}
    </div>
  )
}
