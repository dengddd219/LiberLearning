import { useState, useRef, useEffect } from 'react'

interface InlineAnnotationProps {
  yPosition: number
  onConfirm: (text: string) => void
  onCancel: () => void
}

export default function InlineAnnotation({ yPosition, onConfirm, onCancel }: InlineAnnotationProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onConfirm(text)
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div
      className="absolute left-4 right-4 z-20 animate-in fade-in slide-in-from-top-1 duration-150"
      style={{ top: yPosition, transform: 'translateY(-50%)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white border border-indigo-400 rounded-lg shadow-lg p-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入批注… (Enter 确认，Esc 取消)"
          rows={2}
          className="w-full text-sm resize-none outline-none text-gray-800 placeholder-gray-400"
        />
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-0.5"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(text)}
            className="text-xs bg-indigo-500 text-white px-3 py-0.5 rounded hover:bg-indigo-600"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
