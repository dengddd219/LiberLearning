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
    <div className="p-6 relative bg-white rounded-[32px] flex flex-col justify-start items-start gap-4" style={{ width: '224px', minHeight: '288px' }}>
      <div className="w-56 h-72 left-0 top-0 absolute bg-white/0 rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
      <div className="self-stretch py-7 rounded-md inline-flex justify-center items-center overflow-hidden" style={{ backgroundColor: '#F2F2EC' }}>
        <div className="inline-flex flex-col justify-start items-start">
          <div className="w-8 h-6 animate-pulse rounded" style={{ backgroundColor: '#D0CFC5' }} />
        </div>
      </div>
      <div className="self-stretch flex flex-col justify-start items-start gap-3">
        <div className="w-32 h-4 rounded-2xl animate-pulse" style={{ backgroundColor: '#F2F2EC' }} />
        <div className="w-20 h-3 rounded-2xl animate-pulse" style={{ backgroundColor: '#F2F2EC' }} />
      </div>
      <div className="self-stretch h-20 min-h-8 pt-12 flex flex-col justify-end items-start">
        <div className="self-stretch pt-4 inline-flex justify-between items-center" style={{ borderTop: '1px solid #E3E3DA' }}>
          <div className="flex justify-start items-start gap-1">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
          </div>
          <div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>PROCESSING</div>
        </div>
      </div>
    </div>
  )
}

const API_BASE_FOR_THUMB = import.meta.env.VITE_API_BASE_URL || ''

