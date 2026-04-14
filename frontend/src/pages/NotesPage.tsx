import { useParams, useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import { getSession, retryPage } from '../lib/api'

interface Bullet { text: string; ai_comment: string; timestamp_start: number; timestamp_end: number }
interface PageData {
  page_num: number
  status?: string
  pdf_url: string
  pdf_page_num: number
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[]; error?: string } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
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

const FONT_SERIF = "'Lora', Georgia, serif"
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

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
  const [copyToast, setCopyToast] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const audioRef = useRef<HTMLAudioElement>(null)

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

  // Intersection observer for current page tracking
  useEffect(() => {
    if (!session) return
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0; let mostVisible = 1
        entries.forEach((entry) => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const p = Number(entry.target.getAttribute('data-page'))
            if (!isNaN(p)) mostVisible = p
          }
        })
        if (maxRatio > 0) setCurrentPage(mostVisible)
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i * 0.05) }
    )
    pageRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [session])

  useEffect(() => {
    if (scrollToPage == null) return
    const el = pageRefs.current.get(scrollToPage)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => setScrollToPage(null), 100)
  }, [scrollToPage])

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
      // Reload session data
      const data = await getSession(sessionId)
      setSession(data as SessionData)
    } catch {
      // keep current state
    } finally {
      setRetrying(null)
    }
  }, [sessionId, retrying])

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

        {/* Left sidebar: Lecture Slides */}
        {sidebarOpen && (
          <aside
            className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{ width: '200px', background: C.sidebar, borderRight: '1px solid rgba(175,179,176,0.1)' }}
          >
            {/* Sidebar header */}
            <div
              className="flex items-center justify-between flex-shrink-0 px-4"
              style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
            >
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.secondary }}>
                LECTURE SLIDES
              </span>
              <button
                type="button"
                aria-label="收起侧边栏"
                onClick={() => setSidebarOpen(false)}
                className="cursor-pointer transition-all duration-150 opacity-60 hover:opacity-100 min-w-[44px] min-h-[44px] flex items-center justify-center border-none bg-transparent p-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>

            {/* Slide thumbnails */}
            <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {session.pages.map((page) => {
                const isActive = page.page_num === currentPage
                return (
                  <button
                    type="button"
                    key={page.page_num}
                    onClick={() => setScrollToPage(page.page_num)}
                    aria-label={`跳转到第 ${page.page_num} 张幻灯片`}
                    aria-current={isActive ? 'true' : undefined}
                    className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center w-full border-none p-0"
                    style={{
                      height: '96px',
                      borderRadius: '6px',
                      background: C.divider,
                      boxShadow: isActive
                        ? '0px 0px 0px 2px rgba(95,94,94,1)'
                        : '0 1px 3px rgba(0,0,0,0.08)',
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    <span style={{ fontSize: '22px', fontWeight: '700', color: '#AFB3B0' }}>
                      {page.page_num}
                    </span>
                    {/* Page badge */}
                    <span
                      className="absolute top-1.5 left-1.5 flex items-center justify-center"
                      style={{
                        background: C.fg,
                        color: C.white,
                        fontSize: '9px',
                        fontWeight: '700',
                        borderRadius: '3px',
                        padding: '1px 5px',
                        minWidth: '18px',
                      }}
                    >
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
              {!sidebarOpen && (
                <button
                  type="button"
                  aria-label="展开侧边栏"
                  onClick={() => setSidebarOpen(true)}
                  className="cursor-pointer transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-black/5 border-none bg-transparent"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                aria-label="上一页"
                onClick={() => currentPage > 1 && setScrollToPage(currentPage - 1)}
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
                onClick={() => currentPage < totalPages && setScrollToPage(currentPage + 1)}
                className="cursor-pointer transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-black/5 disabled:opacity-30 border-none bg-transparent"
                disabled={currentPage >= totalPages}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Right: Download */}
            <div className="flex items-center gap-2">
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

          {/* Canvas area */}
          <div className="flex-1 overflow-y-auto p-12" style={{ background: 'rgba(232,231,226,0.6)' }}>
            <div className="flex flex-col items-center gap-8 max-w-4xl mx-auto">
              {session.pages.map((page) => (
                <div
                  key={page.page_num}
                  data-page={page.page_num}
                  ref={(el) => {
                    if (el) pageRefs.current.set(page.page_num, el)
                    else pageRefs.current.delete(page.page_num)
                  }}
                  className="relative w-full"
                  style={{ maxWidth: '896px' }}
                >
                  {/* Slide card */}
                  <div
                    className="relative w-full rounded-lg overflow-hidden"
                    style={{
                      background: C.white,
                      boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                    }}
                  >
                    <embed
                      src={`${API_BASE}${page.pdf_url}#page=${page.pdf_page_num}`}
                      type="application/pdf"
                      style={{ width: '100%', minHeight: '500px', display: 'block' }}
                      title={`第${page.page_num}页`}
                    />
                    {/* Confidence warning */}
                    {page.alignment_confidence < 0.6 && (
                      <div
                        className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: '#F59E0B', color: C.white }}
                      >
                        对齐置信度低
                      </div>
                    )}
                    {/* Play button */}
                    <button
                      onClick={() => handleTimestampClick(page.page_start_time)}
                      className="absolute top-3 left-3 text-xs px-2 py-0.5 rounded cursor-pointer transition-all duration-150"
                      style={{ background: 'rgba(47,51,49,0.7)', color: C.white }}
                    >
                      ▶ {formatTime(page.page_start_time)}
                    </button>
                    {/* Slide label bottom-right */}
                    <div
                      className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
                    >
                      SLIDE {String(page.page_num).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* Right panel: Notes */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: '320px', background: C.white, borderLeft: '1px solid rgba(175,179,176,0.1)' }}
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
          {/* Top: Pill toggle */}
          <div className="flex-shrink-0 px-6 pt-6 pb-4" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Pill */}
            <div
              role="group"
              aria-label="笔记模式"
              className="flex items-center p-1"
              style={{ background: C.sidebar, borderRadius: '9999px' }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'my'}
                onClick={() => setNoteMode('my')}
                className="flex-1 text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'my' ? '500' : '400',
                  background: noteMode === 'my' ? C.white : 'transparent',
                  color: noteMode === 'my' ? C.fg : C.muted,
                  boxShadow: noteMode === 'my' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  border: 'none',
                }}
              >
                My Notes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'ai'}
                onClick={() => setNoteMode('ai')}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'ai' ? '500' : '400',
                  background: noteMode === 'ai' ? C.white : 'transparent',
                  color: noteMode === 'ai' ? C.fg : C.muted,
                  boxShadow: noteMode === 'ai' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  border: 'none',
                }}
              >
                {noteMode === 'ai' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                )}
                AI Notes
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
            ) : (
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
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: C.secondary }}>
                          AI CLARIFICATION
                        </span>
                      </div>
                      <p style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6' }}>
                        {currentPageData.active_notes.ai_expansion}
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

                {/* Passive notes bullets */}
                {currentPageData?.passive_notes && currentPageData.passive_notes.bullets.length > 0 && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        AI NOTES
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {currentPageData.passive_notes.bullets.map((bullet, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div className="flex items-start gap-2">
                            <span style={{ color: '#AFB3B0', marginTop: '2px', flexShrink: 0 }}>•</span>
                            <button
                              onClick={() => handleTimestampClick(bullet.timestamp_start)}
                              className="text-left cursor-pointer transition-all duration-150 hover:opacity-70"
                              style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6', background: 'none', border: 'none', padding: 0 }}
                            >
                              {bullet.text}
                            </button>
                          </div>
                          {bullet.ai_comment && (
                            <div style={{ marginLeft: '18px', paddingLeft: '10px', borderLeft: '2px solid rgba(175,179,176,0.2)' }}>
                              <p style={{ fontSize: '12px', color: C.secondary, lineHeight: '1.5' }}>
                                {bullet.ai_comment}
                              </p>
                            </div>
                          )}
                        </div>
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
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6' }}>
                        {currentPageData.page_supplement.content}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
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
