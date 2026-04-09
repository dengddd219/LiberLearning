import { useState, useEffect, useRef, useCallback } from 'react'
import { saveAudioChunk, saveSession } from '../lib/idb'

interface RecordingControlProps {
  sessionId: string
  onStop: (chunks: Blob[]) => void
}

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped'

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function RecordingControl({ sessionId, onStop }: RecordingControlProps) {
  const [state, setState] = useState<RecordingState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const chunkIndexRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sliceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (sliceTimerRef.current) clearInterval(sliceTimerRef.current)
  }

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          await saveAudioChunk(sessionId, chunkIndexRef.current++, e.data)
        }
      }

      mr.start()
      setState('recording')
      setError(null)

      // elapsed counter
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000)

      // slice every 10 minutes to persist
      sliceTimerRef.current = setInterval(() => {
        if (mr.state === 'recording') mr.requestData()
      }, 10 * 60 * 1000)

      await saveSession({
        id: sessionId,
        status: 'recording',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    } catch (err) {
      setError('无法访问麦克风，请检查权限设置')
      console.error(err)
    }
  }, [sessionId])

  const pause = useCallback(() => {
    mediaRecorderRef.current?.pause()
    setState('paused')
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const resume = useCallback(() => {
    mediaRecorderRef.current?.resume()
    setState('recording')
    timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000)
  }, [])

  const stop = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (!mr) return
    mr.onstop = () => {
      onStop(chunksRef.current)
    }
    mr.stop()
    mr.stream.getTracks().forEach((t) => t.stop())
    stopTimers()
    setState('stopped')
  }, [onStop])

  useEffect(() => {
    return () => stopTimers()
  }, [])

  return (
    <div className="p-4 border-b border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">录音控制</span>
        <span
          className={`text-lg font-mono font-bold ${
            state === 'recording' ? 'text-red-500' : 'text-gray-500'
          }`}
        >
          {formatTime(elapsed)}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-2 bg-red-50 rounded p-2">{error}</p>
      )}

      <div className="flex gap-2">
        {state === 'idle' && (
          <button
            onClick={start}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            开始录音
          </button>
        )}

        {state === 'recording' && (
          <>
            <button
              onClick={pause}
              className="flex-1 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm transition-colors"
            >
              暂停
            </button>
            <button
              onClick={stop}
              className="flex-1 px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 text-sm transition-colors"
            >
              停止
            </button>
          </>
        )}

        {state === 'paused' && (
          <>
            <button
              onClick={resume}
              className="flex-1 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm transition-colors"
            >
              继续录音
            </button>
            <button
              onClick={stop}
              className="flex-1 px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 text-sm transition-colors"
            >
              停止
            </button>
          </>
        )}

        {state === 'stopped' && (
          <p className="text-sm text-gray-500">录音已停止，共 {formatTime(elapsed)}</p>
        )}
      </div>
    </div>
  )
}
