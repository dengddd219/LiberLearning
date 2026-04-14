import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

interface Stage {
  id: string
  label: string
  description: string
}

const STAGES: Stage[] = [
  { id: 'convert', label: '音频转换', description: '将录音转换为标准音频格式…' },
  { id: 'ppt', label: 'PPT 解析', description: '提取每页文本与图像内容…' },
  { id: 'asr', label: '语音转录', description: '将录音转换为带时间戳的文字稿…' },
  { id: 'align', label: '对齐与笔记生成', description: '将转录稿与课件语义对齐，逐页生成结构化笔记…' },
]

const STEP_MAP: Record<string, number> = {
  uploading: 0,
  converting: 0,
  parsing_ppt: 1,
  transcribing: 2,
  aligning: 3,
  generating: 3,
  done: 4,
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export default function ProcessingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? 'mock-session-001'

  const [currentStage, setCurrentStage] = useState(0)
  const [failed, setFailed] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const estimatedTotal = STAGES.length * 8

  useEffect(() => {
    if (failed) return

    const timer = setInterval(() => setElapsed((t) => t + 1), 1000)

    let done = false
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.progress?.step) {
          const stageIndex = STEP_MAP[data.progress.step] ?? 0
          setCurrentStage(stageIndex)
        }
        if ((data.status === 'ready' || data.status === 'partial_ready') && !done) {
          done = true
          clearInterval(poll)
          setCurrentStage(STAGES.length)
          setTimeout(() => navigate(`/notes/${sessionId}`), 400)
        } else if (data.status === 'error' && !done) {
          done = true
          clearInterval(poll)
          setFailed(true)
        }
      } catch {
        // network error — keep polling
      }
    }, 2000)

    return () => {
      clearInterval(timer)
      clearInterval(poll)
    }
  }, [failed, navigate, sessionId])

  const progress = Math.round((currentStage / STAGES.length) * 100)
  const remaining = Math.max(0, estimatedTotal - elapsed)

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface font-sans">
        <div className="bg-white rounded-2xl shadow p-10 max-w-sm w-full text-center">
          <div role="alert" aria-live="assertive">
            <svg
              aria-hidden="true"
              className="w-12 h-12 mx-auto mb-4 text-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <h2 className="text-lg font-bold text-gray-900 mb-2">处理失败</h2>
            <p className="text-sm text-gray-500 mb-6">语音转录服务暂时不可用，请稍后重试</p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => navigate('/upload')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              重新上传
            </button>
            <button
              type="button"
              onClick={() => setFailed(false)}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface font-sans">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-lg w-full">
        <h1 className="text-xl font-bold text-gray-900 mb-1">正在处理课堂录音</h1>
        <p className="text-sm text-gray-600 mb-8">
          {remaining > 0 ? `预计还需 ${remaining} 秒` : '仍在处理中，请稍候...'}
        </p>

        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="处理总进度"
          className="w-full bg-gray-100 rounded-full h-2 mb-8"
        >
          <div
            className="bg-primary h-2 rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="space-y-4">
          {STAGES.map((stage, i) => {
            const done = currentStage > i
            const active = currentStage === i
            return (
              <li
                key={stage.id}
                aria-label={`${stage.label}：${done ? '已完成' : active ? '进行中' : '等待中'}`}
                className="flex items-start gap-4"
              >
                <div
                  aria-hidden="true"
                  className={`flex-none w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    done
                      ? 'bg-green-500 text-white'
                      : active
                      ? 'bg-primary text-white animate-pulse'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className={`text-sm font-medium ${done ? 'text-gray-500' : active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {stage.label}
                  </p>
                  {active && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {stage.description}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
