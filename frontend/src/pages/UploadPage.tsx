import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import FileUpload from '../components/FileUpload'
import { uploadFiles } from '../lib/api'

const MAX_AUDIO_MB = 500

function validateFile(file: File, accept: string[], maxMb?: number): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!accept.includes(ext)) return `不支持的格式，请上传 ${accept.join(' / ')}`
  if (maxMb && file.size > maxMb * 1024 * 1024) return `文件过大，最大支持 ${maxMb}MB`
  return null
}

export default function UploadPage() {
  const navigate = useNavigate()
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
    const err = validateFile(file, ['.mp3', '.wav', '.m4a'], MAX_AUDIO_MB)
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">上传课堂录音</h1>
        <p className="text-sm text-gray-500 mb-8">上传 PPT（可选）+ 音频录音，生成结构化课堂笔记</p>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div>
            <FileUpload
              label="上传 PPT（可选）"
              hint=".ppt / .pptx / .pdf"
              accept=".ppt,.pptx,.pdf"
              onFile={handlePpt}
              uploaded={!!pptFile && !pptError}
            />
            {pptError && <p className="text-xs text-red-500 mt-2">{pptError}</p>}
            {pptFile && !pptError && (
              <p className="text-xs text-gray-400 mt-2 truncate">{pptFile.name}</p>
            )}
          </div>
          <div>
            <FileUpload
              label="上传音频录音 *"
              hint=".mp3 / .wav / .m4a（最大 500MB）"
              accept=".mp3,.wav,.m4a"
              onFile={handleAudio}
              uploaded={!!audioFile && !audioError}
            />
            {audioError && <p className="text-xs text-red-500 mt-2">{audioError}</p>}
            {audioFile && !audioError && (
              <p className="text-xs text-gray-400 mt-2 truncate">{audioFile.name}</p>
            )}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? '上传中…' : '开始处理 →'}
        </button>
        {!audioFile && (
          <p className="text-xs text-gray-400 text-center mt-2">请先上传音频录音</p>
        )}
      </div>
    </div>
  )
}
