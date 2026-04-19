import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadPpt, uploadFiles } from '../lib/api'
import { useTranslation } from '../context/TranslationContext'

const MAX_AUDIO_MB = 500

function validateFile(file: File, accept: string[], maxMb?: number): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!accept.includes(ext)) return `不支持的格式，请上传 ${accept.join(' / ')}`
  if (maxMb && file.size > maxMb * 1024 * 1024) return `文件过大，最大支持 ${maxMb}MB`
  return null
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function IconPPTSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3" />
      <path d="M7 8h6M7 12h8M7 16h4" />
    </svg>
  )
}

function IconAudioSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10c0 3.866 3.134 7 7 7s7-3.134 7-7" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  )
}

interface PillUploadProps {
  label: string
  accept: string
  active: boolean
  fileName?: string
  onFile: (f: File) => void
  icon: React.ReactNode
}

function PillUpload({ label, accept, active, fileName, onFile, icon }: PillUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const displayLabel = active && fileName
    ? fileName.length > 18 ? fileName.slice(0, 16) + '…' : fileName
    : label

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
        borderRadius: '9999px',
        border: active ? '1.5px solid #2D6A4F' : '1.5px solid rgba(175,179,176,0.6)',
        backgroundColor: active ? 'rgba(45,106,79,0.08)' : 'transparent',
        color: active ? '#2D6A4F' : '#5F5E5E',
        fontSize: '13px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s ease',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      {icon}
      {displayLabel}
    </button>
  )
}

interface NewClassModalProps {
  onUploadSuccess?: (sessionId: string) => void
  onClose: () => void
}

