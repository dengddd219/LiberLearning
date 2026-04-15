import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFiles } from '../lib/api'

// ─── Business logic ───────────────────────────────────────────────────────────

const MAX_AUDIO_MB = 500

function validateFile(file: File, accept: string[], maxMb?: number): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!accept.includes(ext)) return `不支持的格式，请上传 ${accept.join(' / ')}`
  if (maxMb && file.size > maxMb * 1024 * 1024) return `文件过大，最大支持 ${maxMb}MB`
  return null
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconClose() {
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

function IconAudio() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect x="12" y="4" width="12" height="18" rx="6" stroke="#AFB3B0" strokeWidth="1.5" />
      <path
        d="M6 18c0 6.627 5.373 12 12 12s12-5.373 12-12"
        stroke="#AFB3B0"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M18 30v4" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 34h8" stroke="#AFB3B0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

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
      role="button"
      tabIndex={0}
      aria-label={file ? `已选择：${file.name}，点击替换` : `点击或拖拽上传${label}文件`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
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
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />

      {/* Icon */}
      <div style={{ paddingBottom: '16px' }}>{icon}</div>

      {/* Label */}
      <div style={{ paddingBottom: '4px' }}>
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 700,
            fontSize: '14px',
            color: '#2F3331',
          }}
        >
          {isSuccess ? file!.name : label}
        </span>
      </div>

      {/* Hint / state */}
      <div>
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 400,
            fontSize: '11px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: error ? 'rgba(224,92,64,0.8)' : '#556071',
          }}
        >
          {error ? error : isSuccess ? '点击替换' : hint}
        </span>
      </div>

      {/* Remove button when file selected */}
      {isSuccess && (
        <button
          type="button"
          aria-label="移除已选文件"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className="absolute top-3 right-3 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '9999px',
            backgroundColor: 'transparent',
            color: '#5F5E5E',
            border: 'none',
            margin: '-10px',
          }}
        >
          <IconClose aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const navigate = useNavigate()
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

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
    setUploadError(null)
    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile)
      navigate(`/processing?session_id=${result.session_id}`)
    } catch (err) {
      console.error('Upload failed:', err)
      setUploadError('上传失败，请检查网络后重试')
      setUploading(false)
    }
  }, [pptFile, audioFile, navigate])

  const canSubmit = !!audioFile && !pptError && !audioError && !uploading

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  return (
    /* Full-screen overlay — Figma: layout_4H7FSJ */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(47, 51, 49, 0.2)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '24px',
        zIndex: 50,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Modal card — Figma: layout_7HZP3C */}
      <div
        className="relative w-full flex flex-col"
        style={{
          maxWidth: '768px',
          backgroundColor: '#FFFFFF',
          borderRadius: '48px',
          border: '1px solid rgba(175, 179, 176, 0.1)',
          boxShadow: '0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        {/* Inner container — Figma: layout_RZ7BPX, padding 48px, gap 48px */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '48px',
            padding: '48px',
          }}
        >
          {/* Header row — Figma: layout_S2TFPS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {/* Title block */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Eyebrow — "ACTION CENTER" */}
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '16px',
                  lineHeight: '1.5',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(95, 94, 94, 0.6)',
                }}
              >
                ACTION CENTER
              </span>
              {/* H1 — "New Class" */}
              <h1
                id="upload-modal-title"
                style={{
                  fontWeight: 700,
                  fontSize: '36px',
                  lineHeight: '1.11',
                  letterSpacing: '-0.025em',
                  color: '#2F3331',
                  margin: 0,
                }}
              >
                New Class
              </h1>
            </div>

            {/* Close button — Figma: layout_LQG0YF, 40×40, borderRadius 9999px */}
            <button
              type="button"
              aria-label="关闭，返回上一页"
              onClick={() => navigate(-1)}
              className="flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: '#F3F4F1',
                color: '#5F5E5E',
                border: 'none',
              }}
            >
              <IconClose aria-hidden="true" />
            </button>
          </div>

          {/* Upload areas — Figma: layout_D7G8JS (column, stretch) */}
          {!uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {/* Two side-by-side drop zones */}
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
                  icon={<IconAudio />}
                  file={audioFile}
                  error={audioError}
                  onFile={handleAudio}
                  onClear={() => { setAudioFile(null); setAudioError(null) }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                padding: '48px 0',
                color: '#5F5E5E',
                fontSize: '14px',
              }}
            >
              <svg
                width="24" height="24" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                className="animate-spin"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              <span>上传中，请稍候...</span>
            </div>
          )}

          {/* CTA row — Figma: layout_G94R1R (row, justify flex-end, gap 16px) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            {uploadError && (
              <p role="alert" style={{ color: 'var(--color-error)', fontSize: '14px', margin: 0 }}>
                {uploadError}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', alignItems: 'center' }}>
            {/* Cancel button */}
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="cursor-pointer hover:opacity-70 transition-opacity"
              style={{
                padding: '13.5px 24px 14.5px',
                fontWeight: 700,
                fontSize: '14px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#556071',
                background: 'none',
                border: 'none',
              }}
            >
              CANCEL
            </button>

            {/* Save / Submit button — Figma: layout_VBL07D, fill_6PCZJK, borderRadius 9999px */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="relative cursor-pointer transition-all duration-150"
              style={{
                padding: '12px 32px',
                borderRadius: '9999px',
                backgroundColor: canSubmit ? '#5F5E5E' : 'rgba(95,94,94,0.35)',
                color: '#FAF7F6',
                fontWeight: 700,
                fontSize: '16px',
                lineHeight: '1.5',
                border: 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                boxShadow: canSubmit
                  ? '0px 4px 6px -4px rgba(0,0,0,0.1), 0px 10px 15px -3px rgba(0,0,0,0.1)'
                  : 'none',
              }}
            >
              {uploading ? 'Processing…' : 'Save Workspace'}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
