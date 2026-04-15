import { useState } from 'react'

interface Bullet {
  ppt_text: string
  level: number
  ai_comment: string | null
  timestamp_start: number
  timestamp_end: number
}

interface PassiveNotesData {
  bullets: Bullet[]
  error?: string
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

// level 0 → slide title style, level 1 → top bullet, level 2+ → indented sub-bullet
const LEVEL_STYLES: Record<number, string> = {
  0: 'text-[13px] font-semibold text-gray-900',
  1: 'text-sm text-gray-800',
  2: 'text-sm text-gray-700',
}

const LEVEL_INDENT: Record<number, string> = {
  0: 'ml-0',
  1: 'ml-0',
  2: 'ml-4',
  3: 'ml-8',
}

function getBulletStyle(level: number) {
  return LEVEL_STYLES[Math.min(level, 2)]
}

function getIndent(level: number) {
  return LEVEL_INDENT[Math.min(level, 3)]
}

export default function PassiveNotes({
  data,
  pageSupplement,
  onTimestampClick,
  granularity,
}: PassiveNotesProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const handleBulletClick = (i: number, bullet: Bullet) => {
    if (!bullet.ai_comment) return
    setExpandedIdx(expandedIdx === i ? null : i)
  }

  return (
    <div className="space-y-1.5">
      {data.bullets.map((bullet, i) => {
        const isExpanded = expandedIdx === i
        const hasComment = !!bullet.ai_comment
        const hasTimestamp = bullet.timestamp_start >= 0

        return (
          <div key={i} className={getIndent(bullet.level)}>
            {/* PPT text row */}
            <div
              className={`flex items-start gap-2 rounded-md px-2 py-1 transition-colors ${
                hasComment ? 'cursor-pointer hover:bg-gray-100 active:bg-gray-150' : ''
              } ${isExpanded ? 'bg-gray-100' : ''}`}
              onClick={() => handleBulletClick(i, bullet)}
            >
              {/* Bullet indicator */}
              {bullet.level === 0 ? null : (
                <span className="flex-none mt-[5px] w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              )}

              <span className={`flex-1 leading-relaxed ${getBulletStyle(bullet.level)}`}>
                {bullet.ppt_text}
              </span>

              {/* Expand hint */}
              {hasComment && (
                <span className="flex-none text-[10px] text-indigo-400 mt-0.5 select-none">
                  {isExpanded ? '▲' : '▼'}
                </span>
              )}
            </div>

            {/* AI Clarification panel */}
            {isExpanded && bullet.ai_comment && (
              <div className="ml-4 mt-1 mb-2 border-l-2 border-indigo-200 pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold tracking-widest text-indigo-500 uppercase">
                    ★ AI Clarification
                  </span>
                  {hasTimestamp && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTimestampClick?.(bullet.timestamp_start)
                      }}
                      className="text-[10px] font-mono text-indigo-400 hover:text-indigo-600 transition-colors"
                    >
                      {formatTimestamp(bullet.timestamp_start)}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{bullet.ai_comment}</p>
              </div>
            )}
          </div>
        )
      })}

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
