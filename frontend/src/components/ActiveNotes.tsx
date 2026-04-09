interface ActiveNotesData {
  user_note: string
  ai_expansion: string
}

interface ActiveNotesProps {
  data: ActiveNotesData
  granularity: 'simple' | 'detailed'
}

export default function ActiveNotes({ data, granularity }: ActiveNotesProps) {
  return (
    <div className="space-y-3">
      {/* User note */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-600 font-medium mb-1">我的笔记</p>
        <p className="text-sm text-black leading-relaxed">{data.user_note}</p>
      </div>

      {/* AI expansion */}
      {granularity === 'detailed' && (
        <div>
          <p className="text-xs text-gray-400 font-medium mb-1.5">AI 扩写</p>
          <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-line">
            {data.ai_expansion}
          </p>
        </div>
      )}
    </div>
  )
}
