import { useState } from 'react'
import { useTranslation } from '../context/TranslationContext'

export type Template = 'outline' | 'qa' | 'cornell' | 'mindmap'
export type Granularity = 'simple' | 'detailed'

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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const TEMPLATES: { id: Template; label: string; desc: string }[] = [
    { id: 'outline', label: t('template_outline_label'), desc: t('template_outline_desc') },
    { id: 'qa',      label: t('template_qa_label'),      desc: t('template_qa_desc') },
    { id: 'cornell', label: t('template_cornell_label'), desc: t('template_cornell_desc') },
    { id: 'mindmap', label: t('template_mindmap_label'), desc: t('template_mindmap_desc') },
  ]

  const current = TEMPLATES.find((tmpl) => tmpl.id === template)!

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
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => { onTemplateChange(tmpl.id); setOpen(false) }}
                className={`w-full flex flex-col text-left px-4 py-2.5 hover:bg-indigo-50 first:rounded-t-xl last:rounded-b-xl ${
                  template === tmpl.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                }`}
              >
                <span className="text-sm font-medium">{tmpl.label}</span>
                <span className="text-xs text-gray-400">{tmpl.desc}</span>
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
          {t('template_simple')}
        </button>
        <button
          onClick={() => onGranularityChange('detailed')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            granularity === 'detailed' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
          }`}
        >
          {t('template_detailed')}
        </button>
      </div>
    </div>
  )
}
