import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import { getSession } from '../lib/api'
import ThreeColumnLayout from '../components/ThreeColumnLayout'
import OutlineNav from '../components/OutlineNav'
import PillToggle from '../components/PillToggle'
import TemplateSelector, { type Template, type Granularity } from '../components/TemplateSelector'
import PassiveNotes from '../components/PassiveNotes'
import ActiveNotes from '../components/ActiveNotes'
import AudioPlayer from '../components/AudioPlayer'

interface Bullet { text: string; ai_comment: string; timestamp: number }
interface PageData {
  page_num: number
  slide_image_url: string
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

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
  const [template, setTemplate] = useState<Template>('outline')
  const [granularity, setGranularity] = useState<Granularity>('detailed')
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">加载笔记中…</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error ?? '未知错误'}</p>
          <button onClick={() => window.location.reload()} className="text-indigo-500 underline text-sm">
            重试
          </button>
        </div>
      </div>
    )
  }

  const currentPageData = session.pages.find((p) => p.page_num === currentPage)

  return (
    <>
    <ThreeColumnLayout
      left={
        <OutlineNav
          slides={session.pages.map((p) => ({ pageNum: p.page_num, slideImageUrl: `${API_BASE}${p.slide_image_url}` }))}
          currentPage={currentPage}
          onPageClick={(n) => setScrollToPage(n)}
        />
      }
      center={
        <div>
          {/* Top bar */}
          <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/90 backdrop-blur border-b border-gray-100">
            <span className="text-sm font-medium text-gray-700 flex-1 truncate">{session.ppt_filename}</span>
            <button onClick={handleExportMarkdown} className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
              导出 MD
            </button>
          </div>

          {/* Slides */}
          <div className="p-6 space-y-8">
            {session.pages.map((page) => (
              <div
                key={page.page_num}
                data-page={page.page_num}
                ref={(el) => {
                  if (el) pageRefs.current.set(page.page_num, el)
                  else pageRefs.current.delete(page.page_num)
                }}
                className="relative rounded-xl shadow-md overflow-hidden border border-gray-200"
              >
                <img
                  src={`${API_BASE}${page.slide_image_url}`}
                  alt={`第${page.page_num}页`}
                  className="w-full block"
                />
                {/* Confidence warning */}
                {page.alignment_confidence < 0.6 && (
                  <div className="absolute top-2 right-2 bg-amber-400 text-white text-xs px-2 py-0.5 rounded-full">
                    ⚠️ 对齐置信度低
                  </div>
                )}
                {/* Page num + play button */}
                <div className="absolute top-2 left-2 flex items-center gap-2">
                  <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded">
                    {page.page_num}
                  </span>
                  <button
                    onClick={() => handleTimestampClick(page.page_start_time)}
                    className="bg-indigo-500/80 hover:bg-indigo-600 text-white text-xs px-2 py-0.5 rounded"
                  >
                    ▶ 播放原录音
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      right={
        <div className="flex flex-col h-full">
          {/* Right panel header */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <PillToggle value={noteMode} onChange={setNoteMode} />
              <button
                onClick={handleCopyPage}
                className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-1"
                title="复制当前页笔记"
              >
                复制
              </button>
            </div>
            {noteMode === 'ai' && (
              <TemplateSelector
                template={template}
                granularity={granularity}
                onTemplateChange={setTemplate}
                onGranularityChange={setGranularity}
              />
            )}
          </div>

          {/* Notes content */}
          <div className="flex-1 overflow-y-auto p-4">
            {currentPageData ? (
              noteMode === 'my' ? (
                currentPageData.active_notes ? (
                  <ActiveNotes data={currentPageData.active_notes} granularity={granularity} />
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">本页没有课堂批注</p>
                )
              ) : (
                currentPageData.passive_notes ? (
                  <PassiveNotes
                    data={currentPageData.passive_notes}
                    pageSupplement={currentPageData.page_supplement}
                    onTimestampClick={handleTimestampClick}
                    granularity={granularity}
                  />
                ) : (
                  // partial_ready: failed page
                  <div className="text-center py-8">
                    <p className="text-xs text-red-400 mb-3">该页笔记生成失败</p>
                    <button className="text-xs bg-red-50 border border-red-200 text-red-500 rounded-lg px-4 py-2 hover:bg-red-100">
                      点击重试
                    </button>
                  </div>
                )
              )
            ) : (
              <p className="text-xs text-gray-400 text-center py-8">请选择一个页面</p>
            )}
          </div>

          {/* Audio player */}
          <AudioPlayer
            src={`${API_BASE}${session.audio_url}`}
            seekTo={seekTo}
          />
        </div>
      }
    />

    {/* Copy toast */}
    {copyToast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
        已复制到剪贴板
      </div>
    )}
    </>
  )
}
