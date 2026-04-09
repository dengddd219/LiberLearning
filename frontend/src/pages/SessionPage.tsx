import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ThreeColumnLayout from '../components/ThreeColumnLayout'
import OutlineNav from '../components/OutlineNav'
import SlideCanvas from '../components/SlideCanvas'
import RecordingControl from '../components/RecordingControl'
import PageNotes from '../components/PageNotes'
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

export default function SessionPage() {
  const navigate = useNavigate()
  const [slides] = useState<SlideInfo[]>(MOCK_SLIDES)
  const [currentPage, setCurrentPage] = useState(1)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])
  const [hasPpt, setHasPpt] = useState(true) // demo mode: show slides by default
  const [submitting, setSubmitting] = useState(false)
  const [recoveryModal, setRecoveryModal] = useState(false)
  const recoverySessionRef = useRef<string | null>(null)

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
    setHasPpt(true)
    // In Phase B: call /api/parse-ppt and load real slides
  }, [])

  const handleRecordingStop = useCallback((chunks: Blob[]) => {
    setAudioChunks(chunks)
  }, [])

  const handleGenerateNotes = useCallback(async () => {
    setSubmitting(true)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioChunks.length > 0 ? new Blob(audioChunks) as unknown as File : undefined)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch {
      // fallback: use mock session
      navigate('/processing?session_id=mock-session-001')
    }
  }, [pptFile, audioChunks, navigate])

  const layout = hasPpt ? (
    <ThreeColumnLayout
      leftCollapsed={leftCollapsed}
      left={
        <OutlineNav
          slides={slides}
          currentPage={currentPage}
          onPageClick={handleNavClick}
        />
      }
      center={
        <div>
          {/* Top bar */}
          <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/90 backdrop-blur border-b border-gray-100">
            <button
              onClick={() => setLeftCollapsed((v) => !v)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-sm"
              title="折叠大纲"
            >
              {leftCollapsed ? '▶' : '◀'}
            </button>
            <span className="text-sm font-medium text-gray-700 flex-1">
              {pptFile?.name ?? '示例课件 — 计算机网络第三章.pptx'}
            </span>
            <FileUpload
              label="更换 PPT"
              hint=".ppt / .pptx / .pdf"
              onFile={handlePptUpload}
              uploaded={!!pptFile}
            />
          </div>
          <SlideCanvas
            slides={slides}
            annotations={annotations}
            sessionId={SESSION_ID}
            onCurrentPageChange={setCurrentPage}
            onAnnotationAdd={handleAnnotationAdd}
            scrollToPage={scrollToPage}
          />
        </div>
      }
      right={
        <div className="flex flex-col h-full">
          <RecordingControl sessionId={SESSION_ID} onStop={handleRecordingStop} />
          <PageNotes
            currentPage={currentPage}
            annotations={annotations}
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationDelete={handleAnnotationDelete}
          />
          {/* Generate button */}
          <div className="p-4 border-t border-gray-100">
            <button
              onClick={handleGenerateNotes}
              disabled={submitting}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors text-sm"
            >
              {submitting ? '提交中…' : '生成课堂笔记 →'}
            </button>
          </div>
        </div>
      }
    />
  ) : (
    // No-PPT mode: two-column layout
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-xl mx-auto">
          <h2 className="text-xl font-bold text-gray-800 mb-2">无 PPT 模式</h2>
          <p className="text-sm text-gray-500 mb-6">仅录音 + 自由文本笔记，生成按段落整理的结构化笔记</p>
          <FileUpload
            label="上传 PPT（可选）"
            hint=".ppt / .pptx / .pdf"
            onFile={handlePptUpload}
          />
        </div>
      </div>
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
        <RecordingControl sessionId={SESSION_ID} onStop={handleRecordingStop} />
        <div className="flex-1 p-4">
          <p className="text-sm text-gray-500 mb-2">自由笔记</p>
          <textarea
            className="w-full h-64 text-sm border border-gray-200 rounded-lg p-3 outline-none focus:border-indigo-400 resize-none"
            placeholder="在此记录笔记…"
          />
        </div>
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleGenerateNotes}
            disabled={submitting}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors text-sm"
          >
            {submitting ? '提交中…' : '生成课堂笔记 →'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {layout}

      {/* Recovery modal */}
      {recoveryModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-96 max-w-full">
            <h2 className="text-lg font-bold text-gray-900 mb-2">发现未完成的录音</h2>
            <p className="text-sm text-gray-500 mb-6">
              上次录音未完成，是否要恢复？
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setRecoveryModal(false)}
                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                继续录音
              </button>
              <button
                onClick={() => {
                  navigate(`/processing?session_id=${recoverySessionRef.current}`)
                }}
                className="w-full py-2.5 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
              >
                用现有录音生成笔记
              </button>
              <button
                onClick={async () => {
                  if (recoverySessionRef.current) {
                    await clearSession(recoverySessionRef.current)
                  }
                  setRecoveryModal(false)
                }}
                className="w-full py-2.5 text-red-500 text-sm hover:underline"
              >
                放弃录音（清除数据）
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
