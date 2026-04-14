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
  const [hasPpt, setHasPpt] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [recoveryModal, setRecoveryModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('my')
  const [noteInput, setNoteInput] = useState('')
  const recoverySessionRef = useRef<string | null>(null)
  const recTimer = useRecordingTimer(isRecording)
  const totalPages = slides.length

  useEffect(() => {
    getIncompleteSession().then((session) => {
      if (session) {
        recoverySessionRef.current = session.id
        setRecoveryModal(true)
      }
    })
  }, [])

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
  }, [])

  const handleRecordingStop = useCallback((chunks: Blob[]) => {
    setAudioChunks(chunks)
    setIsRecording(false)
  }, [])

  const handleGenerateNotes = useCallback(async () => {
    setSubmitting(true)
    try {
      const audioBlob = audioChunks.length > 0 ? new Blob(audioChunks, { type: 'audio/webm' }) : undefined
      const audioFile = audioBlob ? new File([audioBlob], 'recording.webm', { type: 'audio/webm' }) : undefined
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch {
      setSubmitting(false)
      alert('上传失败，请重试')
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
    <div
      className="relative bg-stone-50 w-full min-h-screen flex flex-col"
    >
      {/* Top Navigation Bar - absolute positioned */}
      <div
        className="absolute flex justify-between items-center"
        style={{ top: 0, left: 0, right: 0, height: '64px', padding: '0 32px', background: 'rgba(250,249,247,0.8)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
      >
        <div className="flex justify-start items-center gap-8">
          <div className="flex flex-col justify-start items-start">
            <div className="justify-center text-zinc-800 text-xl font-bold font-['Inter'] leading-7" style={{ fontFamily: 'Inter, sans-serif' }}>LiberStudy</div>
          </div>
          <div className="flex justify-start items-center gap-6">
            <nav aria-label="主导航" className="flex justify-start items-center gap-6">
              <div className="flex flex-col justify-start items-start">
                <div className="justify-center text-slate-600 text-base font-normal font-['Inter'] leading-6" style={{ fontFamily: 'Inter, sans-serif' }}>Dashboard</div>
              </div>
              <div className="pb-1 border-b-2 border-zinc-600 flex flex-col justify-start items-start">
                <div className="justify-center text-zinc-800 text-base font-normal font-['Inter'] leading-6" style={{ fontFamily: 'Inter, sans-serif' }}>Courses</div>
              </div>
              <div className="flex flex-col justify-start items-start">
                <div className="justify-center text-slate-600 text-base font-normal font-['Inter'] leading-6" style={{ fontFamily: 'Inter, sans-serif' }}>Detailed Note</div>
              </div>
            </nav>
          </div>
        </div>
        <div className="flex justify-start items-center gap-4">
          <div className="flex flex-col justify-center items-center">
            <svg width="14" height="16" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 20C14.1667 20 13.4583 19.7083 12.875 19.125C12.2917 18.5417 12 17.8333 12 17C12 16.9 12.025 16.6667 12.075 16.3L5.05 12.2C4.78333 12.45 4.475 12.6458 4.125 12.7875C3.775 12.9292 3.4 13 3 13C2.16667 13 1.45833 12.7083 0.875 12.125C0.291667 11.5417 0 10.8333 0 10C0 9.16667 0.291667 8.45833 0.875 7.875C1.45833 7.29167 2.16667 7 3 7C3.4 7 3.775 7.07083 4.125 7.2125C4.475 7.35417 4.78333 7.55 5.05 7.8L12.075 3.7C12.0417 3.58333 12.0208 3.47083 12.0125 3.3625C12.0042 3.25417 12 3.13333 12 3C12 2.16667 12.2917 1.45833 12.875 0.875C13.4583 0.291667 14.1667 0 15 0C15.8333 0 16.5417 0.291667 17.125 0.875C17.7083 1.45833 18 2.16667 18 3C18 3.83333 17.7083 4.54167 17.125 5.125C16.5417 5.70833 15.8333 6 15 6C14.6 6 14.225 5.92917 13.875 5.7875C13.525 5.64583 13.2167 5.45 12.95 5.2L5.925 9.3C5.95833 9.41667 5.97917 9.52917 5.9875 9.6375C5.99583 9.74583 6 9.86667 6 10C6 10.1333 5.99583 10.2542 5.9875 10.3625C5.97917 10.4708 5.95833 10.5833 5.925 10.7L12.95 14.8C13.2167 14.55 13.525 14.3542 13.875 14.2125C14.225 14.0708 14.6 14 15 14C15.8333 14 16.5417 14.2917 17.125 14.875C17.7083 15.4583 18 16.1667 18 17C18 17.8333 17.7083 18.5417 17.125 19.125C16.5417 19.7083 15.8333 20 15 20ZM15 18C15.2833 18 15.5208 17.9042 15.7125 17.7125C15.9042 17.5208 16 17.2833 16 17C16 16.7167 15.9042 16.4792 15.7125 16.2875C15.5208 16.0958 15.2833 16 15 16C14.7167 16 14.4792 16.0958 14.2875 16.2875C14.0958 16.4792 14 16.7167 14 17C14 17.2833 14.0958 17.5208 14.2875 17.7125C14.4792 17.9042 14.7167 18 15 18ZM3 11C3.28333 11 3.52083 10.9042 3.7125 10.7125C3.90417 10.5208 4 10.2833 4 10C4 9.71667 3.90417 9.47917 3.7125 9.2875C3.52083 9.09583 3.28333 9 3 9C2.71667 9 2.47917 9.09583 2.2875 9.2875C2.09583 9.47917 2 9.71667 2 10C2 10.2833 2.09583 10.5208 2.2875 10.7125C2.47917 10.9042 2.71667 11 3 11ZM15 4C15.2833 4 15.5208 3.90417 15.7125 3.7125C15.9042 3.52083 16 3.28333 16 3C16 2.71667 15.9042 2.47917 15.7125 2.2875C15.5208 2.09583 15.2833 2 15 2C14.7167 2 14.4792 2.09583 14.2875 2.2875C14.0958 2.47917 14 2.71667 14 3C14 3.28333 14.0958 3.52083 14.2875 3.7125C14.4792 3.90417 14.7167 4 15 4Z" fill="#556071"/>
            </svg>
          </div>
          <div className="flex flex-col justify-center items-center">
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 12L0 6L6 0L7.4 1.4L2.825 6L7.4 10.6L6 12ZM12.6 12L6.6 6L12.6 0L14 1.4L9.425 6L14 10.6L12.6 12Z" fill="#556071"/>
            </svg>
          </div>
          <div className="w-8 h-8 bg-neutral-200 rounded-full inline-flex flex-col justify-start items-start overflow-hidden cursor-pointer">
            <img className="w-8 h-8 max-w-8 relative" src="https://placehold.co/32x32" />
          </div>
        </div>
      </div>

      {/* Main Content - centered with top padding for nav bar */}
      <div
        className="self-stretch flex justify-start items-start overflow-hidden"
        style={{ paddingTop: '64px', height: 'calc(100vh - 4rem)' }}
      >
        {/* Left Sidebar - Lecture Slides */}
        <div
          className="self-stretch flex flex-col justify-start items-start overflow-hidden"
          style={{ width: '192px', background: '#F3F4F1', borderRight: '1px solid rgba(175,179,176,0.1)' }}
        >
          <div
            className="self-stretch p-4 flex justify-between items-center"
            style={{ borderBottom: '1px solid rgba(175,179,176,0.1)' }}
          >
            <div className="flex flex-col justify-start items-start">
              <div className="justify-center text-slate-600 text-[10px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>LECTURE SLIDES</div>
            </div>
            <button className="cursor-pointer transition-all duration-150 p-1.5 rounded-2xl hover:bg-black/5">
              <svg width="7" height="5" viewBox="0 0 7 5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.5 4.31667L0 0.816667L0.816667 0L3.5 2.68333L6.18333 0L7 0.816667L3.5 4.31667Z" fill="#556071"/>
              </svg>
            </button>
          </div>
          <div className="self-stretch flex-1 p-3 flex flex-col justify-start items-start gap-4 overflow-hidden">
            {slides.map((slide, index) => {
              const isActive = slide.pageNum === currentPage
              return (
                <button
                  type="button"
                  key={slide.pageNum}
                  onClick={() => handleNavClick(slide.pageNum)}
                  aria-label={`跳转到第 ${slide.pageNum} 张幻灯片`}
                  aria-current={isActive ? 'true' : undefined}
                  className="w-full text-left self-stretch relative cursor-pointer transition-all duration-150 overflow-hidden flex flex-col justify-start items-start border-none bg-transparent p-0"
                  style={{
                    borderRadius: '6px',
                    background: isActive ? '#FFFFFF' : 'rgba(0,0,0,0)',
                    boxShadow: isActive
                      ? '0px 1px 2px 0px rgba(0,0,0,0.05), 0px 0px 0px 2px rgba(95,94,94,1)'
                      : '0px 1px 2px 0px rgba(0,0,0,0.05)',
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  <img className="self-stretch h-24 relative" src={slide.slideImageUrl || 'https://placehold.co/175x96'} alt={`Slide ${slide.pageNum}`} />
                  <div
                    className="px-1.5 absolute"
                    style={{ left: '4px', top: '4px', background: isActive ? '#2F3331' : '#556071', borderRadius: '3px' }}
                  >
                    <div className="justify-center text-white text-[10px] font-normal font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>
                      {String(slide.pageNum).padStart(2, '0')}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Center - PPT Canvas */}
        <div
          className="flex-1 self-stretch flex flex-col justify-start items-start overflow-hidden"
          style={{ background: '#FAF9F7' }}
        >
          {/* Toolbar */}
          <div
            className="self-stretch h-12 px-6 flex justify-between items-center"
            style={{ background: '#FFFFFF', boxShadow: '0px 1px 2px 0px rgba(0,0,0,0.05)', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
          >
            <div className="flex justify-start items-center gap-4">
              <div className="flex justify-start items-center gap-2">
                <button type="button" aria-label="下载幻灯片" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M8 12L3 7L4.4 5.55L7 8.15V0H9V8.15L11.6 5.55L13 7L8 12ZM2 16C1.45 16 0.979167 15.8042 0.5875 15.4125C0.195833 15.0208 0 14.55 0 14V11H2V14H14V11H16V14C16 14.55 15.8042 15.0208 15.4125 15.4125C15.0208 15.8042 14.55 16 14 16H2Z" fill="#556071"/>
                  </svg>
                </button>
                <button type="button" aria-label="添加批注" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M6 8H0V6H6V0H8V6H14V8H8V14H6V8Z" fill="#556071"/>
                  </svg>
                </button>
              </div>
              <div className="w-px h-6 bg-zinc-400/20" />
              <div className="flex justify-start items-center gap-2">
                <button type="button" aria-label="上一页" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M0 12V0L14.25 6L0 12ZM1.5 9.75L10.3875 6L1.5 2.25V4.875L6 6L1.5 7.125V9.75ZM1.5 9.75V6V2.25V4.875V7.125V9.75Z" fill="white"/>
                  </svg>
                </button>
                <button type="button" aria-label="下一页" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M0 12V0L14.25 6L0 12ZM1.5 9.75L10.3875 6L1.5 2.25V4.875L6 6L1.5 7.125V9.75ZM1.5 9.75V6V2.25V4.875V7.125V9.75Z" fill="white"/>
                  </svg>
                </button>
                <button type="button" aria-label="全屏" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M0 12V0L14.25 6L0 12ZM1.5 9.75L10.3875 6L1.5 2.25V4.875L6 6L1.5 7.125V9.75ZM1.5 9.75V6V2.25V4.875V7.125V9.75Z" fill="white"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex justify-start items-center gap-3">
              <button type="button" aria-label="缩小" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                <svg width="14" height="2" viewBox="0 0 14 2" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M0 2V0H14V2H0Z" fill="#556071"/>
                </svg>
              </button>
              <div className="flex flex-col justify-start items-start">
                <div className="justify-center text-zinc-800 text-xs font-medium font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>125%</div>
              </div>
              <button type="button" aria-label="放大" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10.5 4.66667L9.77083 3.0625L8.16667 2.33333L9.77083 1.60417L10.5 0L11.2292 1.60417L12.8333 2.33333L11.2292 3.0625L10.5 4.66667ZM10.5 12.8333L9.77083 11.2292L8.16667 10.5L9.77083 9.77083L10.5 8.16667L11.2292 9.77083L12.8333 10.5L11.2292 11.2292L10.5 12.8333ZM4.66667 11.0833L3.20833 7.875L0 6.41667L3.20833 4.95833L4.66667 1.75L6.125 4.95833L9.33333 6.41667L6.125 7.875L4.66667 11.0833ZM4.66667 8.25417L5.25 7L6.50417 6.41667L5.25 5.83333L4.66667 4.57917L4.08333 5.83333L2.82917 6.41667L4.08333 7L4.66667 8.25417Z" fill="#2F3331"/>
                </svg>
              </button>
            </div>
            <div className="flex justify-start items-center gap-2">
              <button type="button" aria-label="笔迹工具" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                <svg width="21" height="18" viewBox="0 0 21 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12.1 11L9.5 8.4L4.5 13.4L7.1 16L12.1 11ZM10.925 6.975L13.525 9.575L18.5 4.6L15.9 2L10.925 6.975ZM8.825 6.275L14.225 11.675L8.5 17.4C8.1 17.8 7.63333 18 7.1 18C6.56667 18 6.1 17.8 5.7 17.4L5.65 17.35L5 18H0L3.15 14.85L3.1 14.8C2.7 14.4 2.5 13.9333 2.5 13.4C2.5 12.8667 2.7 12.4 3.1 12L8.825 6.275ZM8.825 6.275L14.5 0.6C14.9 0.2 15.3667 0 15.9 0C16.4333 0 16.9 0.2 17.3 0.6L19.9 3.2C20.3 3.6 20.5 4.06667 20.5 4.6C20.5 5.13333 20.3 5.6 19.9 6L14.225 11.675L8.825 6.275Z" fill="#556071"/>
                </svg>
              </button>
              <button type="button" aria-label="设置" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M7.3 20L6.9 16.8C6.68333 16.7167 6.47917 16.6167 6.2875 16.5C6.09583 16.3833 5.90833 16.2583 5.725 16.125L2.75 17.375L0 12.625L2.575 10.675C2.55833 10.5583 2.55 10.4458 2.55 10.3375C2.55 10.2292 2.55 10.1167 2.55 10C2.55 9.88333 2.55 9.77083 2.55 9.6625C2.55 9.55417 2.55833 9.44167 2.575 9.325L0 7.375L2.75 2.625L5.725 3.875C5.90833 3.74167 6.1 3.61667 6.3 3.5C6.5 3.38333 6.7 3.28333 6.9 3.2L7.3 0H12.8L13.2 3.2C13.4167 3.28333 13.6208 3.38333 13.8125 3.5C14.0042 3.61667 14.1917 3.74167 14.375 3.875L17.35 2.625L20.1 7.375L17.525 9.325C17.5417 9.44167 17.55 9.55417 17.55 9.6625C17.55 9.77083 17.55 9.88333 17.55 10C17.55 10.1167 17.55 10.2292 17.55 10.3375C17.55 10.4458 17.5333 10.5583 17.5 10.675L20.075 12.625L17.325 17.375L14.375 16.125C14.1917 16.2583 14 16.3833 13.8 16.5C13.6 16.6167 13.4 16.7167 13.2 16.8L12.8 20H7.3ZM9.05 18H11.025L11.375 15.35C11.8917 15.2167 12.3708 15.0208 12.8125 14.7625C13.2542 14.5042 13.6583 14.1917 14.025 13.825L16.5 14.85L17.475 13.15L15.325 11.525C15.4083 11.2917 15.4667 11.0458 15.5 10.7875C15.5333 10.5292 15.55 10.2667 15.55 10C15.55 9.73333 15.5333 9.47083 15.5 9.2125C15.4667 8.95417 15.4083 8.70833 15.325 8.475L17.475 6.85L16.5 5.15L14.025 6.2C13.6583 5.81667 13.2542 5.49583 12.8125 5.2375C12.3708 4.97917 11.8917 4.78333 11.375 4.65L11.05 2H9.075L8.725 4.65C8.20833 4.78333 7.72917 4.97917 7.2875 5.2375C6.84583 5.49583 6.44167 5.80833 6.075 6.175L3.6 5.15L2.625 6.85L4.775 8.45C4.69167 8.7 4.63333 8.95 4.6 9.2C4.56667 9.45 4.55 9.71667 4.55 10C4.55 10.2667 4.56667 10.525 4.6 10.775C4.63333 11.025 4.69167 11.275 4.775 11.525L2.625 13.15L3.6 14.85L6.075 13.8C6.44167 14.1833 6.84583 14.5042 7.2875 14.7625C7.72917 15.0208 8.20833 15.2167 8.725 15.35L9.05 18ZM10.1 13.5C11.0667 13.5 11.8917 13.1583 12.575 12.475C13.2583 11.7917 13.6 10.9667 13.6 10C13.6 9.03333 13.2583 8.20833 12.575 7.525C11.8917 6.84167 11.0667 6.5 10.1 6.5C9.11667 6.5 8.2875 6.84167 7.6125 7.525C6.9375 8.20833 6.6 9.03333 6.6 10C6.6 10.9667 6.9375 11.7917 7.6125 12.475C8.2875 13.1583 9.11667 13.5 10.1 13.5Z" fill="#556071"/>
                </svg>
              </button>
              <button type="button" aria-label="铅笔工具" className="p-2.5 rounded-2xl flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:bg-black/5">
                <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M1 18V13.75L14.175 0.6C14.375 0.4 14.6 0.25 14.85 0.15C15.1 0.05 15.35 0 15.6 0C15.8667 0 16.1208 0.05 16.3625 0.15C16.6042 0.25 16.8167 0.4 17 0.6L18.4 2C18.6 2.18333 18.75 2.39583 18.85 2.6375C18.95 2.87917 19 3.13333 19 3.4C19 3.65 18.95 3.9 18.85 4.15C18.75 4.4 18.6 4.625 18.4 4.825L5.25 18H1ZM3 16H4.4L14.225 6.2L13.525 5.475L12.8 4.775L3 14.6V16ZM17 3.425L15.575 2L17 3.425ZM13.525 5.475L12.8 4.775L14.225 6.2L13.525 5.475ZM11 18C12.2333 18 13.375 17.6917 14.425 17.075C15.475 16.4583 16 15.6 16 14.5C16 13.9 15.8417 13.3833 15.525 12.95C15.2083 12.5167 14.7833 12.1417 14.25 11.825L12.775 13.3C13.1583 13.4667 13.4583 13.65 13.675 13.85C13.8917 14.05 14 14.2667 14 14.5C14 14.8833 13.6958 15.2292 13.0875 15.5375C12.4792 15.8458 11.7833 16 11 16C10.7167 16 10.4792 16.0958 10.2875 16.2875C10.0958 16.4792 10 16.7167 10 17C10 17.2833 10.0958 17.5208 10.2875 17.7125C10.4792 17.9042 10.7167 18 11 18ZM1.575 10.35L3.075 8.85C2.74167 8.71667 2.47917 8.57917 2.2875 8.4375C2.09583 8.29583 2 8.15 2 8C2 7.8 2.15 7.6 2.45 7.4C2.75 7.2 3.38333 6.89167 4.35 6.475C5.81667 5.84167 6.79167 5.26667 7.275 4.75C7.75833 4.23333 8 3.65 8 3C8 2.08333 7.63333 1.35417 6.9 0.8125C6.16667 0.270833 5.2 0 4 0C3.25 0 2.57917 0.133333 1.9875 0.4C1.39583 0.666667 0.941667 0.991667 0.625 1.375C0.441667 1.59167 0.366667 1.83333 0.4 2.1C0.433333 2.36667 0.558333 2.58333 0.775 2.75C0.991667 2.93333 1.23333 3.00833 1.5 2.975C1.76667 2.94167 1.99167 2.83333 2.175 2.65C2.40833 2.41667 2.66667 2.25 2.95 2.15C3.23333 2.05 3.58333 2 4 2C4.68333 2 5.1875 2.1 5.5125 2.3C5.8375 2.5 6 2.73333 6 3C6 3.23333 5.85417 3.44583 5.5625 3.6375C5.27083 3.82917 4.6 4.16667 3.55 4.65C2.21667 5.23333 1.29167 5.7625 0.775 6.2375C0.258333 6.7125 0 7.3 0 8C0 8.53333 0.141667 8.9875 0.425 9.3625C0.708333 9.7375 1.09167 10.0667 1.575 10.35Z" fill="#556071"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Slide Canvas Area */}
          <div
            className="self-stretch flex-1 p-12 flex justify-center items-center overflow-hidden"
            style={{ background: 'rgba(243,244,241,0.5)' }}
          >
            <div
              className="px-16 py-36 relative bg-white rounded-sm outline outline-1 outline-offset-[-1px] outline-zinc-400/5 inline-flex flex-col justify-center items-start w-full max-w-4xl mx-auto"
            >
              <div
                className="self-stretch absolute rounded-sm"
                style={{
                  left: 0,
                  top: 0,
                  right: 0,
                  height: '506px',
                  background: 'rgba(0,0,0,0)',
                  boxShadow: '0px 8px 10px -6px rgba(0,0,0,0.10), 0 20px 25px -5px rgba(0,0,0,0.10)',
                }}
              />
              <div className="self-stretch pb-8 flex flex-col justify-start items-start">
                <div className="self-stretch flex flex-col justify-start items-start">
                  <div className="self-stretch justify-center text-zinc-800 text-4xl font-bold font-['Inter'] leading-10" style={{ fontFamily: 'Inter, sans-serif' }}>
                    Advanced Cognitive Architectures
                  </div>
                </div>
              </div>
              <div className="self-stretch flex flex-col justify-start items-start gap-6">
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Synthesis of symbolic and sub-symbolic processing frameworks.
                    </div>
                  </div>
                </div>
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Integration of long-term memory structures (Declarative &amp; Procedural).
                    </div>
                  </div>
                </div>
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Real-time meta-cognition and attention filtering mechanisms.
                    </div>
                  </div>
                </div>
              </div>
              <div
                className="absolute flex flex-col justify-start items-start"
                style={{ right: '112px', top: '33px' }}
              >
                <div className="justify-center text-zinc-400 text-[10px] font-bold font-['Inter'] leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>
                  SLIDE 04 / 24
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Notes */}
        <div
          className="self-stretch flex flex-col justify-between items-start"
          style={{ width: '320px', background: '#FFFFFF', borderLeft: '1px solid rgba(175,179,176,0.1)' }}
        >
          <div className="self-stretch p-6 flex flex-col justify-start items-start gap-6">
            {/* Pill Toggle */}
            <div className="self-stretch p-1 bg-stone-100 rounded-full inline-flex justify-center items-start">
              <button
                onClick={() => setNoteMode('my')}
                className="flex-1 py-1.5 rounded-full flex justify-center items-center"
                style={{
                  background: noteMode === 'my' ? '#FFFFFF' : 'transparent',
                  boxShadow: noteMode === 'my' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <div className="text-center justify-center text-slate-600 text-xs font-medium font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>
                  My Notes
                </div>
              </button>
              <button
                onClick={() => setNoteMode('ai')}
                className="flex-1 py-1.5 rounded-full flex justify-center items-center gap-1.5"
                style={{
                  background: noteMode === 'ai' ? '#FFFFFF' : 'transparent',
                  boxShadow: noteMode === 'ai' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <svg width="14" height="16" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 16V3H0V0H14V3H8.5V16H5.5Z" fill="#2F3331"/>
                </svg>
                <div className="text-center justify-center text-zinc-800 text-xs font-semibold font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>
                  AI Notes
                </div>
                <svg width="14" height="2" viewBox="0 0 14 2" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0 2V0H14V2H0Z" fill="#2F3331"/>
                </svg>
              </button>
            </div>

            {/* Notes Content */}
            <div className="self-stretch pr-2 flex flex-col justify-start items-start overflow-hidden">
              <div className="self-stretch flex flex-col justify-start items-start gap-4">
                <div className="self-stretch flex flex-col justify-start items-start">
                  <div className="self-stretch justify-center text-neutral-500 text-[10px] font-extrabold font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>
                    ACTIVE ANNOTATION
                  </div>
                </div>
                <div className="self-stretch flex flex-col justify-start items-start gap-2">
                  <div className="self-stretch inline-flex justify-start items-center gap-2">
                    <div className="flex flex-col justify-start items-start">
                      <div className="justify-center text-zinc-600 text-[10px] font-bold font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>09:42</div>
                    </div>
                    <div className="flex-1 h-px bg-zinc-400/10" />
                  </div>
                  <div className="self-stretch pb-px flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-black text-sm font-medium font-['Inter'] leading-6" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Need to cross-reference the LTM<br />structures with Anderson&apos;s ACT-R<br />model from the previous lecture. The<br />synthesis approach seems novel here.
                    </div>
                  </div>
                </div>
                <div className="self-stretch pt-4 flex flex-col justify-start items-start gap-1.5">
                  <div className="self-stretch inline-flex justify-start items-center gap-2">
                    <div className="flex flex-col justify-start items-start">
                      <div className="justify-center text-zinc-600 text-[10px] font-bold font-['Inter'] leading-4" style={{ fontFamily: 'Inter, sans-serif' }}>11:15</div>
                    </div>
                    <div className="flex-1 h-px bg-zinc-400/10" />
                  </div>
                  <div className="self-stretch flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-black text-sm font-medium font-['Inter'] leading-6" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Key takeaway: Meta-cognition acts as<br />the &apos;governor&apos; for attention filtering in<br />high-load cognitive environments.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom - Recording Control + Submit */}
          <div className="self-stretch flex-1 min-h-32 flex flex-col justify-end items-start">
            <div
              className="self-stretch p-4 flex flex-col justify-start items-start gap-3"
              style={{ background: 'rgba(243,244,241,0.3)', borderTop: '1px solid rgba(175,179,176,0.1)' }}
            >
              <RecordingControl sessionId={SESSION_ID} onStop={handleRecordingStop} />
              {audioChunks.length > 0 && (
                <button
                  onClick={handleGenerateNotes}
                  disabled={submitting}
                  className="self-stretch py-3 rounded-xl font-medium text-sm cursor-pointer transition-all duration-150"
                  style={{ background: '#2F3331', color: '#FFFFFF', opacity: submitting ? 0.6 : 1 }}
                >
                  {submitting ? '提交中…' : '生成课堂笔记 →'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer - absolute positioned */}
      <div
        className="absolute flex justify-between items-center"
        style={{ bottom: 0, left: 0, right: 0, height: '40px', padding: '0 32px', background: '#FAF9F7', borderTop: '1px solid rgba(175,179,176,0.1)' }}
      >
        <div className="flex flex-col justify-start items-start">
          <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>
            © {new Date().getFullYear()} LIBERSTUDY EDITORIAL. CRAFTED FOR CLARITY.
          </div>
        </div>
        <div className="flex justify-start items-start gap-6">
          <div className="self-stretch flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>SUPPORT</div>
          </div>
          <div className="self-stretch flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>PRIVACY</div>
          </div>
          <div className="self-stretch flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ fontFamily: 'Inter, sans-serif' }}>TERMS</div>
          </div>
        </div>
      </div>

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