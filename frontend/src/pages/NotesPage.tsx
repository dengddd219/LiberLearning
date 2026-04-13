import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import { getSession } from '../lib/api'

interface Bullet { text: string; ai_comment: string; timestamp_start: number; timestamp_end: number }
interface PageData {
  page_num: number
  pdf_url: string
  pdf_page_num: number
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[] } | null
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const FONT_SERIF = "'Lora', Georgia, serif"
const FONT_SANS  = "'Inter', system-ui, sans-serif"
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

// Mock data for UI demonstration
const MOCK_ACTIVE_ANNOTATIONS = [
  {
    time: '12:34',
    note: '这里老师说的冷启动问题是关键——当物品没有任何历史交互时，协同过滤完全失效。',
    aiComment: '冷启动（Cold Start）是推荐系统的经典难题。物品冷启动指新物品上线时缺乏用户行为数据，无法通过协同过滤建立相似度矩阵。常见解法包括：基于内容的特征匹配、利用物品属性标签进行初始推荐、以及混合模型（Hybrid Model）在数据积累早期兜底。',
  },
  {
    time: '18:47',
    note: '用户冷启动和物品冷启动要分开处理策略。',
    aiComment: '用户冷启动侧重于新用户画像建立，通常通过注册引导（兴趣问卷）、设备/地域信号等显性或隐性信息快速构建初始偏好向量；物品冷启动则侧重于新内容的曝光策略，如流量池机制（小红书的多层审核流量池）。两者在技术上虽有交叉，但产品策略差异显著。',
  },
]

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
  const [seekTo, setSeekTo] = useState<number | null>(null)
  const [copyToast, setCopyToast] = useState(false)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (!sessionId) return
    getSession(sessionId)
      .then((data) => { setSession(data as SessionData); setLoading(false) })
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
    setSeekTo(seconds)
    setTimeout(() => setSeekTo(null), 200)
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

  // Build mock slides for sidebar (use real data)
  const slides = session.pages.map((p) => ({
    pageNum: p.page_num,
    pdfUrl: `${API_BASE}${p.pdf_url}`,
    pdfPageNum: p.pdf_page_num,
  }))

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: FONT_SERIF }}>

      {/* TopAppBar */}
      <header
        className="flex items-center justify-between px-6 flex-shrink-0 z-30"
        style={{
          height: '64px',
          background: 'rgba(240,239,234,0.85)',
          backdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(175,179,176,0.1)',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
        }}
      >
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-6">
          <span className="font-bold" style={{ fontSize: '20px', color: C.fg }}>LiberStudy</span>
          <nav className="flex items-center gap-1">
            {['Dashboard', 'Courses', 'Detailed Note'].map((item) => (
              <button
                key={item}
                className="px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all duration-150"
                style={{
                  color: item === 'Courses' ? C.fg : C.muted,
                  fontWeight: item === 'Courses' ? '500' : '400',
                  background: item === 'Courses' ? 'rgba(175,179,176,0.1)' : 'transparent',
                }}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: Bell + Avatar */}
        <div className="flex items-center gap-3">
          <button className="cursor-pointer transition-all duration-150 p-1.5 rounded-lg hover:bg-black/5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke=C.muted strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <div
            className="rounded-full flex items-center justify-center cursor-pointer"
            style={{ width: '32px', height: '32px', background: C.dark, color: C.white, fontSize: '13px', fontWeight: '600' }}
          >
            U
          </div>
        </div>
      </header>

      {/* Main body (below TopAppBar) */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '64px' }}>

        {/* Left sidebar: Lecture Slides */}
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
            <button className="cursor-pointer transition-all duration-150 opacity-60 hover:opacity-100">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          {/* Slide thumbnails */}
          <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {slides.map((slide) => {
              const isActive = slide.pageNum === currentPage
              return (
                <div
                  key={slide.pageNum}
                  onClick={() => setScrollToPage(slide.pageNum)}
                  className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center"
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
                    {slide.pageNum}
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
                    {slide.pageNum}
                  </span>
                </div>
              )
            })}
          </div>
        </aside>

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
                onClick={() => currentPage > 1 && setScrollToPage(currentPage - 1)}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                disabled={currentPage <= 1}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="text-xs" style={{ color: C.muted }}>
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => currentPage < totalPages && setScrollToPage(currentPage + 1)}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                disabled={currentPage >= totalPages}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Center: Zoom */}
            <div className="flex items-center gap-2">
              <button className="cursor-pointer transition-all duration-150 w-6 h-6 flex items-center justify-center rounded hover:bg-black/5" style={{ color: C.secondary, fontSize: '16px' }}>−</button>
              <span className="text-xs" style={{ color: C.fg, minWidth: '36px', textAlign: 'center' }}>125%</span>
              <button className="cursor-pointer transition-all duration-150 w-6 h-6 flex items-center justify-center rounded hover:bg-black/5" style={{ color: C.secondary, fontSize: '16px' }}>+</button>
            </div>

            {/* Right: Download */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportMarkdown}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
                title="导出 Markdown"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          {/* Top: Pill toggle */}
          <div className="flex-shrink-0 px-6 pt-6 pb-4" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Pill */}
            <div
              className="flex items-center p-1"
              style={{ background: C.sidebar, borderRadius: '9999px' }}
            >
              <button
                onClick={() => setNoteMode('my')}
                className="flex-1 text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'my' ? '500' : '400',
                  background: noteMode === 'my' ? C.white : 'transparent',
                  color: noteMode === 'my' ? C.fg : C.muted,
                  boxShadow: noteMode === 'my' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                My Notes
              </button>
              <button
                onClick={() => setNoteMode('ai')}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'ai' ? '500' : '400',
                  background: noteMode === 'ai' ? C.white : 'transparent',
                  color: noteMode === 'ai' ? C.fg : C.muted,
                  boxShadow: noteMode === 'ai' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {noteMode === 'ai' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                )}
                AI Notes
                {noteMode === 'ai' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke=C.muted strokeWidth="2" strokeLinecap="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Notes content area */}
          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {/* Section label */}
            <div className="mb-4">
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                ACTIVE ANNOTATION
              </span>
            </div>

            {noteMode === 'my' ? (
              /* My Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {currentPageData?.active_notes ? (
                  <div>
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
                  MOCK_ACTIVE_ANNOTATIONS.map((ann, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ fontSize: '11px', color: '#AFB3B0', fontWeight: '500' }}>{ann.time}</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                      </div>
                      <p style={{ fontSize: '14px', color: C.fg, fontWeight: '500', lineHeight: '1.6' }}>
                        {ann.note}
                      </p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* AI Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {currentPageData?.active_notes ? (
                  <div>
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
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2">
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
                ) : (
                  MOCK_ACTIVE_ANNOTATIONS.map((ann, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ fontSize: '11px', color: '#AFB3B0', fontWeight: '500' }}>{ann.time}</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                      </div>
                      <p style={{ fontSize: '14px', color: C.fg, fontWeight: '500', lineHeight: '1.6', marginBottom: '12px' }}>
                        {ann.note}
                      </p>
                      {/* AI clarification block */}
                      <div style={{ borderLeft: '2px solid rgba(85,96,113,0.2)', paddingLeft: '16px' }}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke=C.secondary strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: C.secondary }}>
                            AI CLARIFICATION
                          </span>
                        </div>
                        <p style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6' }}>
                          {ann.aiComment}
                        </p>
                      </div>
                    </div>
                  ))
                )}

                {/* Passive notes bullets */}
                {currentPageData?.passive_notes && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        AI NOTES
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {currentPageData.passive_notes.bullets.map((bullet, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span style={{ color: '#AFB3B0', marginTop: '2px', flexShrink: 0 }}>•</span>
                          <button
                            onClick={() => handleTimestampClick(bullet.timestamp_start)}
                            className="text-left cursor-pointer transition-all duration-150"
                            style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6' }}
                          >
                            {bullet.text}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom input area */}
          <div
            className="flex-shrink-0 p-4"
            style={{ borderTop: '1px solid rgba(175,179,176,0.15)' }}
          >
            <div className="relative">
              <input
                type="text"
                placeholder="添加笔记…"
                className="w-full outline-none text-sm"
                style={{
                  borderRadius: '9999px',
                  padding: '12px 52px 12px 16px',
                  background: C.sidebar,
                  color: C.fg,
                  border: 'none',
                }}
              />
              <button
                onClick={handleCopyPage}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer transition-all duration-150"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  background: C.fg,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke=C.white strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
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
          className="fixed bottom-12 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg z-50"
          style={{ background: C.fg, color: C.white }}
        >
          已复制到剪贴板
        </div>
      )}

      {/* Hidden audio seek (preserve functionality) */}
      {seekTo !== null && (
        <audio style={{ display: 'none' }} />
      )}
    </div>
  )
}
