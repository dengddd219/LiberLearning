import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { uploadFiles, listSessions } from '../lib/api'

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
      <rect x="0" y="0" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="7" y="0" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="0" y="6" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="7" y="6" width="5" height="4" rx="1" fill="currentColor" />
    </svg>
  )
}

function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="m9.5 9.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="1" width="5" height="7" rx="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 7c0 2.76 2.24 5 5 5s5-2.24 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7 12v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconCourse() {
  return (
    <svg width="13" height="16" viewBox="0 0 13 16" fill="none">
      <rect x="1" y="1" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 5h6M3.5 8h6M3.5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M13.1 9.03A5.07 5.07 0 0 0 13.2 8c0-.35-.03-.7-.1-1.03l1.55-1.19-1.5-2.59-1.82.74A5 5 0 0 0 9 3.1V1H7v2.1a5 5 0 0 0-2.13.83l-1.82-.74-1.5 2.59 1.54 1.19A5.05 5.05 0 0 0 2.8 8c0 .35.03.7.09 1.03L1.35 10.22l1.5 2.59 1.82-.74c.62.34 1.33.57 2.13.83V15h2v-2.1c.8-.26 1.51-.49 2.13-.83l1.82.74 1.5-2.59-1.55-1.19Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function IconNotes() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2.7 0.5C1.5 0.5 1.5 1.7 1.5 1.7v10.6S1.5 13.5 2.7 13.5h8.6s1.2 0 1.2-1.2V4.5L8.5 0.5H2.7Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
      />
      <path d="M8.5 0.5L8.5 4.5L12.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M4 7h6M4 9.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
      <path
        d="M8 0C8 0 3 3 3 9v4l-2 2v1h14v-1l-2-2V9C13 3 8 0 8 0Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <path d="M6 16a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function IconVelocity() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 12 L8 4 L14 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconAI() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconLive() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3" fill="currentColor" />
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  )
}

// ─── Data ────────────────────────────────────────────────────────────────────

interface CourseCard {
  id: string
  course: string
  lecture: string
  duration: string
  notes: number
  time: string
  date: string
  thumbColor: string
  folder: string
  folderColor: 'blue' | 'neutral' | 'slate'
  status: 'done' | 'processing'
}

const FALLBACK_SESSIONS: CourseCard[] = []

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return ''
  const diff = (Date.now() / 1000) - ts
  if (diff < 3600) return `${Math.floor(diff / 60)}M AGO`
  if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`
  if (diff < 172800) return 'YESTERDAY'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

const THUMB_COLORS = ['#4A6FA5', '#6B8E6B', '#8B7355', '#7B6B8B', '#5E8B8B', '#8B5E5E']

// ─── Cards ───────────────────────────────────────────────────────────────────

function ProcessingCard() {
  return (
    <div className="self-stretch p-6 relative bg-white rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)] flex flex-col justify-start items-start gap-4">
      <div className="self-stretch py-7 bg-stone-100 rounded-md flex justify-center items-center overflow-hidden">
        <div className="flex flex-col gap-3 w-[60%]">
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-full animate-pulse" />
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-4/5 animate-pulse" />
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-3/5 animate-pulse" />
        </div>
      </div>
      <div className="self-stretch flex flex-col gap-3">
        <div className="w-32 h-4 bg-stone-100 rounded-2xl animate-pulse" />
        <div className="w-20 h-3 bg-stone-100 rounded-2xl animate-pulse" />
      </div>
      <div className="self-stretch pt-4 border-t border-zinc-400/10 flex justify-between items-center mt-3">
        <div className="flex justify-start items-start gap-1">
          <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-pulse" />
        </div>
        <div className="text-zinc-600 text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide">
          PROCESSING
        </div>
      </div>
    </div>
  )
}

function DoneCard({ card, onClick }: { card: CourseCard; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开课程：${card.course}`}
      className="self-stretch text-left relative bg-white rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)] outline outline-1 outline-offset-[-1px] outline-black/0 overflow-hidden cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0px_40px_56px_-15px_rgba(47,51,49,0.10)]"
    >
      {/* Thumbnail */}
      <div className="w-full relative" style={{ aspectRatio: '16/9', backgroundColor: card.thumbColor, opacity: 0.85 }}>
        <div className="px-2 py-1 absolute bottom-3 right-3 bg-zinc-800/90 rounded-2xl">
          <div className="text-white text-[10.40px] font-normal font-['Liberation_Mono'] leading-4">{card.duration}</div>
        </div>
      </div>
      {/* Info */}
      <div className="px-6 pt-4 pb-0 flex flex-col gap-1">
        <div className="text-zinc-800 text-base font-bold font-['Inter'] leading-6 truncate">{card.course}</div>
        <div className="text-slate-600 text-xs font-medium font-['Inter'] leading-4 truncate">{card.lecture}</div>
      </div>
      {/* Footer */}
      <div className="mx-6 pt-4 pb-5 mt-3 border-t border-zinc-400/10 flex justify-between items-center">
        <div className="flex items-center gap-1 text-slate-600">
          <IconNotes />
          <span className="text-slate-600 text-xs font-normal font-['Inter'] leading-4">{card.notes} notes</span>
        </div>
        <div className="text-neutral-500 text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide">{card.time}</div>
      </div>
    </button>
  )
}