export default function NewClassModal({ onUploadSuccess, onClose }: NewClassModalProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [pptError, setPptError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [pptId, setPptId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<'live' | 'upload' | null>('live')
  const [dragging, setDragging] = useState(false)

  const handlePpt = useCallback((file: File) => {
    const err = validateFile(file, ['.ppt', '.pptx', '.pdf'])
    setPptError(err)
    setPptId(null)
    if (!err) {
      setPptFile(file)
      uploadPpt(file).then(res => setPptId(res.ppt_id)).catch(() => {})
    }
  }, [])

  const handleAudio = useCallback((file: File) => {
    const err = validateFile(file, ['.mp3', '.wav', '.m4a', '.aac'], MAX_AUDIO_MB)
    setAudioError(err)
    if (!err) setAudioFile(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    setSelectedMode('upload')
    if (['.ppt', '.pptx', '.pdf'].includes(ext)) handlePpt(f)
    else if (['.mp3', '.wav', '.m4a', '.aac'].includes(ext)) handleAudio(f)
  }, [handlePpt, handleAudio])

  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    if (onUploadSuccess) {
      setUploading(true)
      setUploadError(null)
      try {
        const result = await uploadFiles(pptFile ?? undefined, audioFile, 'en', undefined, pptId ?? undefined)
        onUploadSuccess(result.session_id)
      } catch (err) {
        console.error('Upload failed:', err)
        setUploadError('上传失败，请检查网络后重试')
        setUploading(false)
      }
    } else {
      navigate('/notes/new', {
        state: { phase: 'processing', pptFile: pptFile ?? null, audioFile, pptId: pptId ?? null },
      })
    }
  }, [pptFile, audioFile, pptId, navigate, onUploadSuccess])

  const canSubmit = !!audioFile && !pptError && !audioError && !uploading

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-class-modal-title"
      style={{
        maxWidth: '680px',
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: '24px',
        border: '1px solid rgba(175, 179, 176, 0.1)',
        boxShadow: '0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '28px',
          padding: '32px 36px',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: '11px',
                lineHeight: '1.5',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'rgba(95, 94, 94, 0.6)',
              }}
            >
              ACTION CENTER
            </span>
            <h1
              id="new-class-modal-title"
              style={{
                fontWeight: 700,
                fontSize: '20px',
                lineHeight: '1.2',
                letterSpacing: '-0.02em',
                color: '#2F3331',
                margin: 0,
              }}
            >
              Transcribes or Uploads your class
              <br />
              <span style={{ fontWeight: 400, fontSize: '13px', color: '#6B7280', letterSpacing: 0 }}>
                When the class ends, LiberStudy{' '}
                <span className="blink-emoji">✨</span>{' '}
                <span style={{
                  color: '#2D6A4F',
                  fontWeight: 600,
                  background: 'linear-gradient(to bottom, transparent 55%, rgba(45,106,79,0.18) 55%)',
                  borderRadius: '999px',
                  padding: '0 4px',
                }}>enhances</span>{' '}
                the notes you've written
              </span>
            </h1>
          </div>

          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
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

        {/* Cards */}
        {!uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Live Class 卡 */}
            <div
              onClick={() => setSelectedMode('live')}
              style={{
                border: selectedMode === 'live' ? '1.5px solid #798C00' : '1.5px solid rgba(175,179,176,0.45)',
                borderRadius: '12px',
                padding: '18px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: selectedMode === 'live' ? 'rgba(121,140,0,0.04)' : 'rgba(175,179,176,0.06)',
                cursor: 'pointer',
                transition: 'border-color 0.25s ease, background-color 0.25s ease',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: '#2F3331', marginBottom: '2px' }}>
                  {t('live_card_title')}
                </div>
                <div style={{ fontSize: '12px', color: '#72726E' }}>
                  {t('live_card_desc')}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate('/live?new=1') }}
                style={{
                  backgroundColor: selectedMode === 'live' ? '#798C00' : '#AFB3B0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  padding: '10px 20px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background-color 0.25s ease',
                }}
              >
                {t('live_card_cta')} →
              </button>
            </div>

            {/* Upload Recording 卡 */}
            <div
              onClick={() => setSelectedMode('upload')}
              style={{
                border: selectedMode === 'upload' ? '1.5px solid #798C00' : '1.5px solid rgba(175,179,176,0.45)',
                borderRadius: '12px',
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                backgroundColor: selectedMode === 'upload' ? 'rgba(121,140,0,0.04)' : 'rgba(175,179,176,0.06)',
                cursor: 'pointer',
                transition: 'border-color 0.25s ease, background-color 0.25s ease',
              }}
            >
              {/* 卡片标题行 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#2F3331', marginBottom: '2px' }}>
                    Upload Recording
                  </div>
                  <div style={{ fontSize: '12px', color: '#72726E' }}>
                    Post-class upload · PPT/PDF + audio file
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleSubmit() }}
                  disabled={!canSubmit}
                  style={{
                    backgroundColor: canSubmit ? '#798C00' : '#AFB3B0',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '9999px',
                    padding: '10px 20px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                    transition: 'background-color 0.25s ease',
                  }}
                >
                  Start Review →
                </button>
              </div>

              {/* 拖放区 */}
              <div
                onClick={(e) => e.stopPropagation()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: dragging
                    ? '1.5px dashed rgba(45,106,79,0.5)'
                    : '1.5px dashed rgba(175,179,176,0.5)',
                  borderRadius: '10px',
                  backgroundColor: dragging ? 'rgba(45,106,79,0.04)' : 'rgba(175,179,176,0.05)',
                  padding: '36px 20px 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                  transition: 'border-color 0.2s, background-color 0.2s',
                }}
              >
                {/* 提示文字 */}
                <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontWeight: 600, fontSize: '16px', color: '#2F3331', marginBottom: '4px' }}>
                    或拖放文件
                  </div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                    PDF、PPT、音频
                  </div>
                </div>

                {/* 胶囊按钮行 */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <PillUpload
                    label="上传文件"
                    accept=".ppt,.pptx,.pdf,.mp3,.wav,.m4a,.aac"
                    active={!!(pptFile || audioFile)}
                    onFile={(f) => {
                      setSelectedMode('upload')
                      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
                      if (['.ppt', '.pptx', '.pdf'].includes(ext)) handlePpt(f)
                      else handleAudio(f)
                    }}
                    icon={<IconUpload />}
                  />
                  <PillUpload
                    label="PPT"
                    accept=".ppt,.pptx,.pdf"
                    active={!!pptFile && !pptError}
                    fileName={pptFile?.name}
                    onFile={(f) => { setSelectedMode('upload'); handlePpt(f) }}
                    icon={<IconPPTSmall />}
                  />
                  <PillUpload
                    label="音频"
                    accept=".mp3,.wav,.m4a,.aac"
                    active={!!audioFile && !audioError}
                    fileName={audioFile?.name}
                    onFile={(f) => { setSelectedMode('upload'); handleAudio(f) }}
                    icon={<IconAudioSmall />}
                  />
                </div>

                {/* 错误提示 */}
                {(pptError || audioError) && (
                  <div style={{ fontSize: '12px', color: 'var(--color-error)', textAlign: 'center' }}>
                    {pptError || audioError}
                  </div>
                )}
              </div>
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

        {uploadError && (
          <p role="alert" style={{ color: 'var(--color-error)', fontSize: '14px', margin: 0, textAlign: 'right' }}>
            {uploadError}
          </p>
        )}
        </div>
      </div>
  )
}
