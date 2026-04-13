import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SlideCanvas from '../components/SlideCanvas'
import RecordingControl from '../components/RecordingControl'
import FileUpload from '../components/FileUpload'
import { getIncompleteSession, saveSession, clearSession } from '../lib/idb'
import { uploadFiles } from '../lib/api'

interface Annotation {
  id: string
  pageNum: number
  text: string
  yPosition: number
  timestamp: number
}

interface SlideInfo {
  pageNum: number
  slideImageUrl: string
}

const SESSION_ID = `session-${Date.now()}`

// Mock slides until PPT is uploaded
const MOCK_SLIDES: SlideInfo[] = [
  { pageNum: 1, slideImageUrl: '/slides/slide_001.png' },
  { pageNum: 2, slideImageUrl: '/slides/slide_002.png' },
  { pageNum: 3, slideImageUrl: '/slides/slide_003.png' },
]

function useRecordingTimer(isRecording: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setElapsed(0)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isRecording])

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function SessionPage() {
  const navigate = useNavigate()
  const [slides] = useState<SlideInfo[]>(MOCK_SLIDES)
  const [currentPage, setCurrentPage] = useState(1)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])
  const [hasPpt] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [recoveryModal, setRecoveryModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('my')
  const [noteInput, setNoteInput] = useState('')
  const recoverySessionRef = useRef<string | null>(null)
  const recTimer = useRecordingTimer(isRecording)
  const totalPages = slides.length

  // Check for incomplete session on mount
  useEffect(() => {
    getIncompleteSession().then((session) => {
      if (session) {
        recoverySessionRef.current = session.id
        setRecoveryModal(true)
      }
    })
  }, [])

  // beforeunload: persist state
  useEffect(() => {
    const handler = () => {
      saveSession({
        id: SESSION_ID,
        status: 'recording',
        pptFileName: pptFile?.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pptFile])

  const handleAnnotationAdd = useCallback((ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann])
  }, [])

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleNavClick = useCallback((pageNum: number) => {
    setScrollToPage(pageNum)
    setTimeout(() => setScrollToPage(null), 100)
  }, [])

  const handlePptUpload = useCallback((file: File) => {
    setPptFile(file)
  }, [])

  const handleRecordingStop = useCallback((chunks: Blob[]) => {
    setAudioChunks(chunks)
    setIsRecording(false)
  }, [])

  const handleGenerateNotes = useCallback(async () => {
    setSubmitting(true)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioChunks.length > 0 ? new Blob(audioChunks) as unknown as File : undefined)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch {
      navigate('/processing?session_id=mock-session-001')
    }
  }, [pptFile, audioChunks, navigate])

  if (!hasPpt) {
    return (
      <div className="flex h-screen overflow-hidden" style={{ background: '#FAF9F7', fontFamily: 'Inter, sans-serif' }}>
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-xl mx-auto">
            <h2 className="text-xl font-bold mb-2" style={{ color: '#2F3331' }}>无 PPT 模式</h2>
            <p className="text-sm mb-6" style={{ color: '#777C79' }}>仅录音 + 自由文本笔记，生成按段落整理的结构化笔记</p>
            <FileUpload label="上传 PPT（可选）" hint=".ppt / .pptx / .pdf" onFile={handlePptUpload} />
          </div>
        </div>
        <div className="w-80 flex flex-col" style={{ background: '#FFFFFF', borderLeft: '1px solid rgba(175,179,176,0.1)' }}>
          <RecordingControl sessionId={SESSION_ID} onStop={handleRecordingStop} />
          <div className="flex-1 p-4">
            <p className="text-sm mb-2" style={{ color: '#777C79' }}>自由笔记</p>
            <textarea
              className="w-full h-64 text-sm rounded-lg p-3 outline-none resize-none"
              style={{ border: '1px solid rgba(175,179,176,0.3)', color: '#2F3331', background: '#FAF9F7' }}
              placeholder="在此记录笔记…"
            />
          </div>
          <div className="p-4" style={{ borderTop: '1px solid rgba(175,179,176,0.1)' }}>
            <button
              onClick={handleGenerateNotes}
              disabled={submitting}
              className="w-full py-3 rounded-xl font-medium text-sm cursor-pointer transition-all duration-150"
              style={{ background: '#5F5E5E', color: '#FFFFFF', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? '提交中…' : '生成课堂笔记 →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#FAF9F7', fontFamily: 'Inter, sans-serif' }}>

      {/* TopAppBar */}
      <header
        className="flex items-center justify-between px-6 flex-shrink-0 z-30"
        style={{
          height: '64px',
          background: 'rgba(250,249,247,0.8)',
          backdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(175,179,176,0.1)',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
        }}
      >
        <div className="flex items-center gap-6">
          <span className="font-bold" style={{ fontSize: '20px', color: '#2F3331' }}>LiberStudy</span>
          <nav className="flex items-center gap-1">
            {['Dashboard', 'Courses', 'Session'].map((item) => (
              <button
                key={item}
                className="px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all duration-150"
                style={{
                  color: item === 'Session' ? '#2F3331' : '#777C79',
                  fontWeight: item === 'Session' ? '500' : '400',
                  background: item === 'Session' ? 'rgba(175,179,176,0.1)' : 'transparent',
                }}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button className="cursor-pointer transition-all duration-150 p-1.5 rounded-lg hover:bg-black/5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777C79" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <div
            className="rounded-full flex items-center justify-center cursor-pointer"
            style={{ width: '32px', height: '32px', background: '#5F5E5E', color: '#FFFFFF', fontSize: '13px', fontWeight: '600' }}
          >
            U
          </div>
        </div>
      </header>

      {/* Main body */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '64px' }}>

        {/* Left sidebar: Lecture Slides */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: '200px', background: '#F3F4F1', borderRight: '1px solid rgba(175,179,176,0.1)' }}
        >
          <div
            className="flex items-center justify-between flex-shrink-0 px-4"
            style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
          >
            <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: '#556071' }}>
              LECTURE SLIDES
            </span>
            <button className="cursor-pointer transition-all duration-150 opacity-60 hover:opacity-100">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#556071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {slides.map((slide) => {
              const isActive = slide.pageNum === currentPage
              return (
                <div
                  key={slide.pageNum}
                  onClick={() => handleNavClick(slide.pageNum)}
                  className="relative cursor-pointer transition-all duration-150 overflow-hidden flex-shrink-0"
                  style={{
                    height: '96px',
                    borderRadius: '6px',
                    background: '#EDEEEB',
                    boxShadow: isActive
                      ? '0px 0px 0px 2px rgba(95,94,94,1)'
                      : '0 1px 3px rgba(0,0,0,0.08)',
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  <img src={slide.slideImageUrl} alt={`幻灯片 ${slide.pageNum}`} className="w-full h-full object-cover" />
                  <span
                    className="absolute top-1.5 left-1.5"
                    style={{
                      background: '#2F3331',
                      color: '#FFFFFF',
                      fontSize: '9px',
                      fontWeight: '700',
                      borderRadius: '3px',
                      padding: '1px 5px',
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
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#FAF9F7' }}>

          {/* Toolbar */}
          <div
            className="flex items-center justify-between px-4 flex-shrink-0"
            style={{
              height: '48px',
              background: '#FFFFFF',
              borderBottom: '1px solid rgba(175,179,176,0.15)',
              boxShadow: '0px 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => currentPage > 1 && handleNavClick(currentPage - 1)}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
                disabled={currentPage <= 1}
                style={{ opacity: currentPage <= 1 ? 0.3 : 1 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#556071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="text-xs" style={{ color: '#777C79' }}>{currentPage} / {totalPages}</span>
              <button
                onClick={() => currentPage < totalPages && handleNavClick(currentPage + 1)}
                className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
                disabled={currentPage >= totalPages}
                style={{ opacity: currentPage >= totalPages ? 0.3 : 1 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#556071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button className="cursor-pointer transition-all duration-150 w-6 h-6 flex items-center justify-center rounded hover:bg-black/5" style={{ color: '#556071', fontSize: '16px' }}>−</button>
              <span className="text-xs" style={{ color: '#2F3331', minWidth: '36px', textAlign: 'center' }}>100%</span>
              <button className="cursor-pointer transition-all duration-150 w-6 h-6 flex items-center justify-center rounded hover:bg-black/5" style={{ color: '#556071', fontSize: '16px' }}>+</button>
            </div>
            <div className="flex items-center gap-2">
              <FileUpload label="更换 PPT" hint=".ppt / .pptx / .pdf" onFile={handlePptUpload} uploaded={!!pptFile} />
            </div>
          </div>

          {/* Slide canvas */}
          <div className="flex-1 overflow-hidden" style={{ background: 'rgba(243,244,241,0.6)' }}>
            <SlideCanvas
              slides={slides}
              annotations={annotations}
              sessionId={SESSION_ID}
              onCurrentPageChange={setCurrentPage}
              onAnnotationAdd={handleAnnotationAdd}
              scrollToPage={scrollToPage}
            />
          </div>
        </main>

        {/* Right panel */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: '320px', background: '#FFFFFF', borderLeft: '1px solid rgba(175,179,176,0.1)' }}
        >
          {/* Recording status */}
          <div
            className="flex-shrink-0 flex items-center justify-between px-6"
            style={{ height: '52px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
          >
            <div className="flex items-center gap-2">
              {isRecording ? (
                <>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#EF4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.2)' }}
                  />
                  <span className="text-xs font-semibold" style={{ color: '#EF4444', letterSpacing: '0.05em' }}>REC</span>
                  <span className="text-xs font-mono" style={{ color: '#2F3331' }}>{recTimer}</span>
                </>
              ) : (
                <span className="text-xs" style={{ color: '#AFB3B0' }}>录音未开始</span>
              )}
            </div>
            <RecordingControl sessionId={SESSION_ID} onStop={handleRecordingStop} />
          </div>

          {/* Pill toggle */}
          <div className="flex-shrink-0 px-6 pt-5 pb-4">
            <div
              className="flex items-center p-1"
              style={{ background: '#F3F4F1', borderRadius: '9999px' }}
            >
              <button
                onClick={() => setNoteMode('my')}
                className="flex-1 text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
                style={{
                  borderRadius: '9999px',
                  fontWeight: noteMode === 'my' ? '500' : '400',
                  background: noteMode === 'my' ? '#FFFFFF' : 'transparent',
                  color: noteMode === 'my' ? '#2F3331' : '#777C79',
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
                  background: noteMode === 'ai' ? '#FFFFFF' : 'transparent',
                  color: noteMode === 'ai' ? '#2F3331' : '#777C79',
                  boxShadow: noteMode === 'ai' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                AI Notes
              </button>
            </div>
          </div>

          {/* Notes content */}
          <div className="flex-1 overflow-y-auto px-6 pb-4">
            <div className="mb-4">
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: '#777C79' }}>
                {noteMode === 'my' ? 'MY ANNOTATIONS' : 'AI NOTES'}
              </span>
            </div>

            {noteMode === 'my' ? (
              annotations.filter((a) => a.pageNum === currentPage).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {annotations
                    .filter((a) => a.pageNum === currentPage)
                    .map((ann) => (
                      <div key={ann.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <span style={{ fontSize: '11px', color: '#AFB3B0', fontWeight: '500' }}>
                            {new Date(ann.timestamp * 1000).toISOString().slice(14, 19)}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                          <button
                            onClick={() => handleAnnotationDelete(ann.id)}
                            className="cursor-pointer transition-all duration-150 opacity-40 hover:opacity-100"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#556071" strokeWidth="2" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                        <p style={{ fontSize: '14px', color: '#2F3331', fontWeight: '500', lineHeight: '1.6' }}>
                          {ann.text}
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-center" style={{ fontSize: '13px', color: '#AFB3B0', marginTop: '32px' }}>
                  本页还没有笔记
                  <br />
                  <span style={{ fontSize: '11px' }}>在幻灯片上点击可添加批注</span>
                </p>
              )
            ) : (
              <div
                className="flex items-center justify-center rounded-lg p-4"
                style={{ background: '#F3F4F1', marginTop: '8px' }}
              >
                <p style={{ fontSize: '13px', color: '#AFB3B0', textAlign: 'center' }}>
                  录音结束后生成 AI 笔记
                </p>
              </div>
            )}
          </div>

          {/* Bottom: Input + End Recording */}
          <div
            className="flex-shrink-0 p-4"
            style={{ borderTop: '1px solid rgba(175,179,176,0.15)', display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {/* Text input */}
            <div className="relative">
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="添加笔记…"
                className="w-full outline-none text-sm"
                style={{
                  borderRadius: '9999px',
                  padding: '12px 52px 12px 16px',
                  background: '#F3F4F1',
                  color: '#2F3331',
                  border: 'none',
                }}
              />
              <button
                onClick={() => setNoteInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer transition-all duration-150"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  background: '#2F3331',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>

            {/* End recording + Generate */}
            <button
              onClick={handleGenerateNotes}
              disabled={submitting}
              className="w-full py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-150"
              style={{
                background: '#5F5E5E',
                color: '#FFFFFF',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? '提交中…' : '结束录音 · 生成笔记'}
            </button>
          </div>
        </aside>
      </div>

      {/* Global Footer */}
      <footer
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          height: '40px',
          background: '#FAF9F7',
          borderTop: '1px solid rgba(175,179,176,0.1)',
          color: '#AFB3B0',
          fontSize: '11px',
        }}
      >
        LiberStudy · {new Date().getFullYear()}
      </footer>

      {/* Recovery modal */}
      {recoveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div
            className="w-96 max-w-full p-8 rounded-2xl"
            style={{ background: '#FFFFFF', boxShadow: '0 24px 64px rgba(0,0,0,0.15)' }}
          >
            <h2 className="text-lg font-bold mb-2" style={{ color: '#2F3331' }}>发现未完成的录音</h2>
            <p className="text-sm mb-6" style={{ color: '#777C79' }}>上次录音未完成，是否要恢复？</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => setRecoveryModal(false)}
                className="w-full py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-150"
                style={{ background: '#2F3331', color: '#FFFFFF' }}
              >
                继续录音
              </button>
              <button
                onClick={() => navigate(`/processing?session_id=${recoverySessionRef.current}`)}
                className="w-full py-2.5 rounded-lg text-sm cursor-pointer transition-all duration-150"
                style={{ border: '1px solid rgba(175,179,176,0.3)', color: '#2F3331', background: 'transparent' }}
              >
                用现有录音生成笔记
              </button>
              <button
                onClick={async () => {
                  if (recoverySessionRef.current) await clearSession(recoverySessionRef.current)
                  setRecoveryModal(false)
                }}
                className="w-full py-2.5 text-sm cursor-pointer transition-all duration-150"
                style={{ color: '#EF4444' }}
              >
                放弃录音（清除数据）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
