// ── Replaced by Figma implementation ──
import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFiles } from '../lib/api'

const C = {
  bg: '#FAF9F7', fg: '#2F3331', secondary: '#556071', muted: '#777C79',
  placeholder: '#AFB3B0', border: 'rgba(175,179,176,0.1)',
  borderStrong: 'rgba(175,179,176,0.15)', sidebar: '#F3F4F1',
  dark: '#5F5E5E', white: '#FFFFFF',
}

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────

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
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M8.5 0.5L8.5 4.5L12.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M4 7h6M4 9.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function IconArrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M2 5h6M5.5 2.5 8 5l-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
      <path
        d="M8 0C8 0 3 3 3 9v4l-2 2v1h14v-1l-2-2V9C13 3 8 0 8 0Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6 16a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 9V2M7 2L4.5 4.5M7 2l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 10v1.5A0.5 0.5 0 0 0 2.5 12h9a0.5 0.5 0 0 0 0.5-0.5V10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
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
  thumbColor: string
  status: 'done' | 'processing'
}

const SESSIONS: CourseCard[] = [
  {
    id: 's-processing',
    course: '',
    lecture: '',
    duration: '',
    notes: 0,
    time: '',
    thumbColor: '#AFB3B0',
    status: 'processing',
  },
  {
    id: 's1',
    course: 'MSBA 7028: Predictive Analytics',
    lecture: 'Lecture 04: Linear Regression Models',
    duration: '42:15',
    notes: 12,
    time: '2H AGO',
    thumbColor: '#4A6FA5',
    status: 'done',
  },
  {
    id: 's2',
    course: 'ECON 8002: Advanced Macro',
    lecture: 'Week 2: Stochastic Growth Theory',
    duration: '58:02',
    notes: 28,
    time: 'YESTERDAY',
    thumbColor: '#6B8E6B',
    status: 'done',
  },
  {
    id: 's3',
    course: 'MGMT 6010: Digital Strategy',
    lecture: 'Seminar: Ecosystem Competition',
    duration: '35:40',
    notes: 5,
    time: 'OCT 24',
    thumbColor: '#8B7355',
    status: 'done',
  },
  {
    id: 's4',
    course: 'COMP 9001: Cybersecurity',
    lecture: 'Module 1: Threat Modeling Patterns',
    duration: '1:12:30',
    notes: 19,
    time: 'OCT 22',
    thumbColor: '#7B6B8B',
    status: 'done',
  },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProcessingCard() {
  return (
    <div
      className="relative rounded-[32px] overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        boxShadow: '0px 40px 40px -15px rgba(47, 51, 49, 0.04)',
      }}
    >
      {/* Skeleton slide thumbnail */}
      <div
        className="w-full flex items-center justify-center"
        style={{ backgroundColor: '#F3F4F1', aspectRatio: '16/9' }}
      >
        <div className="flex flex-col gap-3 w-[60%]">
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-full animate-pulse" />
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-4/5 animate-pulse" />
          <div className="h-3 rounded-full bg-[#AFB3B0]/40 w-3/5 animate-pulse" />
        </div>
      </div>

      {/* Skeleton info */}
      <div className="px-6 pt-4 pb-0">
        <div className="h-4 rounded bg-[#AFB3B0]/30 w-3/4 animate-pulse mb-2" />
        <div className="h-3 rounded bg-[#AFB3B0]/20 w-1/2 animate-pulse" />
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between mx-6 pt-4 pb-5"
        style={{ borderTop: '1px solid rgba(175, 179, 176, 0.1)', marginTop: '12px' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#AFB3B0]/50 animate-pulse" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#AFB3B0]/50 animate-pulse" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#AFB3B0]/50 animate-pulse" />
        </div>
        <span
          className="text-[10.4px] font-bold tracking-widest uppercase"
          style={{ color: '#5F5E5E', letterSpacing: '0.1em' }}
        >
          PROCESSING
        </span>
      </div>
    </div>
  )
}

interface DoneCardProps {
  card: CourseCard
  onClick: () => void
}

function DoneCard({ card, onClick }: DoneCardProps) {
  return (
    <div
      onClick={onClick}
      className="relative rounded-[32px] overflow-hidden cursor-pointer group"
      style={{
        backgroundColor: '#FFFFFF',
        boxShadow: '0px 40px 40px -15px rgba(47, 51, 49, 0.04)',
        transition: 'box-shadow 150ms ease, transform 150ms ease',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.boxShadow =
          '0px 40px 56px -15px rgba(47, 51, 49, 0.10)'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.boxShadow =
          '0px 40px 40px -15px rgba(47, 51, 49, 0.04)'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
      }}
    >
      {/* Slide thumbnail */}
      <div className="relative w-full" style={{ aspectRatio: '16/9', backgroundColor: card.thumbColor, opacity: 0.85 }}>
        {/* Duration badge */}
        <div
          className="absolute bottom-3 right-3 px-2 py-[3px] rounded-2xl"
          style={{ backgroundColor: 'rgba(47, 51, 49, 0.88)' }}
        >
          <span
            className="text-[10.4px] text-white"
            style={{ fontFamily: 'ui-monospace, "Liberation Mono", "Courier New", monospace' }}
          >
            {card.duration}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="px-6 pt-4 pb-0">
        <p
          className="text-[15.2px] font-bold leading-[1.5] mb-1 truncate"
          style={{ color: '#2F3331' }}
        >
          {card.course}
        </p>
        <p
          className="text-[12px] font-medium leading-[1.5] truncate"
          style={{ color: '#556071' }}
        >
          {card.lecture}
        </p>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between mx-6 pt-4 pb-5"
        style={{ borderTop: '1px solid rgba(175, 179, 176, 0.1)', marginTop: '12px' }}
      >
        <div className="flex items-center gap-1" style={{ color: '#556071' }}>
          <IconNotes />
          <span className="text-[11.2px]" style={{ color: '#556071' }}>
            {card.notes} notes
          </span>
        </div>
        <span
          className="text-[10.4px] font-bold uppercase"
          style={{ color: '#777C79', letterSpacing: '0.1em' }}
        >
          {card.time}
        </span>
      </div>
    </div>
  )
}

// ─── New Class Modal ──────────────────────────────────────────────────────────

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
      <path d="M18 30v4" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 34h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
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
  label: string
  hint: string
  accept: string
  icon: React.ReactNode
  file: File | null
  error: string | null
  onFile: (file: File) => void
  onClear: () => void
}

