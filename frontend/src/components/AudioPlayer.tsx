import { useRef, useState, useEffect, useCallback } from 'react'

interface AudioPlayerProps {
  src: string
  seekTo?: number | null
  onTimeUpdate?: (seconds: number) => void
}

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function AudioPlayer({ src, seekTo, onTimeUpdate }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  // Seek when external timestamp clicked
  useEffect(() => {
    if (seekTo == null || !audioRef.current) return
    audioRef.current.currentTime = seekTo
    audioRef.current.play()
    setPlaying(true)
  }, [seekTo])

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }, [playing])

  const skip = useCallback((delta: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + delta)
  }, [])

  const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Number(e.target.value)
  }, [])

  return (
    <div className="px-4 py-3 border-t border-gray-100 bg-white">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => {
          const t = (e.target as HTMLAudioElement).currentTime
          setCurrent(t)
          onTimeUpdate?.(t)
        }}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex items-center gap-3">
        {/* Skip back */}
        <button
          onClick={() => skip(-10)}
          className="text-gray-400 hover:text-gray-700 text-xs font-mono"
        >
          ◀10s
        </button>

        {/* Play/pause */}
        <button
          onClick={toggle}
          className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-600 text-sm"
        >
          {playing ? '⏸' : '▶'}
        </button>

        {/* Skip forward */}
        <button
          onClick={() => skip(10)}
          className="text-gray-400 hover:text-gray-700 text-xs font-mono"
        >
          10s▶
        </button>

        {/* Time */}
        <span className="text-xs font-mono text-gray-500 tabular-nums">
          {formatTime(current)}
        </span>

        {/* Seek bar */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={current}
          onChange={handleSeekBar}
          className="flex-1 h-1 accent-indigo-500 cursor-pointer"
        />

        <span className="text-xs font-mono text-gray-400 tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
