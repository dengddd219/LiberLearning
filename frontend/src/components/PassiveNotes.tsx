interface Bullet {
  text: string
  ai_comment: string
  timestamp: number
}

interface PassiveNotesData {
  bullets: Bullet[]
}

interface PassiveNotesProps {
  data: PassiveNotesData
  pageSupplement?: { content: string; timestamp_start: number; timestamp_end: number } | null
  onTimestampClick?: (seconds: number) => void
  granularity: 'simple' | 'detailed'
}

function formatTimestamp(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function PassiveNotes({
  data,
  pageSupplement,
  onTimestampClick,
  granularity,
}: PassiveNotesProps) {
  return (
    <div className="space-y-3">
      {data.bullets.map((bullet, i) => (
        <div key={i} className="group">
          <div className="flex items-start gap-2">
            <span className="flex-none mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <div className="flex-1">
              <p className="text-sm text-gray-800 leading-relaxed">{bullet.text}</p>
              {granularity === 'detailed' && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed border-l-2 border-gray-200 pl-2">
                  {bullet.ai_comment}
                </p>
              )}
            </div>
            <button
              onClick={() => onTimestampClick?.(bullet.timestamp)}
              className="flex-none text-xs text-indigo-400 hover:text-indigo-600 font-mono opacity-0 group-hover:opacity-100 transition-opacity"
            >
              [{formatTimestamp(bullet.timestamp)}]
            </button>
          </div>
        </div>
      ))}

      {pageSupplement && (
        <div className="mt-4 border-t border-dashed border-gray-200 pt-4">
          <p className="text-xs font-semibold text-amber-600 mb-2">📌 脱离课件内容</p>
          <p className="text-sm text-gray-700 leading-relaxed">{pageSupplement.content}</p>
          <button
            onClick={() => onTimestampClick?.(pageSupplement.timestamp_start)}
            className="text-xs text-indigo-400 hover:text-indigo-600 font-mono mt-1"
          >
            [{formatTimestamp(pageSupplement.timestamp_start)} – {formatTimestamp(pageSupplement.timestamp_end)}]
          </button>
        </div>
      )}
    </div>
  )
}
