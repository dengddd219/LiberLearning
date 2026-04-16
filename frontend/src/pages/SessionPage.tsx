import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getIncompleteSession, saveSession, clearSession } from '../lib/idb'
import { uploadFiles } from '../lib/api'
import { useTranslation } from '../context/TranslationContext'

interface Annotation {
  id: string
  pageNum: number
  title: string
  text: string
  timestamp: number // seconds elapsed
}

const SESSION_ID = `session-${Date.now()}`

function useRecordingTimer(isRecording: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isRecording])

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return { display: `${mm}:${ss}`, elapsed }
}

function formatTimestamp(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function SessionPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [pptFileName, setPptFileName] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [pptFile, _setPptFile] = useState<File | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [recoveryModal, setRecoveryModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('my')
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(12).fill(4))
  const recoverySessionRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const { display: recTimer, elapsed } = useRecordingTimer(isRecording)

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

  const handleStartRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        setAudioChunks(chunks)
        stream.getTracks().forEach((t) => t.stop())
      }
      mr.start(1000)
      setIsRecording(true)

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 32
      source.connect(analyser)
      analyserRef.current = analyser
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const draw = () => {
        analyser.getByteFrequencyData(dataArray)
        const bars = Array.from({ length: 12 }, (_, i) => {
          const val = dataArray[Math.floor(i * dataArray.length / 12)]
          return Math.max(4, Math.round((val / 255) * 48))
        })
        setWaveformBars(bars)
        animFrameRef.current = requestAnimationFrame(draw)
      }
      draw()
    } catch {
      alert('无法访问麦克风，请检查权限设置')
    }
  }, [])

  const handleEndSession = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
    cancelAnimationFrame(animFrameRef.current)
    analyserRef.current = null
    setWaveformBars(Array(12).fill(4))
  }, [isRecording])

  const handleAddNote = useCallback(() => {
    if (!noteInput.trim()) return
    const ann: Annotation = {
      id: `ann-${Date.now()}`,
      pageNum: currentPage,
      title: noteInput.trim().slice(0, 30),
      text: noteInput.trim(),
      timestamp: elapsed,
    }
    setAnnotations((prev) => [...prev, ann])
    setNoteInput('')
  }, [noteInput, currentPage, elapsed])

  const handleGenerateNotes = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const audioBlob = audioChunks.length > 0 ? new Blob(audioChunks, { type: 'audio/webm' }) : undefined
      const audioFile = audioBlob ? new File([audioBlob], 'recording.webm', { type: 'audio/webm' }) : undefined
      const userAnchors = annotations.map((ann) => ({ page_num: ann.pageNum, timestamp: ann.timestamp }))
      const result = await uploadFiles(pptFile ?? undefined, audioFile, 'zh', userAnchors)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch {
      setSubmitting(false)
      setSubmitError(t('session_submit_error'))
    }
  }, [pptFile, audioChunks, annotations, navigate])

  return (
    <div className="w-full pb-24 relative bg-stone-50 inline-flex flex-col justify-start items-start" style={{ fontFamily: 'Inter, sans-serif', minHeight: '100vh' }}>
      {/* Main content area below topbar */}
      <div className="self-stretch inline-flex justify-start items-start overflow-hidden" style={{ paddingTop: '64px', height: 'calc(100vh - 64px)' }}>

        {/* Left Sidebar - Lecture Slides */}
        <div className="w-48 self-stretch bg-stone-100 border-r border-zinc-400/10 inline-flex flex-col justify-start items-start">
          {/* Header */}
          <div className="self-stretch p-4 border-b border-zinc-400/10 inline-flex justify-between items-center">
            <div className="inline-flex flex-col justify-start items-start">
              <div className="justify-center text-slate-600 text-[10px] font-bold uppercase leading-4 tracking-wide">{t('session_lecture_slides')}</div>
            </div>
            <button className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer" aria-label="收起幻灯片列表">
              <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 7.31667L0 0.816667L0.816667 0L7 6.18333L13.1833 0L14 0.816667L7 7.31667Z" fill="#556071"/>
              </svg>
            </button>
          </div>
          {/* Slide Thumbnails */}
          <div className="self-stretch flex-1 p-3 flex flex-col justify-start items-start gap-4 overflow-y-auto overflow-x-hidden">
            {pptFileName ? (
              <div className="self-stretch flex flex-col justify-start items-start gap-1 px-1">
                <div className="text-zinc-800 text-xs font-medium leading-4 break-all">{pptFileName}</div>
                <div className="text-slate-400 text-[10px] leading-4">上传后解析页数</div>
              </div>
            ) : (
              <div className="self-stretch flex flex-col justify-start items-center gap-1 px-1 py-4">
                <div className="text-slate-400 text-xs leading-4">{t('session_ppt_not_uploaded')}</div>
              </div>
            )}
          </div>
        </div>

        {/* Center - PPT Canvas */}
        <div className="flex-1 self-stretch bg-stone-50 inline-flex flex-col justify-start items-start overflow-hidden">
          {/* Toolbar */}
          <div className="self-stretch h-12 px-6 bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] border-b border-zinc-400/20 inline-flex justify-between items-center">
            <div className="flex justify-start items-center gap-4">
              <div className="flex justify-start items-center gap-2">
                <button type="button" aria-label="下载" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 12L3 7L4.4 5.55L7 8.15V0H9V8.15L11.6 5.55L13 7L8 12ZM2 16C1.45 16 0.979 15.804 0.588 15.413C0.196 15.021 0 14.55 0 14V11H2V14H14V11H16V14C16 14.55 15.804 15.021 15.413 15.413C15.021 15.804 14.55 16 14 16H2Z" fill="#556071"/>
                  </svg>
                </button>
                <button type="button" aria-label="添加批注" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 8H0V6H6V0H8V6H14V8H8V14H6V8Z" fill="#556071"/>
                  </svg>
                </button>
              </div>
              <div className="w-px h-6 bg-zinc-400/20" />
              <div className="flex justify-start items-center gap-2">
                <button type="button" aria-label="上一页" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 8L8 0V16L0 8ZM9 8L17 0V16L9 8Z" fill="#556071"/>
                  </svg>
                </button>
                <button type="button" aria-label="下一页" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 8L12 16V0L20 8ZM11 8L3 16V0L11 8Z" fill="#556071"/>
                  </svg>
                </button>
                <button type="button" aria-label="全屏" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 16V0H2V7H12V0H14V16H12V9H2V16H0Z" fill="#556071"/>
                  </svg>
                </button>
              </div>
            </div>
            {/* Zoom */}
            <div className="flex justify-start items-center gap-3">
              <button type="button" aria-label="缩小" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                <svg width="14" height="2" viewBox="0 0 14 2" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0 2V0H14V2H0Z" fill="#556071"/>
                </svg>
              </button>
              <div className="justify-center text-zinc-800 text-xs font-medium leading-4">125%</div>
              <button type="button" aria-label="放大" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 8H0V6H6V0H8V6H14V8H8V14H6V8Z" fill="#556071"/>
                </svg>
              </button>
            </div>
            {/* Right tools */}
            <div className="flex justify-start items-center gap-2">
              <button type="button" aria-label="书签" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0 20V2C0 1.45 0.196 0.979 0.588 0.588C0.979 0.196 1.45 0 2 0H14C14.55 0 15.021 0.196 15.413 0.588C15.804 0.979 16 1.45 16 2V20L8 17L0 20Z" fill="#556071"/>
                </svg>
              </button>
              <button type="button" aria-label="笔记工具" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0 16V14H20V16H0ZM0 9V7H12V9H0ZM0 2V0H20V2H0Z" fill="#556071"/>
                </svg>
              </button>
              <button type="button" aria-label="更多" className="p-1 rounded-2xl hover:bg-black/5 cursor-pointer">
                <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 16C8.55 16 9.021 15.804 9.413 15.413C9.804 15.021 10 14.55 10 14C10 13.45 9.804 12.979 9.413 12.588C9.021 12.196 8.55 12 8 12C7.45 12 6.979 12.196 6.588 12.588C6.196 12.979 6 13.45 6 14C6 14.55 6.196 15.021 6.588 15.413C6.979 15.804 7.45 16 8 16ZM8 10C8.55 10 9.021 9.804 9.413 9.413C9.804 9.021 10 8.55 10 8C10 7.45 9.804 6.979 9.413 6.588C9.021 6.196 8.55 6 8 6C7.45 6 6.979 6.196 6.588 6.588C6.196 6.979 6 7.45 6 8C6 8.55 6.196 9.021 6.588 9.413C6.979 9.804 7.45 10 8 10ZM8 4C8.55 4 9.021 3.804 9.413 3.413C9.804 3.021 10 2.55 10 2C10 1.45 9.804 0.979 9.413 0.588C9.021 0.196 8.55 0 8 0C7.45 0 6.979 0.196 6.588 0.588C6.196 0.979 6 1.45 6 2C6 2.55 6.196 3.021 6.588 3.413C6.979 3.804 7.45 4 8 4Z" fill="#556071"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Slide Canvas Area */}
          <div className="self-stretch flex-1 p-12 bg-stone-100/50 inline-flex justify-center items-center overflow-hidden">
            <div className="w-[896px] max-w-[896px] px-16 py-36 relative bg-white rounded-sm outline outline-1 outline-offset-[-1px] outline-zinc-400/5 inline-flex flex-col justify-center items-center">
              <div className="w-full h-[506px] left-0 top-0 absolute bg-white/0 rounded-sm shadow-[0px_8px_10px_-6px_rgba(0,0,0,0.10),0px_20px_25px_-5px_rgba(0,0,0,0.10)]" />
              <div className="flex flex-col justify-center items-center gap-3">
                {isRecording ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-red-500" style={{ animation: 'pulse 1.5s infinite' }} />
                    <div className="text-zinc-500 text-base font-normal leading-6">{t('session_recording_hint')}</div>
                  </>
                ) : (
                  <div className="text-zinc-400 text-base font-normal leading-6">{t('session_start_hint')}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-80 self-stretch bg-white border-l border-zinc-400/10 inline-flex flex-col justify-between items-start">
          {/* Top: Pill Toggle */}
          <div className="self-stretch p-6 flex flex-col justify-start items-start gap-6">
            <div className="self-stretch p-1 bg-stone-100 rounded-full inline-flex justify-center items-start">
              <button
                onClick={() => setNoteMode('my')}
                className="flex-1 py-1.5 rounded-full flex justify-center items-center cursor-pointer border-none"
                style={{
                  background: noteMode === 'my' ? '#FFFFFF' : 'transparent',
                  boxShadow: noteMode === 'my' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <div className="text-center text-slate-600 text-xs font-medium leading-4">My Notes</div>
              </button>
              <button
                onClick={() => setNoteMode('ai')}
                className="flex-1 py-1.5 rounded-full flex justify-center items-center gap-1.5 cursor-pointer border-none"
                style={{
                  background: noteMode === 'ai' ? '#FFFFFF' : 'transparent',
                  boxShadow: noteMode === 'ai' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <div className="w-3 h-3 bg-zinc-800" />
                <div className="text-center text-zinc-800 text-xs font-semibold leading-4">AI Notes</div>
                <div className="w-1.5 h-1 bg-zinc-800" />
              </button>
            </div>
          </div>

          {/* Main Notes Panel */}
          <div className="w-80 flex-1 bg-white border-l border-zinc-400/10 flex flex-col justify-start items-start overflow-hidden">
            {/* Recording Control Block */}
            <div className="self-stretch p-6 bg-gray-200 border-b border-zinc-400/10 flex flex-col justify-start items-start gap-6">
              {/* Status Row */}
              <div className="self-stretch inline-flex justify-between items-center">
                <div className="flex justify-start items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: isRecording ? '#9F403D' : '#AFB3B0' }}
                  />
                  <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-sm font-bold leading-5">
                      {isRecording ? t('session_recording') : t('session_not_recording')}
                    </div>
                  </div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                  <div className="justify-center text-zinc-600 text-xl font-medium leading-7" style={{ fontFamily: 'Liberation Mono, monospace' }}>
                    {recTimer}
                  </div>
                </div>
              </div>
              {/* Waveform */}
              <div className="self-stretch h-16 px-2 inline-flex justify-center items-end gap-1">
                {waveformBars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full"
                    style={{
                      height: `${isRecording ? h : 8}px`,
                      background: i % 3 === 0 ? '#3F3F46' : i % 3 === 1 ? '#52525B' : '#475569',
                      opacity: isRecording ? (i % 4 === 0 ? 0.6 : i % 4 === 1 ? 1 : i % 4 === 2 ? 0.4 : 0.8) : 0.3,
                      transition: 'height 0.3s ease',
                    }}
                  />
                ))}
              </div>
              {/* Action Button */}
              {!isRecording ? (
                <button
                  onClick={handleStartRecording}
                  className="self-stretch py-3 bg-zinc-800 rounded-full inline-flex justify-center items-center gap-2 cursor-pointer border-none"
                >
                  <div className="w-3 h-3 rounded-full bg-stone-50" />
                  <div className="text-center text-stone-50 text-sm font-medium leading-5">Start Recording</div>
                </button>
              ) : (
                <button
                  onClick={handleEndSession}
                  className="self-stretch py-3 bg-zinc-800 rounded-full inline-flex justify-center items-center gap-2 cursor-pointer border-none"
                >
                  <div className="w-3.5 h-3.5 bg-stone-50" style={{ borderRadius: '2px' }} />
                  <div className="text-center text-stone-50 text-sm font-medium leading-5">End Session</div>
                </button>
              )}
            </div>

            {/* My Notes Section */}
            <div className="self-stretch flex-1 p-6 flex flex-col justify-start items-start overflow-hidden">
              {/* Section header */}
              <div className="self-stretch pb-4 flex flex-col justify-start items-start">
                <div className="self-stretch inline-flex justify-between items-center">
                  <div className="justify-center text-zinc-800 text-base font-bold leading-6">My Notes</div>
                  <button type="button" aria-label="添加笔记" className="w-3 h-3 cursor-pointer border-none bg-transparent p-0">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5 7H0V5H5V0H7V5H12V7H7V12H5V7Z" fill="#475569"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Notes List */}
              <div className="self-stretch flex-1 pr-2 flex flex-col justify-start items-start gap-6 overflow-y-auto">
                {/* Existing annotations */}
                {annotations.length === 0 ? (
                  <div className="self-stretch flex flex-col justify-center items-center py-6">
                    <div className="text-slate-400 text-xs leading-4">暂无笔记，点击 + 添加标注</div>
                  </div>
                ) : (
                  annotations.map((ann) => (
                    <div key={ann.id} className="self-stretch pl-4 relative flex flex-col justify-start items-start gap-[3.13px]">
                      <div className="self-stretch inline-flex justify-start items-center gap-2">
                        <div className="p-1 bg-gray-200 rounded-2xl inline-flex flex-col justify-start items-start">
                          <div className="justify-center text-slate-600 text-[10px] font-normal leading-4" style={{ fontFamily: 'Liberation Mono, monospace' }}>
                            {formatTimestamp(ann.timestamp)}
                          </div>
                        </div>
                        <div className="justify-center text-zinc-800 text-xs font-semibold leading-4">{ann.title}</div>
                      </div>
                      <div className="self-stretch pb-px flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-600 text-sm font-normal leading-6">{ann.text}</div>
                      </div>
                      <div className="w-0.5 h-full left-0 top-0 absolute bg-zinc-600/20 rounded-full" />
                    </div>
                  ))
                )}
              </div>

              {/* Input area */}
              <div className="self-stretch pt-4 flex flex-col justify-start items-start">
                <div className="self-stretch pt-4 border-t border-zinc-400/10 flex flex-col justify-start items-start">
                  <div className="self-stretch relative flex flex-col justify-start items-start">
                    <textarea
                      className="self-stretch h-24 p-4 bg-stone-100 rounded-[48px] text-zinc-800 text-sm font-normal leading-5 resize-none outline-none w-full border-none"
                      placeholder={t('session_note_placeholder')}
                      style={{ color: noteInput ? '#27272A' : '#A1A1AA' }}
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleAddNote()
                        }
                      }}
                    />
                    <div className="absolute inline-flex justify-start items-start gap-2" style={{ right: '12px', bottom: '12px' }}>
                      <button type="button" className="p-1.5 rounded-md hover:bg-black/5 cursor-pointer border-none bg-transparent" aria-label="清除">
                        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 0L14 10H2L8 0Z" fill="#3F3F46" opacity="0.4"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleAddNote}
                        className="p-1.5 bg-zinc-600 rounded-md inline-flex flex-col justify-center items-center cursor-pointer border-none"
                        aria-label="提交笔记"
                      >
                        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M0 12V0L14 6L0 12ZM1.5 9.75L10.3875 6L1.5 2.25V4.875L6 6L1.5 7.125V9.75Z" fill="#FAFAF9"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Generate Notes button if audio available */}
          {audioChunks.length > 0 && (
            <div className="self-stretch p-4 border-t border-zinc-400/10">
              <button
                onClick={handleGenerateNotes}
                disabled={submitting}
                className="self-stretch py-3 rounded-xl text-sm font-medium cursor-pointer border-none"
                style={{ background: '#2F3331', color: '#FFFFFF', opacity: submitting ? 0.6 : 1, width: '100%' }}
              >
                {submitting ? t('session_submitting') : t('session_submit_notes')}
              </button>
              {submitError && <p role="alert" style={{ color: '#E05C40', fontSize: '13px', marginTop: '8px' }}>{submitError}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Top Nav Bar - absolute positioned */}
      <div
        className="absolute left-0 top-0 bg-stone-50/80 backdrop-blur-md inline-flex justify-between items-center"
        style={{ width: '100%', height: '64px', padding: '0 32px' }}
      >
        <div className="flex justify-start items-center gap-8">
          <div className="justify-center text-zinc-800 text-xl font-bold leading-7">LiberStudy</div>
          <div className="flex justify-start items-center gap-6">
            <button className="text-slate-600 text-base font-normal leading-6 cursor-pointer border-none bg-transparent hover:text-zinc-800">Dashboard</button>
            <div className="pb-1 border-b-2 border-zinc-600 inline-flex flex-col justify-start items-start">
              <div className="text-zinc-800 text-base font-normal leading-6">Courses</div>
            </div>
            <button className="text-slate-600 text-base font-normal leading-6 cursor-pointer border-none bg-transparent hover:text-zinc-800">Detailed Note</button>
          </div>
        </div>
        <div className="flex justify-start items-center gap-4">
          <button type="button" aria-label="通知" className="border-none bg-transparent cursor-pointer p-1">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 17V15H2V8C2 6.617 2.417 5.387 3.25 4.313C4.083 3.238 5.167 2.533 6.5 2.2V1.5C6.5 1.083 6.646 0.729 6.938 0.438C7.229 0.146 7.583 0 8 0C8.417 0 8.771 0.146 9.063 0.438C9.354 0.729 9.5 1.083 9.5 1.5V2.2C10.833 2.533 11.917 3.238 12.75 4.313C13.583 5.387 14 6.617 14 8V15H16V17H0ZM8 20C7.45 20 6.979 19.804 6.588 19.413C6.196 19.021 6 18.55 6 18H10C10 18.55 9.804 19.021 9.413 19.413C9.021 19.804 8.55 20 8 20Z" fill="#475569"/>
            </svg>
          </button>
          <button type="button" aria-label="搜索" className="border-none bg-transparent cursor-pointer p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 19L13 13M15 8C15 11.866 11.866 15 8 15C4.134 15 1 11.866 1 8C1 4.134 4.134 1 8 1C11.866 1 15 4.134 15 8Z" stroke="#475569" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="w-8 h-8 bg-neutral-200 rounded-full overflow-hidden">
            <img className="w-8 h-8 object-cover" src="https://placehold.co/32x32" alt="用户头像" />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="absolute left-0 inline-flex justify-between items-center"
        style={{ bottom: 0, width: '100%', height: '40px', padding: '0 32px', background: '#FAF9F7', borderTop: '1px solid rgba(175,179,176,0.2)' }}
      >
        <div className="justify-center text-slate-600 text-[10px] font-normal uppercase leading-4 tracking-wide">
          © 2024 LIBERSTUDY EDITORIAL. CRAFTED FOR CLARITY.
        </div>
        <div className="flex justify-start items-start gap-6">
          {([['SUPPORT', t('session_support')], ['PRIVACY', t('session_privacy')], ['TERMS', t('session_terms')]] as const).map(([key, label]) => (
            <button key={key} className="text-slate-600 text-[10px] font-normal uppercase leading-4 tracking-wide cursor-pointer border-none bg-transparent hover:text-zinc-800">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Recovery Modal */}
      {recoveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-96 max-w-full p-8 rounded-2xl" style={{ background: '#FFFFFF', boxShadow: '0 24px 64px rgba(0,0,0,0.15)' }}>
            <h2 className="text-lg font-bold mb-2" style={{ color: '#2F3331' }}>{t('session_recovery_title')}</h2>
            <p className="text-sm mb-6" style={{ color: '#777C79' }}>{t('session_recovery_sub')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => setRecoveryModal(false)}
                className="w-full py-2.5 rounded-lg text-sm font-medium cursor-pointer border-none"
                style={{ background: '#2F3331', color: '#FFFFFF' }}
              >
                继续录音
              </button>
              <button
                onClick={() => navigate(`/processing?session_id=${recoverySessionRef.current}`)}
                className="w-full py-2.5 rounded-lg text-sm cursor-pointer bg-transparent"
                style={{ border: '1px solid rgba(175,179,176,0.3)', color: '#2F3331' }}
              >
                {t('session_recovery_continue')}
              </button>
              <button
                onClick={async () => {
                  if (recoverySessionRef.current) await clearSession(recoverySessionRef.current)
                  setRecoveryModal(false)
                }}
                className="w-full py-2.5 text-sm cursor-pointer border-none bg-transparent"
                style={{ color: '#EF4444' }}
              >
                {t('session_recovery_discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
