import { useState } from 'react'

export type Template = 'outline' | 'qa' | 'cornell' | 'mindmap'
export type Granularity = 'simple' | 'detailed'

const TEMPLATES: { id: Template; label: string; desc: string }[] = [
  { id: 'outline', label: '📋 大纲式', desc: '按要点层级整理' },
  { id: 'qa', label: '❓ 问答式', desc: '提炼考点问答' },
  { id: 'cornell', label: '📝 康奈尔式', desc: '要点+提示+总结' },
  { id: 'mindmap', label: '🗺️ 思维导图', desc: '树形结构输出' },
]

interface TemplateSelectorProps {
  template: Template
  granularity: Granularity
  onTemplateChange: (t: Template) => void
  onGranularityChange: (g: Granularity) => void
}

export default function TemplateSelector({
  template,
  granularity,
  onTemplateChange,
  onGranularityChange,
}: TemplateSelectorProps) {
  const [open, setOpen] = useState(false)
  const current = TEMPLATES.find((t) => t.id === template)!

  return (
    <div className="flex items-center gap-2">
      {/* Template dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
        >
          {current.label}
          <span className="text-gray-400">›</span>
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-20 w-48">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => { onTemplateChange(t.id); setOpen(false) }}
                className={`w-full flex flex-col text-left px-4 py-2.5 hover:bg-indigo-50 first:rounded-t-xl last:rounded-b-xl ${
                  template === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                }`}
              >
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs text-gray-400">{t.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Granularity toggle */}
      <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
        <button
          onClick={() => onGranularityChange('simple')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            granularity === 'simple' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
          }`}
        >
          简洁
        </button>
        <button
          onClick={() => onGranularityChange('detailed')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            granularity === 'detailed' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
          }`}
        >
          详细
        </button>
      </div>
    </div>
  )
}