function DoneCard({ card, onClick }: { card: CourseCard; onClick: () => void }) {
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const thumbSrc = `${API_BASE_FOR_THUMB}/api/sessions/${card.id}/slide/1.png`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开课程：${card.course}`}
      className="relative bg-white rounded-[32px] outline outline-1 outline-offset-[-1px] outline-black/0 cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0px_40px_56px_-15px_rgba(47,51,49,0.10)] text-left flex-shrink-0"
      style={{ width: '224px', height: '288px' }}
    >
      <div className="w-56 h-72 left-0 top-0 absolute bg-white/0 rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
      {/* Thumbnail */}
      <div className="w-44 left-[25px] top-[25px] absolute rounded-md inline-flex flex-col justify-center items-start overflow-hidden" style={{ backgroundColor: '#F2F2EC' }}>
        <div className="self-stretch h-24 relative overflow-hidden" style={{ backgroundColor: card.thumbColor, opacity: thumbLoaded ? 1 : 0.85 }}>
          {!thumbError && (
            <img
              src={thumbSrc}
              alt=""
              aria-hidden="true"
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbError(true)}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: thumbLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
            />
          )}
        </div>
        <div className="px-2 py-1 absolute rounded-2xl" style={{ right: '8px', bottom: '8px', backgroundColor: 'rgba(41,41,41,0.85)' }}>
          <div className="text-white text-[10.40px] font-normal font-['Liberation_Mono'] leading-4">{card.duration}</div>
        </div>
      </div>
      {/* Info */}
      <div className="w-44 left-[25px] top-[136.65px] absolute inline-flex flex-col justify-start items-start gap-1">
        <div className="self-stretch pb-[0.69px] flex flex-col justify-start items-start">
          <div className="self-stretch text-base font-bold font-['Inter'] leading-6 truncate" style={{ color: '#292929' }}>{card.course}</div>
        </div>
        <div className="self-stretch flex flex-col justify-start items-start">
          <div className="self-stretch text-xs font-medium font-['Inter'] leading-4 truncate" style={{ color: '#72726E' }}>{card.lecture}</div>
        </div>
      </div>
      {/* Footer */}
      <div className="w-44 pt-4 left-[25px] top-[239.14px] absolute inline-flex justify-between items-center" style={{ borderTop: '1px solid #E3E3DA' }}>
        <div className="flex justify-start items-center gap-1">
          <div className="w-3.5 h-3.5 relative" style={{ color: '#72726E' }}><IconNotes /></div>
          <div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.notes} notes</div>
        </div>
        <div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{card.time}</div>
      </div>
    </button>
  )
}

// ─── List View ───────────────────────────────────────────────────────────────

const FOLDER_BADGE: Record<string, { bg: string; text: string }> = {
  blue:    { bg: '#F2F2EC', text: '#72726E' },
  slate:   { bg: '#F2F2EC', text: '#72726E' },
  neutral: { bg: '#E3E3DA', text: '#72726E' },
}

function ListRow({ card, onClick, isLast }: { card: CourseCard; onClick: () => void; isLast: boolean }) {
  const badge = FOLDER_BADGE[card.folderColor]
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const thumbSrc = `${API_BASE_FOR_THUMB}/api/sessions/${card.id}/slide/1.png`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开课程：${card.course}`}
      className={`w-full text-left flex items-center cursor-pointer hover:bg-[#F2F2EC]/60 transition-colors${isLast ? '' : ' border-b'}`}
      style={isLast ? {} : { borderColor: '#E3E3DA' }}
    >
      {/* Thumbnail */}
      <div className="w-40 px-6 py-7 flex-shrink-0">
        <div className="w-16 h-10 rounded-2xl outline outline-1 outline-offset-[-1px] overflow-hidden relative" style={{ backgroundColor: card.thumbColor, opacity: 0.8, outlineColor: '#E3E3DA' }}>
          {!thumbError && (
            <img
              src={thumbSrc}
              alt=""
              aria-hidden="true"
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbError(true)}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: thumbLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
            />
          )}
        </div>
      </div>

      {/* Course name & subtitle */}
      <div className="w-56 pl-6 flex-shrink-0 flex flex-col gap-0.5">
        <div className="text-sm font-semibold font-['Inter'] leading-5" style={{ color: '#292929' }}>{card.course}</div>
        <div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.lecture}</div>
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
      <div className="w-28 px-6 py-7 flex-shrink-0 text-sm font-normal font-['Inter'] leading-5" style={{ color: '#72726E' }}>
        {card.date}
      </div>

      {/* Duration */}
      <div className="w-28 px-6 py-7 flex-shrink-0 text-sm font-normal font-['Inter'] leading-5" style={{ color: '#72726E' }}>
        {card.duration}
      </div>

      {/* Notes */}
      <div className="w-32 pl-6 flex-shrink-0 flex items-center gap-2 text-sm font-medium font-['Inter'] leading-5" style={{ color: '#292929' }}>
        <IconNotes />
        {card.notes} notes
      </div>
    </button>
  )
}

