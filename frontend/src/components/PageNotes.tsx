import { useState } from 'react'

interface Annotation {
  id: string
  pageNum: number
  text: string
  yPosition: number
  timestamp: number
}

interface PageNotesProps {
  currentPage: number
  annotations: Annotation[]
  onAnnotationAdd: (ann: Annotation) => void
  onAnnotationDelete?: (id: string) => void
}

export default function PageNotes({
  currentPage,
  annotations,
  onAnnotationAdd,
  onAnnotationDelete,
}: PageNotesProps) {
  const [inputText, setInputText] = useState('')

  const pageAnns = annotations.filter((a) => a.pageNum === currentPage)

  const handleAdd = () => {
    if (!inputText.trim()) return
    onAnnotationAdd({
      id: `ann-${Date.now()}`,
      pageNum: currentPage,
      text: inputText.trim(),
      yPosition: 50,
      timestamp: Date.now(),
    })
    setInputText('')
  }

  return (
    <div className="flex-1 flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          第 {currentPage} 页 · 我的笔记
        </h3>
        <span className="text-xs text-gray-400">{pageAnns.length} 条</span>
      </div>

      {/* Notes list */}
      <ul className="flex-1 space-y-2 mb-4 overflow-y-auto">
        {pageAnns.length === 0 && (
          <li className="text-xs text-gray-400 text-center py-6">
            点击 PPT 画面添加就地批注，或在下方输入笔记
          </li>
        )}
        {pageAnns.map((ann) => (
          <li
            key={ann.id}
            className="group relative bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-gray-800"
          >
            {ann.text}
            {onAnnotationDelete && (
              <button
                onClick={() => onAnnotationDelete(ann.id)}
                className="absolute top-1 right-1 hidden group-hover:block text-gray-400 hover:text-red-400 text-xs px-1"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Quick input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="快速添加笔记…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 text-sm transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}