// ─── List View ───────────────────────────────────────────────────────────────

const FOLDER_BADGE: Record<string, { bg: string; text: string }> = {
  blue:    { bg: '#DBEAFE', text: '#4B5563' },
  slate:   { bg: '#DBEAFE', text: '#475569' },
  neutral: { bg: '#E5E5E5', text: '#52525B' },
}

function ListRow({ card, onClick, isLast }: { card: CourseCard; onClick: () => void; isLast: boolean }) {
  const badge = FOLDER_BADGE[card.folderColor]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开课程：${card.course}`}
      className={`w-full text-left flex items-center cursor-pointer hover:bg-stone-50/60 transition-colors${isLast ? '' : ' border-b border-gray-200'}`}
    >
      {/* Thumbnail */}
      <div className="w-40 px-6 py-7 flex-shrink-0">
        <div className="w-16 h-10 rounded-2xl outline outline-1 outline-offset-[-1px] outline-zinc-400/10 overflow-hidden" style={{ backgroundColor: card.thumbColor, opacity: 0.8 }} />
      </div>

      {/* Course name & subtitle */}
      <div className="w-56 pl-6 flex-shrink-0 flex flex-col gap-0.5">
        <div className="text-zinc-800 text-sm font-semibold font-['Inter'] leading-5">{card.course}</div>
        <div className="text-slate-600 text-xs font-normal font-['Inter'] leading-4">{card.lecture}</div>
      </div>

      {/* Folder badge */}
      <div className="w-48 pl-12 pr-6 py-9 flex-shrink-0">
        <div
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
          style={{ backgroundColor: badge.bg }}
        >
          <div className="w-2.5 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: badge.text }} />
          <span className="text-[10px] font-medium font-['Inter']" style={{ color: badge.text }}>{card.folder}</span>
        </div>
      </div>

      {/* Date */}
      <div className="w-28 px-6 py-7 flex-shrink-0 text-slate-600 text-sm font-normal font-['Inter'] leading-5">
        {card.date}
      </div>

      {/* Duration */}
      <div className="w-28 px-6 py-7 flex-shrink-0 text-slate-600 text-sm font-normal font-['Inter'] leading-5">
        {card.duration}
      </div>

      {/* Notes */}
      <div className="w-32 pl-6 flex-shrink-0 flex items-center gap-2 text-zinc-800 text-sm font-medium font-['Inter'] leading-5">
        <IconNotes />
        {card.notes} notes
      </div>
    </button>
  )
}

function ListTable({ sessions, onRowClick }: { sessions: CourseCard[]; onRowClick: (id: string) => void }) {
  const done = sessions.filter(s => s.status === 'done')
  return (
    <div className="self-stretch bg-white rounded-[32px] shadow-[0px_40px_40px_0px_rgba(47,51,49,0.04)] overflow-hidden">
      {/* Header */}
      <div className="flex items-start bg-stone-100/50 pr-24">
        <div className="w-40 px-6 py-4 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">COURSE<br/>THUMBNAIL</div>
        <div className="w-56 px-6 py-5 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">COURSE NAME &amp; IDENTIFIER</div>
        <div className="w-48 px-6 py-5 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">FOLDER</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">DATE</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">DURATION</div>
        <div className="w-32 px-6 py-5 flex-shrink-0 text-slate-600 text-[10px] font-medium font-['Inter'] uppercase tracking-wide">NOTES</div>
      </div>
      {/* Rows */}
      {done.map((card, i) => (
        <ListRow key={card.id} card={card} onClick={() => onRowClick(card.id)} isLast={i === done.length - 1} />
      ))}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────

const MAX_AUDIO_MB = 500

function validateFile(file: File, accept: string[], maxMb?: number): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!accept.includes(ext)) return `不支持的格式，请上传 ${accept.join(' / ')}`
  if (maxMb && file.size > maxMb * 1024 * 1024) return `文件过大，最大支持 ${maxMb}MB`
  return null
}

function IconModalClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconPPT() {
  return (
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none">
      <rect x="1" y="1" width="22" height="30" rx="3" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M7 9h12M7 14h12M7 19h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="22" width="17" height="17" rx="3" fill="#F3F4F1" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M18 30h5M18 33h3" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconAudioFile() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect x="12" y="4" width="12" height="18" rx="6" stroke="#AFB3B0" strokeWidth="1.5" />
      <path d="M6 18c0 6.627 5.373 12 12 12s12-5.373 12-12" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 30v4M14 34h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconCheckCircle() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="7" stroke="#5F5E5E" strokeWidth="1.5" />
      <path d="M4.5 7.5l2 2 4-4" stroke="#5F5E5E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconLoadingCircle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="rgba(95,94,94,0.3)" strokeWidth="2" />
      <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8" stroke="#5F5E5E" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

interface UploadZoneProps {
  label: string; hint: string; accept: string; icon: React.ReactNode
  file: File | null; error: string | null; onFile: (f: File) => void; onClear: () => void
}

function UploadZone({ label, hint, accept, icon, file, error, onFile, onClear }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const isSuccess = !!file && !error

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className="relative flex flex-col items-center justify-center cursor-pointer transition-all duration-150 flex-1"
      style={{
        borderRadius: '32px',
        border: error ? '2px dashed rgba(224,92,64,0.5)' : isSuccess ? '2px dashed rgba(95,94,94,0.4)' : dragging ? '2px dashed rgba(95,94,94,0.5)' : '2px dashed rgba(175,179,176,0.2)',
        padding: '32px',
      }}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div className="pb-4">{icon}</div>
      <div className="pb-1">
        <span className="font-bold text-sm text-zinc-800">{isSuccess ? file!.name : label}</span>
      </div>
      <span className="font-normal text-[11px] uppercase tracking-[0.05em]" style={{ color: error ? 'rgba(224,92,64,0.8)' : '#556071' }}>
        {error ?? (isSuccess ? 'Click to replace' : hint)}
      </span>
      {isSuccess && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className="absolute top-3 right-3 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
          style={{ width: '24px', height: '24px', borderRadius: '9999px', backgroundColor: 'rgba(175,179,176,0.15)', color: '#5F5E5E', border: 'none' }}
        >
          <IconModalClose />
        </button>
      )}
    </div>
  )
}

function NewClassModal({ onClose, navigate }: { onClose: () => void; navigate: ReturnType<typeof useNavigate> }) {
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose])

  const handlePpt = useCallback((file: File) => { const err = validateFile(file, ['.ppt', '.pptx', '.pdf']); setPptError(err); if (!err) setPptFile(file) }, [])
  const handleAudio = useCallback((file: File) => { const err = validateFile(file, ['.mp3', '.wav', '.m4a', '.aac'], MAX_AUDIO_MB); setAudioError(err); if (!err) setAudioFile(file) }, [])
  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    setUploading(true)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch { setUploading(false); alert('上传失败，请重试') }
  }, [pptFile, audioFile, navigate])

  const canSubmit = !!audioFile && !pptError && !audioError && !uploading

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(47,51,49,0.2)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', padding: '24px' }}
      onClick={onClose}
    >
      <div
        className="relative w-full flex flex-col"
        style={{ maxWidth: '768px', backgroundColor: '#FFFFFF', borderRadius: '48px', border: '1px solid rgba(175,179,176,0.1)', boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.25)', fontFamily: 'Inter, system-ui, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-12 p-12">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-2">
              <span className="font-bold text-base uppercase tracking-[0.2em]" style={{ color: 'rgba(95,94,94,0.6)' }}>ACTION CENTER</span>
              <h2 id="modal-title" className="font-bold text-[36px] leading-[1.11] tracking-[-0.025em] text-zinc-800 m-0">New Class</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭对话框" className="flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity" style={{ width: '40px', height: '40px', borderRadius: '9999px', backgroundColor: '#F3F4F1', color: '#5F5E5E', border: 'none' }}>
              <IconModalClose aria-hidden="true" />
            </button>
          </div>

          {/* Upload / Processing */}
          {!uploading ? (
            <div className="flex gap-0 items-stretch">
              <UploadZone label="PPT/PDF Materials" hint="Drag or click to upload" accept=".ppt,.pptx,.pdf" icon={<IconPPT />} file={pptFile} error={pptError} onFile={handlePpt} onClear={() => { setPptFile(null); setPptError(null) }} />
              <UploadZone label="Audio Recording" hint="Upload MP3, WAV or AAC" accept=".mp3,.wav,.m4a,.aac" icon={<IconAudioFile />} file={audioFile} error={audioError} onFile={handleAudio} onClear={() => { setAudioFile(null); setAudioError(null) }} />
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-end">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-zinc-600 flex-shrink-0" />
                    <span className="font-medium text-sm text-zinc-800">Synthesis engine is mapping audio to visual anchors...</span>
                  </div>
                  <span className="font-black text-lg text-zinc-800">68%</span>
                </div>
                <div className="h-3 rounded-full bg-[#E6E9E6] overflow-hidden">
                  <div className="h-full w-[68%] rounded-full" style={{ background: 'linear-gradient(90deg, #5F5E5E 0%, #535252 100%)', boxShadow: '0px 0px 20px 0px rgba(95,94,94,0.2)' }} />
                </div>
              </div>
              <div className="border-t border-zinc-400/10 pt-4 flex flex-col gap-4">
                <div className="flex items-center gap-3"><IconCheckCircle /><span className="font-medium text-sm text-zinc-800">Transcription complete</span></div>
                <div className="flex items-center gap-3"><div className="animate-spin"><IconLoadingCircle /></div><span className="font-normal text-sm text-slate-600">Alignment in progress...</span></div>
                <div className="rounded-[32px] bg-stone-100 p-4 pb-5 flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="font-bold text-[11px] uppercase tracking-[0.1em] text-zinc-600">PAGE 3/18</span>
                    <span className="font-bold text-[11px] uppercase tracking-[0.1em] text-zinc-600">GENERATING NOTES...</span>
                  </div>
                  <div className="h-1 rounded-full bg-[#E0E3E0] overflow-hidden">
                    <div className="h-full w-1/4 rounded-full bg-zinc-600/40" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="flex justify-end gap-4 items-center">
            <button onClick={onClose} className="cursor-pointer hover:opacity-70 transition-opacity font-bold text-sm uppercase tracking-[0.1em] text-slate-600 bg-transparent border-none" style={{ padding: '13.5px 24px 14.5px' }}>
              CANCEL
            </button>
            <button
              onClick={handleSubmit} disabled={!canSubmit}
              className="px-8 py-3 rounded-full font-bold text-base border-none cursor-pointer transition-all"
              style={{ backgroundColor: canSubmit ? '#5F5E5E' : 'rgba(95,94,94,0.35)', color: '#FAF7F6', cursor: canSubmit ? 'pointer' : 'not-allowed', boxShadow: canSubmit ? '0px 4px 6px -4px rgba(0,0,0,0.1), 0px 10px 15px -3px rgba(0,0,0,0.1)' : 'none' }}
            >
              {uploading ? 'Processing…' : 'Save Workspace'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [activeNav, setActiveNav] = useState<'courses' | 'settings'>('courses')
  const [showModal, setShowModal] = useState(false)
  const [sessions, setSessions] = useState<CourseCard[]>(FALLBACK_SESSIONS)

  useEffect(() => {
    listSessions()
      .then((data) => {
        const cards: CourseCard[] = data.map((s, i) => ({
          id: s.session_id,
          course: s.ppt_filename ?? '未命名课程',
          lecture: '',
          duration: formatDuration(s.total_duration),
          notes: 0,
          time: formatTimeAgo(s.created_at ? Number(s.created_at) : null),
          date: s.created_at ? new Date(Number(s.created_at) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
          thumbColor: THUMB_COLORS[i % THUMB_COLORS.length],
          folder: '',
          folderColor: 'neutral' as const,
          status: (s.status === 'processing' ? 'processing' : 'done') as 'done' | 'processing',
        }))
        setSessions(cards)
      })
      .catch(() => { /* keep empty list on error */ })
  }, [])

  return (
    <div className="w-full min-h-screen bg-stone-50 flex font-['Inter']">

      {/* ── Sidebar ── */}
      <aside aria-label="侧边导航" className="w-48 flex-shrink-0 px-4 py-8 bg-stone-100 flex flex-col justify-between items-start min-h-screen">
        {/* Brand */}
        <div className="self-stretch pb-10 flex flex-col justify-start items-start">
          <div className="self-stretch px-4 flex flex-col justify-start items-start">
            <div className="self-stretch text-zinc-800 text-lg font-bold font-['Inter'] leading-7">
              Student<br />Workspace
            </div>
            <div className="self-stretch opacity-60 text-zinc-800 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide mt-1">
              ACADEMIC YEAR 2026
            </div>
          </div>
        </div>

        {/* New Recording CTA */}
        <div className="self-stretch px-2 pb-8 flex flex-col justify-start items-start">
          <button
            onClick={() => setShowModal(true)}
            className="self-stretch px-4 py-3 bg-zinc-600 rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex justify-center items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity border-none"
          >
            <IconMic />
            <span className="text-stone-50 text-xs font-semibold font-['Inter'] leading-5 tracking-tight">Upload the record</span>
          </button>
        </div>

        {/* Nav */}
        <div className="self-stretch flex-1 flex flex-col justify-start items-start gap-4">
          {/* Search */}
          <div className="self-stretch px-4 py-2 bg-neutral-200/20 rounded-md flex justify-between items-center cursor-pointer hover:bg-neutral-200/40 transition-colors">
            <div className="flex justify-start items-center gap-3 text-slate-600">
              <IconSearch />
              <span className="text-slate-600 text-xs font-medium font-['Inter'] leading-5">Search</span>
            </div>
            <div className="px-1.5 pt-px pb-[2.39px] bg-neutral-200 rounded-2xl">
              <span className="text-neutral-500 text-[9.60px] font-bold font-['IPAGothic'] leading-4">⌘K</span>
            </div>
          </div>

          {/* Nav links */}
          <div className="self-stretch flex flex-col gap-1">
            <button
              onClick={() => setActiveNav('courses')}
              className="self-stretch px-4 py-3 flex justify-start items-center gap-3 cursor-pointer border-none bg-transparent transition-all"
              style={{ borderRight: activeNav === 'courses' ? '2px solid #5F5E5E' : '2px solid transparent' }}
            >
              <span style={{ color: activeNav === 'courses' ? '#2F3331' : '#556071' }}><IconCourse /></span>
              <span className="text-zinc-800 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide">MY COURSES</span>
            </button>
            <button
              onClick={() => setActiveNav('settings')}
              className="self-stretch px-4 py-3 flex justify-start items-center gap-3 cursor-pointer border-none bg-transparent transition-all"
              style={{ borderRight: activeNav === 'settings' ? '2px solid #5F5E5E' : '2px solid transparent' }}
            >
              <span style={{ color: activeNav === 'settings' ? '#2F3331' : '#556071' }}><IconSettings /></span>
              <span className="text-zinc-800 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide">SETTINGS</span>
            </button>
          </div>
        </div>

        {/* User anchor */}
        <div className="self-stretch px-4 flex justify-start items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#C8C9C0] flex-shrink-0 flex items-center justify-center">
            <span className="text-xs font-bold text-zinc-600">A</span>
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="text-zinc-800 text-xs font-bold font-['Inter'] leading-4">Alex Chen</div>
            <div className="text-slate-600 text-[9.60px] font-normal font-['Inter'] leading-4">Graduate Student</div>
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex-1 min-w-0 min-h-screen bg-stone-50 flex flex-col justify-start items-start">

        {/* Header */}
        <div className="self-stretch px-12 py-6 bg-stone-50/80 backdrop-blur-md flex justify-between items-center sticky top-0 z-10">
          <div className="flex flex-col justify-start items-start gap-0.5">
            <div className="text-zinc-800 text-2xl font-black font-['Inter'] leading-8">Scholarly Workspace</div>
            <div className="text-slate-600 text-[10.40px] font-normal font-['Inter'] uppercase leading-4 tracking-wide">
              WELCOME BACK, YOUR RECORDINGS ARE UP TO DATE.
            </div>
          </div>
          <div className="flex justify-start items-center gap-6">
            {/* Grid/List toggle */}
            <div className="p-1 bg-stone-100 rounded-full flex justify-start items-start gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className="px-4 py-1.5 rounded-full flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'grid' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'grid' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'grid' ? '#2F3331' : '#556071' }}><IconGrid /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'grid' ? '#2F3331' : '#556071' }}>Grid</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className="px-4 py-1.5 rounded-full flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'list' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'list' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'list' ? '#2F3331' : '#556071' }}><IconList /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'list' ? '#2F3331' : '#556071' }}>List</span>
              </button>
            </div>
            {/* Bell + Avatar */}
            <div className="flex justify-start items-center gap-4">
              <button type="button" aria-label="通知" className="w-11 h-11 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity border-none bg-transparent text-slate-600">
                <IconBell aria-hidden="true" />
              </button>
              <button type="button" aria-label="用户设置" className="w-11 h-11 flex items-center justify-center cursor-pointer border-none bg-transparent p-0">
                <div className="w-8 h-8 rounded-full bg-[#C8C9C0] flex items-center justify-center">
                  <span className="text-xs font-bold text-zinc-600">A</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="w-full px-12 pt-24 pb-12 flex flex-col justify-start items-start gap-10">

          {/* Session cards */}
          {viewMode === 'grid' ? (
            <div className="self-stretch grid grid-cols-4 gap-6">
              {sessions.map((s) =>
                s.status === 'processing'
                  ? <ProcessingCard key={s.id} />
                  : <DoneCard key={s.id} card={s} onClick={() => {
                      openTab({ sessionId: s.id, label: s.course })
                      navigate(`/notes/${s.id}`)
                    }} />
              )}
              {sessions.length === 0 && (
                <div className="col-span-4 flex flex-col items-center justify-center py-16">
                  <p className="text-sm text-zinc-400 mb-4">还没有任何课程记录</p>
                  <button
                    onClick={() => setShowModal(true)}
                    className="px-4 py-2 bg-zinc-600 text-white text-sm rounded-full cursor-pointer hover:opacity-85"
                  >
                    开始第一次录音
                  </button>
                </div>
              )}
            </div>
          ) : (
            <ListTable sessions={sessions} onRowClick={(id) => {
              const card = sessions.find((s) => s.id === id)
              openTab({ sessionId: id, label: card?.course ?? id })
              navigate(`/notes/${id}`)
            }} />
          )}

          {/* Insight cards */}
          <div className="self-stretch flex justify-between items-start">
            <div className="flex justify-start items-start gap-4">
              <div className="w-64 self-stretch p-8 bg-stone-100 rounded-[32px] flex flex-col justify-start items-start gap-1">
                <IconVelocity />
                <div className="self-stretch pt-3">
                  <div className="text-zinc-800 text-sm font-bold font-['Inter'] leading-5">Study Velocity</div>
                </div>
                <div className="text-slate-600 text-xs font-normal font-['Inter'] leading-4">
                  You've averaged 4.2 hours of recording this week. Consistency is key.
                </div>
              </div>
              <div className="w-64 self-stretch p-8 bg-stone-100 rounded-[32px] flex flex-col justify-start items-start gap-1">
                <IconAI />
                <div className="self-stretch pt-3">
                  <div className="text-zinc-800 text-sm font-bold font-['Inter'] leading-5">AI Insights</div>
                </div>
                <div className="text-slate-600 text-xs font-normal font-['Inter'] leading-4">
                  3 summaries are ready for review from your recent Predictive Analytics lecture.
                </div>
              </div>
              <button
                type="button"
                className="w-96 self-stretch text-left p-8 bg-stone-100 rounded-[32px] flex flex-col justify-start items-start gap-1 cursor-pointer hover:bg-stone-200 transition-colors focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:outline-none border-none"
                onClick={() => navigate('/session/live')}
                aria-label="进入 LIVE AI Courses"
              >
                <IconLive />
                <div className="self-stretch pt-3">
                  <div className="text-zinc-800 text-sm font-bold font-['Inter'] leading-5">LIVE AI Courses</div>
                </div>
                <div className="text-slate-600 text-xs font-normal font-['Inter'] leading-4">
                  AI with your class
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showModal && <NewClassModal onClose={() => setShowModal(false)} navigate={navigate} />}
    </div>
  )
}