function ListTable({ sessions, onRowClick }: { sessions: CourseCard[]; onRowClick: (id: string) => void }) {
  const done = sessions.filter(s => s.status === 'done')
  return (
    <div className="self-stretch rounded-[32px] shadow-[0px_40px_40px_0px_rgba(47,51,49,0.04)] overflow-hidden" style={{ backgroundColor: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex items-start pr-24" style={{ backgroundColor: 'rgba(247,247,242,0.5)' }}>
        <div className="w-40 px-6 py-4 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>COURSE<br/>THUMBNAIL</div>
        <div className="w-56 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>COURSE NAME &amp; IDENTIFIER</div>
        <div className="w-48 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>FOLDER</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>DATE</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>DURATION</div>
        <div className="w-32 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>NOTES</div>
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
      <rect x="1" y="1" width="22" height="30" rx="3" stroke="#D0CFC5" strokeWidth="1.5" />
      <path d="M7 9h12M7 14h12M7 19h8" stroke="#D0CFC5" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="22" width="17" height="17" rx="3" fill="#F2F2EC" stroke="#D0CFC5" strokeWidth="1.5" />
      <path d="M18 30h5M18 33h3" stroke="#D0CFC5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconAudioFile() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect x="12" y="4" width="12" height="18" rx="6" stroke="#D0CFC5" strokeWidth="1.5" />
      <path d="M6 18c0 6.627 5.373 12 12 12s12-5.373 12-12" stroke="#D0CFC5" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 30v4M14 34h8" stroke="#D0CFC5" strokeWidth="1.5" strokeLinecap="round" />
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
        <span className="font-bold text-sm" style={{ color: '#292929' }}>{isSuccess ? file!.name : label}</span>
      </div>
      <span className="font-normal text-[11px] uppercase tracking-[0.05em]" style={{ color: error ? 'rgba(224,92,64,0.8)' : '#72726E' }}>
        {error ?? (isSuccess ? 'Click to replace' : hint)}
      </span>
      {isSuccess && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className="absolute top-3 right-3 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
          style={{ width: '24px', height: '24px', borderRadius: '9999px', backgroundColor: 'rgba(175,179,176,0.15)', color: '#292929', border: 'none' }}
        >
          <IconModalClose />
        </button>
      )}
    </div>
  )
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

function NewClassModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (sessionId: string) => void }) {
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !uploading) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, uploading])

  const handlePpt = useCallback((file: File) => { const err = validateFile(file, ['.ppt', '.pptx', '.pdf']); setPptError(err); if (!err) setPptFile(file) }, [])
  const handleAudio = useCallback((file: File) => { const err = validateFile(file, ['.mp3', '.wav', '.m4a', '.aac'], MAX_AUDIO_MB); setAudioError(err); if (!err) setAudioFile(file) }, [])
  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      // 拿到 session_id 后立即关闭 Modal，交给 LobbyPage 后台轮询
      onUploaded(result.session_id)
      onClose()
    } catch {
      setUploading(false)
      setUploadError('上传失败，请检查网络后重试')
    }
  }, [pptFile, audioFile, onUploaded, onClose])

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
              <h2 id="modal-title" className="font-bold text-[36px] leading-[1.11] tracking-[-0.025em] m-0" style={{ color: '#292929' }}>New Class</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭对话框" className="flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity" style={{ width: '40px', height: '40px', borderRadius: '9999px', backgroundColor: '#F2F2EC', color: '#292929', border: 'none' }}>
              <IconModalClose aria-hidden="true" />
            </button>
          </div>

          {/* Upload zones */}
          <div className="flex gap-0 items-stretch">
            <UploadZone label="PPT/PDF Materials" hint="Drag or click to upload" accept=".ppt,.pptx,.pdf" icon={<IconPPT />} file={pptFile} error={pptError} onFile={handlePpt} onClear={() => { setPptFile(null); setPptError(null) }} />
            <UploadZone label="Audio Recording" hint="Upload MP3, WAV or AAC" accept=".mp3,.wav,.m4a,.aac" icon={<IconAudioFile />} file={audioFile} error={audioError} onFile={handleAudio} onClear={() => { setAudioFile(null); setAudioError(null) }} />
          </div>

          {uploadError && (
            <div className="text-sm text-red-500 text-center -mt-6">{uploadError}</div>
          )}

          {/* CTA */}
          <div className="flex justify-end gap-4 items-center">
            <button onClick={onClose} className="cursor-pointer hover:opacity-70 transition-opacity font-bold text-sm uppercase tracking-[0.1em] bg-transparent border-none" style={{ color: '#72726E', padding: '13.5px 24px 14.5px' }}>
              CANCEL
            </button>
            <button
              onClick={handleSubmit} disabled={!canSubmit}
              className="px-8 py-3 rounded-full font-bold text-base border-none transition-all"
              style={{ backgroundColor: canSubmit ? '#798C00' : 'rgba(121,140,0,0.35)', color: '#FAF7F6', cursor: canSubmit ? 'pointer' : 'not-allowed', boxShadow: canSubmit ? '0px 4px 6px -4px rgba(0,0,0,0.1), 0px 10px 15px -3px rgba(0,0,0,0.1)' : 'none' }}
            >
              {uploading ? 'Uploading…' : 'Save Workspace'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Processing Toast ─────────────────────────────────────────────────────────

interface ToastState {
  sessionId: string
  step: string
  status: 'processing' | 'ready' | 'partial_ready' | 'error'
  errorMsg?: string
}

function ProcessingToast({ toast, onClose, onOpen }: {
  toast: ToastState
  onClose: () => void
  onOpen: () => void
}) {
  const isDone = toast.status === 'ready' || toast.status === 'partial_ready'
  const isError = toast.status === 'error'

  const STEP_LABELS: Record<string, string> = {
    uploading: '上传文件',
    converting: '音频格式转换',
    parsing_ppt: 'PPT 解析',
    transcribing: '语音转录',
    aligning: '语义对齐',
    generating: '生成结构化笔记',
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '16px 20px',
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        boxShadow: '0px 8px 24px -4px rgba(47,51,49,0.18), 0px 0px 0px 1px rgba(175,179,176,0.12)',
        fontFamily: 'Inter, system-ui, sans-serif',
        minWidth: '260px',
        maxWidth: '320px',
        animation: 'slideInToast 0.25s ease',
      }}
    >
      {/* Status icon */}
      <div style={{ flexShrink: 0, paddingTop: '2px' }}>
        {isDone ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="8.25" stroke="#292929" strokeWidth="1.5" fill="none" />
            <path d="M5.5 9l2.5 2.5 4.5-4.5" stroke="#292929" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : isError ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="8.25" stroke="rgba(224,92,64,0.8)" strokeWidth="1.5" fill="none" />
            <path d="M6 6l6 6M12 6l-6 6" stroke="rgba(224,92,64,0.8)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <div className="animate-spin" style={{ width: '18px', height: '18px' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7.5" stroke="rgba(95,94,94,0.2)" strokeWidth="2" />
              <path d="M9 1.5C4.86 1.5 1.5 4.86 1.5 9" stroke="#292929" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#292929', marginBottom: '2px' }}>
          {isDone ? '笔记已生成完成' : isError ? '处理失败' : '正在处理课堂录音'}
        </div>
        <div style={{ fontSize: '11px', color: '#72726E' }}>
          {isDone
            ? '点击查看笔记'
            : isError
            ? (toast.errorMsg || '请重新上传或稍后重试')
            : (STEP_LABELS[toast.step] ?? '处理中…')}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
        {isDone && (
          <button
            onClick={onOpen}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#FFFFFF',
              background: '#798C00',
              border: 'none',
              borderRadius: '9999px',
              padding: '4px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            查看
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="关闭通知"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(175,179,176,0.15)',
            color: '#292929',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}



export default function LobbyPage() {
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeNav, setActiveNav] = useState<'courses' | 'settings'>('courses')
  const [showModal, setShowModal] = useState(false)
  const [sessions, setSessions] = useState<CourseCard[]>(FALLBACK_SESSIONS)

  // ── Background processing toast ──────────────────────────────────────────
  const [toast, setToast] = useState<ToastState | null>(null)

  const handleUploaded = useCallback((sessionId: string) => {
    setToast({ sessionId, step: 'uploading', status: 'processing' })
  }, [])

  // Poll in background when toast is active
  useEffect(() => {
    if (!toast || toast.status !== 'processing') return
    const { sessionId } = toast
    let stopped = false

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`)
        if (!res.ok || stopped) return
        const data = await res.json()

        if (data.progress?.step) {
          setToast(prev => prev ? { ...prev, step: data.progress.step } : prev)
        }

        if (data.status === 'ready' || data.status === 'partial_ready') {
          stopped = true
          clearInterval(poll)
          setToast(prev => prev ? { ...prev, status: data.status } : prev)
          // Refresh session list
          listSessions()
            .then((refreshed) => {
              const cards: CourseCard[] = refreshed.map((s, i) => ({
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
            .catch(() => {})
        } else if (data.status === 'error') {
          stopped = true
          clearInterval(poll)
          setToast(prev => prev ? { ...prev, status: 'error', errorMsg: data.error } : prev)
        }
      } catch { /* 网络抖动继续轮询 */ }
    }, 2000)

    return () => { stopped = true; clearInterval(poll) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.sessionId, toast?.status])

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
    <div className="w-full min-h-screen flex font-['Inter'] pt-10" style={{ backgroundColor: '#F7F7F2' }}>

      {/* ── Sidebar ── */}
      <aside aria-label="侧边导航" className="w-48 flex-shrink-0 px-4 py-8 flex flex-col justify-between items-start min-h-screen" style={{ backgroundColor: '#F2F2EC' }}>
        {/* Brand */}
        <div className="self-stretch pb-10 flex flex-col justify-start items-start">
          <div className="self-stretch px-4 flex flex-col justify-start items-start">
            <div className="self-stretch text-lg font-bold font-['Inter'] leading-7" style={{ color: '#292929' }}>
              Student<br />Workspace
            </div>
            <div className="self-stretch opacity-60 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide mt-1" style={{ color: '#292929' }}>
              ACADEMIC YEAR 2026
            </div>
          </div>
        </div>

        {/* New Recording CTA */}
        <div className="self-stretch px-2 pb-8 flex flex-col justify-start items-start">
          <button
            onClick={() => setShowModal(true)}
            className="self-stretch px-4 py-3 rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] inline-flex justify-center items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity border-none"
            style={{ backgroundColor: '#798C00' }}
          >
            <IconMic />
            <span className="text-center text-stone-50 text-xs font-semibold font-['Inter'] leading-5 tracking-tight">Upload the<br />record</span>
          </button>
        </div>

        {/* Nav */}
        <div className="self-stretch flex-1 flex flex-col justify-start items-start gap-4">
          {/* Search */}
          <div className="self-stretch px-4 py-2 rounded-md inline-flex justify-between items-center cursor-pointer transition-colors" style={{ backgroundColor: 'rgba(227,227,218,0.3)' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(227,227,218,0.6)')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(227,227,218,0.3)')}>
            <div className="flex justify-start items-center gap-3" style={{ color: '#72726E' }}>
              <IconSearch />
              <span className="text-xs font-medium font-['Inter'] leading-5" style={{ color: '#72726E' }}>Search</span>
            </div>
            <div className="px-1.5 pt-px pb-[2.39px] rounded-2xl inline-flex flex-col justify-start items-start" style={{ backgroundColor: '#E3E3DA' }}>
              <span className="text-[9.60px] font-bold font-['IPAGothic'] leading-4" style={{ color: '#72726E' }}>⌘K</span>
            </div>
          </div>

          {/* Nav links */}
          <div className="self-stretch flex flex-col justify-start items-start gap-1">
            <button
              onClick={() => setActiveNav('courses')}
              className="self-stretch px-4 py-3 inline-flex justify-start items-center gap-3 cursor-pointer border-none bg-transparent transition-all"
              style={{ borderRight: activeNav === 'courses' ? '2px solid #798C00' : '2px solid transparent' }}
            >
              <span style={{ color: activeNav === 'courses' ? '#292929' : '#72726E' }}><IconCourse /></span>
              <span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>MY COURSES</span>
            </button>
            <button
              onClick={() => setActiveNav('settings')}
              className="self-stretch px-4 py-3 inline-flex justify-start items-center gap-3 cursor-pointer border-none bg-transparent transition-all"
              style={{ borderRight: activeNav === 'settings' ? '2px solid #798C00' : '2px solid transparent' }}
            >
              <span style={{ color: activeNav === 'settings' ? '#292929' : '#72726E' }}><IconSettings /></span>
              <span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>SETTINGS</span>
            </button>
          </div>
        </div>

        {/* User anchor */}
        <div className="self-stretch px-4 inline-flex justify-start items-center gap-3">
          <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: '#D0CFC5' }}>
            <span className="text-xs font-bold" style={{ color: '#72726E' }}>学</span>
          </div>
          <div className="inline-flex flex-col justify-start items-start overflow-hidden">
            <div className="self-stretch flex flex-col justify-start items-start overflow-hidden">
              <div className="text-xs font-bold font-['Inter'] leading-4" style={{ color: '#292929' }}>同学</div>
            </div>
            <div className="self-stretch h-3.5 relative overflow-hidden">
              <div className="left-0 top-[-1px] absolute text-[9.60px] font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>学生</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex-1 min-w-0 min-h-screen flex flex-col justify-start items-start" style={{ backgroundColor: '#F7F7F2' }}>

        {/* Header */}
        <div className="self-stretch px-12 py-6 backdrop-blur-md inline-flex justify-between items-center sticky top-16 z-10" style={{ backgroundColor: 'rgba(247,247,242,0.85)' }}>
          <div className="inline-flex flex-col justify-start items-start gap-0.5">
            <div className="self-stretch flex flex-col justify-start items-start">
              <div className="text-2xl font-black font-['Inter'] leading-8" style={{ color: '#292929' }}>Scholarly Workspace</div>
            </div>
            <div className="self-stretch flex flex-col justify-start items-start">
              <div className="text-[10.40px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>WELCOME BACK, YOUR RECORDINGS ARE UP TO DATE.</div>
            </div>
          </div>
          <div className="flex justify-start items-center gap-6">
            {/* Grid/List toggle */}
            <div className="p-1 rounded-full flex justify-start items-start gap-1" style={{ backgroundColor: '#F2F2EC' }}>
              <button
                onClick={() => setViewMode('grid')}
                className="px-4 py-1.5 rounded-full inline-flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'grid' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'grid' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}><IconGrid /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}>Grid</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className="px-4 py-1.5 rounded-full inline-flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'list' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'list' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}><IconList /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}>List</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="w-full max-w-[1400px] px-12 py-8 flex flex-col justify-start items-start gap-24">

          {/* Session cards */}
          {viewMode === 'grid' ? (
            <div className="self-stretch inline-flex flex-col justify-start items-start">
              <div className="self-stretch flex flex-wrap gap-6">
                {sessions.map((s) =>
                  s.status === 'processing'
                    ? <ProcessingCard key={s.id} />
                    : <DoneCard key={s.id} card={s} onClick={() => {
                        openTab({ sessionId: s.id, label: s.course })
                        navigate(`/notes/${s.id}`)
                      }} />
                )}
                {sessions.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 w-full">
                    <p className="text-sm mb-4" style={{ color: '#D0CFC5' }}>还没有任何课程记录</p>
                    <button
                      onClick={() => setShowModal(true)}
                      className="px-4 py-2 text-white text-sm rounded-full cursor-pointer hover:opacity-85 border-none"
                      style={{ backgroundColor: '#798C00' }}
                    >
                      开始第一次录音
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ListTable sessions={sessions} onRowClick={(id) => {
              const card = sessions.find((s) => s.id === id)
              openTab({ sessionId: id, label: card?.course ?? id })
              navigate(`/notes/${id}`)
            }} />
          )}

        </div>
      </div>

      {showModal && <NewClassModal onClose={() => setShowModal(false)} onUploaded={(sid) => { handleUploaded(sid); setShowModal(false) }} />}

      {toast && (
        <ProcessingToast
          toast={toast}
          onClose={() => setToast(null)}
          onOpen={() => {
            const card = sessions.find(s => s.id === toast.sessionId)
            openTab({ sessionId: toast.sessionId, label: card?.course ?? toast.sessionId })
            navigate(`/notes/${toast.sessionId}`)
            setToast(null)
          }}
        />
      )}

      <style>{`
        @keyframes slideInToast {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