function UploadZone({ label, hint, accept, icon, file, error, onFile, onClear }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const isSuccess = !!file && !error

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) onFile(dropped)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="relative flex flex-col items-center justify-center cursor-pointer transition-all duration-150"
      style={{
        borderRadius: '32px',
        border: error
          ? '2px dashed rgba(224, 92, 64, 0.5)'
          : isSuccess
          ? '2px dashed rgba(95, 94, 94, 0.4)'
          : dragging
          ? '2px dashed rgba(95, 94, 94, 0.5)'
          : '2px dashed rgba(175, 179, 176, 0.2)',
        padding: '32px',
        flex: 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      <div style={{ paddingBottom: '16px' }}>{icon}</div>
      <div style={{ paddingBottom: '4px' }}>
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#2F3331' }}>
          {isSuccess ? file!.name : label}
        </span>
      </div>
      <span style={{ fontWeight: 400, fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', color: error ? 'rgba(224,92,64,0.8)' : '#556071' }}>
        {error ? error : isSuccess ? 'Click to replace' : hint}
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

interface NewClassModalProps {
  onClose: () => void
  navigate: ReturnType<typeof useNavigate>
}

function NewClassModal({ onClose, navigate }: NewClassModalProps) {
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const handlePpt = useCallback((file: File) => {
    const err = validateFile(file, ['.ppt', '.pptx', '.pdf'])
    setPptError(err)
    if (!err) setPptFile(file)
  }, [])

  const handleAudio = useCallback((file: File) => {
    const err = validateFile(file, ['.mp3', '.wav', '.m4a', '.aac'], MAX_AUDIO_MB)
    setAudioError(err)
    if (!err) setAudioFile(file)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    setUploading(true)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch {
      navigate('/processing?session_id=mock-session-001')
    }
  }, [pptFile, audioFile, navigate])

  const canSubmit = !!audioFile && !pptError && !audioError && !uploading

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(47, 51, 49, 0.2)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', padding: '24px' }}
      onClick={onClose}
    >
      <div
        className="relative w-full flex flex-col"
        style={{ maxWidth: '768px', backgroundColor: '#FFFFFF', borderRadius: '48px', border: '1px solid rgba(175, 179, 176, 0.1)', boxShadow: '0px 25px 50px -12px rgba(0, 0, 0, 0.25)', fontFamily: 'Inter, system-ui, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', padding: '48px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '16px', lineHeight: '1.5', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(95, 94, 94, 0.6)' }}>
                ACTION CENTER
              </span>
              <h2 style={{ fontWeight: 700, fontSize: '36px', lineHeight: '1.11', letterSpacing: '-0.025em', color: '#2F3331', margin: 0 }}>
                New Class
              </h2>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
              style={{ width: '40px', height: '40px', borderRadius: '9999px', backgroundColor: '#F3F4F1', color: '#5F5E5E', border: 'none' }}
            >
              <IconModalClose />
            </button>
          </div>

          {/* Upload areas */}
          {!uploading ? (
            <div style={{ display: 'flex', gap: '0', alignItems: 'stretch' }}>
              <UploadZone
                label="PPT/PDF Materials"
                hint="Drag or click to upload"
                accept=".ppt,.pptx,.pdf"
                icon={<IconPPT />}
                file={pptFile}
                error={pptError}
                onFile={handlePpt}
                onClear={() => { setPptFile(null); setPptError(null) }}
              />
              <UploadZone
                label="Audio Recording"
                hint="Upload MP3, WAV or AAC"
                accept=".mp3,.wav,.m4a,.aac"
                icon={<IconAudioFile />}
                file={audioFile}
                error={audioError}
                onFile={handleAudio}
                onClear={() => { setAudioFile(null); setAudioError(null) }}
              />
            </div>
          ) : (
            /* Processing state */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: '#5F5E5E', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, fontSize: '14px', color: '#2F3331' }}>
                      Synthesis engine is mapping audio to visual anchors...
                    </span>
                  </div>
                  <span style={{ fontWeight: 900, fontSize: '18px', color: '#2F3331' }}>68%</span>
                </div>
                <div style={{ height: '12px', borderRadius: '9999px', backgroundColor: '#E6E9E6', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '68%', borderRadius: '9999px', background: 'linear-gradient(90deg, #5F5E5E 0%, #535252 100%)', boxShadow: '0px 0px 20px 0px rgba(95, 94, 94, 0.2)' }} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid rgba(175, 179, 176, 0.1)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <IconCheckCircle />
                  <span style={{ fontWeight: 500, fontSize: '14px', color: '#2F3331' }}>Transcription complete</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="animate-spin"><IconLoadingCircle /></div>
                  <span style={{ fontWeight: 400, fontSize: '14px', color: '#556071' }}>Alignment in progress...</span>
                </div>
                <div style={{ borderRadius: '32px', backgroundColor: '#F3F4F1', padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5F5E5E' }}>PAGE 3/18</span>
                    <span style={{ fontWeight: 700, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5F5E5E' }}>GENERATING NOTES...</span>
                  </div>
                  <div style={{ height: '4px', borderRadius: '9999px', backgroundColor: '#E0E3E0', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '25%', borderRadius: '9999px', backgroundColor: 'rgba(95,94,94,0.4)' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CTA row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', alignItems: 'center' }}>
            <button
              onClick={onClose}
              className="cursor-pointer hover:opacity-70 transition-opacity"
              style={{ padding: '13.5px 24px 14.5px', fontWeight: 700, fontSize: '14px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#556071', background: 'none', border: 'none' }}
            >
              CANCEL
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ padding: '12px 32px', borderRadius: '9999px', backgroundColor: canSubmit ? '#5F5E5E' : 'rgba(95,94,94,0.35)', color: '#FAF7F6', fontWeight: 700, fontSize: '16px', border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed', boxShadow: canSubmit ? '0px 4px 6px -4px rgba(0,0,0,0.1), 0px 10px 15px -3px rgba(0,0,0,0.1)' : 'none' }}
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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeNav, setActiveNav] = useState<'courses' | 'settings'>('courses')
  const [showModal, setShowModal] = useState(false)

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: '#FAF9F7', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* ── Sidebar ── */}
      <aside
        className="fixed top-0 left-0 h-full flex flex-col justify-between z-20"
        style={{
          width: '200px',
          backgroundColor: '#F3F4F1',
          borderRight: '1px solid rgba(175, 179, 176, 0.15)',
          padding: '28px 12px 24px',
        }}
      >
        {/* Top section */}
        <div className="flex flex-col gap-0">
          {/* Brand */}
          <div style={{ padding: '4px 12px', paddingBottom: '32px' }}>
            <h1
              className="font-bold leading-tight"
              style={{ fontSize: '20px', color: '#2F3331', letterSpacing: '-0.04em' }}
            >
              LiberStudy
            </h1>
            <p
              className="font-normal uppercase mt-1"
              style={{ fontSize: '10px', color: '#2F3331', opacity: 0.55, letterSpacing: '0.05em' }}
            >
              ACADEMIC YEAR 2026
            </p>
          </div>

          {/* New session CTA */}
          <div style={{ paddingBottom: '28px', paddingLeft: '4px', paddingRight: '4px' }}>
            <button
              onClick={() => setShowModal(true)}
              className="w-full flex items-center justify-center gap-2 font-semibold rounded-full cursor-pointer transition-all duration-150 hover:opacity-85"
              style={{
                padding: '11px 16px',
                backgroundColor: '#5F5E5E',
                color: '#FAF9F7',
                fontSize: '12px',
                letterSpacing: '0.02em',
                boxShadow: '0px 1px 3px rgba(0,0,0,0.08)',
              }}
            >
              <IconMic />
              <span>New Recording</span>
            </button>
          </div>

          {/* Search */}
          <div
            className="flex items-center justify-between rounded-lg cursor-pointer transition-all duration-150 hover:bg-[#E6E9E6]/60"
            style={{
              padding: '8px 12px',
              marginBottom: '8px',
              backgroundColor: 'rgba(224, 227, 224, 0.25)',
            }}
          >
            <div className="flex items-center gap-3" style={{ color: '#556071' }}>
              <IconSearch />
              <span className="font-medium" style={{ fontSize: '12.8px', color: '#556071' }}>
                Search
              </span>
            </div>
            <div
              className="rounded"
              style={{
                padding: '1px 5px',
                backgroundColor: '#E0E3E0',
              }}
            >
              <span style={{ fontSize: '9px', color: '#777C79', fontWeight: 700 }}>⌘K</span>
            </div>
          </div>

          {/* Nav label */}
          <p
            className="uppercase font-bold"
            style={{
              fontSize: '9.5px',
              color: '#AFB3B0',
              letterSpacing: '0.1em',
              padding: '0 12px',
              marginBottom: '4px',
              marginTop: '8px',
            }}
          >
            COURSES
          </p>

          {/* Nav links */}
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => setActiveNav('courses')}
              className="flex items-center gap-3 rounded-lg text-left w-full cursor-pointer transition-all duration-150"
              style={{
                padding: '9px 12px',
                backgroundColor: activeNav === 'courses' ? 'rgba(47, 51, 49, 0.06)' : 'transparent',
                borderBottom: activeNav === 'courses' ? 'none' : 'none',
              }}
            >
              <span style={{ color: activeNav === 'courses' ? '#2F3331' : '#777C79' }}>
                <IconCourse />
              </span>
              <span
                className="font-medium uppercase"
                style={{
                  fontSize: '11px',
                  color: activeNav === 'courses' ? '#2F3331' : '#777C79',
                  letterSpacing: '0.05em',
                }}
              >
                My Courses
              </span>
            </button>

            <button
              onClick={() => setActiveNav('settings')}
              className="flex items-center gap-3 rounded-lg text-left w-full cursor-pointer transition-all duration-150"
              style={{
                padding: '9px 12px',
                backgroundColor: activeNav === 'settings' ? 'rgba(47, 51, 49, 0.06)' : 'transparent',
              }}
            >
              <span style={{ color: activeNav === 'settings' ? '#2F3331' : '#777C79' }}>
                <IconSettings />
              </span>
              <span
                className="font-medium uppercase"
                style={{
                  fontSize: '11px',
                  color: activeNav === 'settings' ? '#2F3331' : '#777C79',
                  letterSpacing: '0.05em',
                }}
              >
                Settings
              </span>
            </button>
          </div>
        </div>

        {/* User anchor */}
        <div className="flex items-center gap-3" style={{ padding: '0 12px' }}>
          <div
            className="rounded-full flex-shrink-0 flex items-center justify-center"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: '#C8C9C0',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#5F5E5E' }}>A</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate" style={{ fontSize: '12px', color: '#2F3331' }}>
              Alex Chen
            </p>
            <p className="truncate" style={{ fontSize: '9.6px', color: '#556071' }}>Graduate Student</p>
          </div>
        </div>
      </aside>

      {/* ── Main content (offset by sidebar) ── */}
      <div className="flex-1 flex flex-col" style={{ marginLeft: '200px' }}>
        {/* ── Top App Bar ── */}
        <header
          className="sticky top-0 z-10 flex items-center justify-between"
          style={{
            height: '64px',
            padding: '0 48px',
            backgroundColor: 'rgba(250, 249, 247, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderBottom: '1px solid rgba(175, 179, 176, 0.1)',
          }}
        >
          {/* Left: title + subtitle */}
          <div>
            <h2
              className="font-black leading-tight"
              style={{ fontSize: '22px', letterSpacing: '-0.025em', color: '#2F3331' }}
            >
              Scholarly Workspace
            </h2>
            <p
              className="font-normal uppercase"
              style={{ fontSize: '10px', color: '#556071', marginTop: '1px', letterSpacing: '0.1em' }}
            >
              WELCOME BACK, YOUR RECORDINGS ARE UP TO DATE.
            </p>
          </div>

          {/* Right: nav links + toggle + bell + avatar */}
          <div className="flex items-center gap-6">
            {/* Nav links */}
            <nav className="flex items-center gap-5">
              <button
                className="cursor-pointer transition-all duration-150 hover:opacity-70"
                style={{ fontSize: '12px', color: '#777C79', fontWeight: 500 }}
              >
                Dashboard
              </button>
              <button
                className="cursor-pointer"
                style={{
                  fontSize: '12px',
                  color: '#2F3331',
                  fontWeight: 700,
                  borderBottom: '1.5px solid #2F3331',
                  paddingBottom: '1px',
                }}
              >
                Courses
              </button>
              <button
                className="cursor-pointer transition-all duration-150 hover:opacity-70"
                style={{ fontSize: '12px', color: '#777C79', fontWeight: 500 }}
              >
                Detailed Note
              </button>
            </nav>

            {/* Grid/List toggle */}
            <div
              className="flex items-center rounded-full p-1"
              style={{ backgroundColor: '#F3F4F1', gap: '2px' }}
            >
              <button
                onClick={() => setViewMode('grid')}
                className="flex items-center gap-1.5 rounded-full cursor-pointer transition-all duration-150"
                style={{
                  padding: '5px 14px',
                  backgroundColor: viewMode === 'grid' ? '#FFFFFF' : 'transparent',
                  color: viewMode === 'grid' ? '#2F3331' : '#777C79',
                  boxShadow: viewMode === 'grid' ? '0px 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <IconGrid />
                <span className="font-bold" style={{ fontSize: '11px' }}>Grid</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className="flex items-center gap-1.5 rounded-full cursor-pointer transition-all duration-150"
                style={{
                  padding: '5px 14px',
                  backgroundColor: viewMode === 'list' ? '#FFFFFF' : 'transparent',
                  color: viewMode === 'list' ? '#2F3331' : '#777C79',
                  boxShadow: viewMode === 'list' ? '0px 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <IconList />
                <span className="font-bold" style={{ fontSize: '11px' }}>List</span>
              </button>
            </div>

            {/* Bell */}
            <button
              className="flex items-center justify-center cursor-pointer transition-all duration-150 hover:opacity-70"
              style={{ color: '#2F3331' }}
            >
              <IconBell />
            </button>

            {/* Avatar */}
            <div
              className="rounded-full flex-shrink-0 flex items-center justify-center cursor-pointer"
              style={{ width: '32px', height: '32px', backgroundColor: '#C8C9C0' }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#5F5E5E' }}>A</span>
            </div>
          </div>
        </header>

        {/* ── Main Content ── */}
        <main
          className="flex-1"
          style={{ padding: '32px 48px 100px', display: 'flex', flexDirection: 'column', gap: '64px' }}
        >
          {/* Session grid / list */}
          <section>
            <div
              className={viewMode === 'grid' ? 'grid grid-cols-4 gap-6' : 'flex flex-col gap-4'}
            >
              {SESSIONS.map((s) =>
                s.status === 'processing' ? (
                  <ProcessingCard key={s.id} />
                ) : (
                  <DoneCard
                    key={s.id}
                    card={s}
                    onClick={() => navigate(`/notes/${s.id}`)}
                  />
                ),
              )}
            </div>
          </section>

          {/* CTA section */}
          <section
            className="relative flex flex-col"
            style={{
              borderTop: '1px solid rgba(175, 179, 176, 0.12)',
              paddingTop: '48px',
              minHeight: '240px',
            }}
          >
            {/* Icon decoration */}
            <div
              className="absolute"
              style={{ right: '80px', top: '56px' }}
            >
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: '72px',
                  height: '72px',
                  backgroundColor: '#F3F4F1',
                  color: '#777C79',
                }}
              >
                <IconMic />
              </div>
            </div>

            {/* Upload decoration */}
            <div
              className="absolute"
              style={{ right: '172px', top: '80px' }}
            >
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: '48px',
                  height: '48px',
                  backgroundColor: '#F3F4F1',
                  color: '#AFB3B0',
                }}
              >
                <IconUpload />
              </div>
            </div>

            {/* Text + CTA */}
            <div className="flex flex-col items-start" style={{ maxWidth: '480px' }}>
              <h3
                className="font-bold"
                style={{ fontSize: '18px', color: '#2F3331', lineHeight: '1.45' }}
              >
                Start a live recording
              </h3>
              <p
                className="mt-2"
                style={{ fontSize: '13px', color: '#556071', lineHeight: '1.65' }}
              >
                Capture your lecture audio and slides automatically.
                <br />
                LiberStudy will transcribe and summarize everything for you.
              </p>

              <div className="flex items-center gap-4 mt-6">
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 cursor-pointer transition-all duration-150 hover:opacity-70"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: '#5F5E5E',
                  }}
                >
                  START RECORDING
                  <IconArrow />
                </button>

                <div style={{ width: '1px', height: '12px', backgroundColor: 'rgba(175,179,176,0.4)' }} />

                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 cursor-pointer transition-all duration-150 hover:opacity-70"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: '#777C79',
                  }}
                >
                  UPLOAD FILES
                  <IconArrow />
                </button>
              </div>
            </div>
          </section>
        </main>

        {/* ── Global Footer ── */}
        <footer
          className="flex items-center justify-between flex-shrink-0"
          style={{
            height: '40px',
            padding: '0 32px',
            borderTop: '1px solid rgba(175, 179, 176, 0.15)',
          }}
        >
          <span
            className="uppercase"
            style={{ fontSize: '10px', color: '#556071', letterSpacing: '0.1em' }}
          >
            © 2024 LIBERSTUDY EDITORIAL. CRAFTED FOR CLARITY.
          </span>
          <div className="flex items-center gap-4">
            {['SUPPORT', 'PRIVACY', 'TERMS'].map((link) => (
              <button
                key={link}
                className="cursor-pointer transition-all duration-150 hover:opacity-70"
                style={{
                  fontSize: '10px',
                  color: '#556071',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}
              >
                {link}
              </button>
            ))}
          </div>
        </footer>
      </div>

      {showModal && (
        <NewClassModal onClose={() => setShowModal(false)} navigate={navigate} />
      )}
    </div>
  )
}
