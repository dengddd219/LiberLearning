import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

interface Stage {
  id: string
  label: string
  description: string
}

const STAGES: Stage[] = [
  { id: 'asr', label: '语音转录', description: '将录音转换为带时间戳的文字稿…' },
  { id: 'ppt', label: 'PPT 解析', description: '提取每页文本与图像内容…' },
  { id: 'align', label: '时间轴构建', description: '将转录稿与课件页面语义对齐…' },
  { id: 'notes', label: '笔记生成', description: '逐页生成结构化学习笔记…' },
]

export default function ProcessingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? 'mock-session-001'

  const [currentStage, setCurrentStage] = useState(0)
  const [pageProgress, setPageProgress] = useState({ current: 0, total: 3 })
  const [failed, setFailed] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const estimatedTotal = STAGES.length * 8

  useEffect(() => {
    if (failed) return

    const timer = setInterval(() => setElapsed((t) => t + 1), 1000)

    const timings = [1500, 2500, 4000, 6000]
    const timeouts: ReturnType<typeof setTimeout>[] = []

    STAGES.forEach((_, i) => {
      timeouts.push(
        setTimeout(() => {
          setCurrentStage(i + 1)
          if (i === 3) {
            let p = 0
            const pageTick = setInterval(() => {
              p++
              setPageProgress({ current: p, total: 3 })
              if (p >= 3) {
                clearInterval(pageTick)
                setTimeout(() => navigate(`/notes/${sessionId}`), 600)
              }
            }, 400)
          }
        }, timings[i])
      )
    })

    return () => {
      clearInterval(timer)
      timeouts.forEach(clearTimeout)
    }
  }, [failed, navigate, sessionId])

  const progress = Math.round((currentStage / STAGES.length) * 100)
  const remaining = Math.max(0, estimatedTotal - elapsed)

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-10 max-w-sm w-full text-center">
          <span className="text-4xl mb-4 block">❌</span>
          <h2 className="text-lg font-bold text-gray-900 mb-2">处理失败</h2>
          <p className="text-sm text-gray-500 mb-6">语音转录服务暂时不可用，请稍后重试</p>
          <button
            onClick={() => { setFailed(false); setCurrentStage(0); setElapsed(0) }}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700"
          >
            重新处理
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-lg w-full">
        <h1 className="text-xl font-bold text-gray-900 mb-1">正在处理课堂录音</h1>
        <p className="text-sm text-gray-400 mb-8">预计还需 {remaining} 秒</p>

        <div className="w-full bg-gray-100 rounded-full h-2 mb-8">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="space-y-4">
          {STAGES.map((stage, i) => {
            const done = currentStage > i
            const active = currentStage === i
            return (
              <li key={stage.id} className="flex items-start gap-4">
                <div
                  className={`flex-none w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    done
                      ? 'bg-green-500 text-white'
                      : active
                      ? 'bg-indigo-500 text-white animate-pulse'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className={`text-sm font-medium ${done ? 'text-gray-400 line-through' : active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {stage.label}
                  </p>
                  {active && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {i === 3
                        ? `第 ${pageProgress.current}/${pageProgress.total} 页笔记生成中…`
                        : stage.description}
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
