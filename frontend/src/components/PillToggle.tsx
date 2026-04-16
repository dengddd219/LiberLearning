import { useTranslation } from '../context/TranslationContext'

interface PillToggleProps {
  value: 'my' | 'ai'
  onChange: (v: 'my' | 'ai') => void
}

export default function PillToggle({ value, onChange }: PillToggleProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => onChange('my')}
        title={t('pill_my_notes')}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'my'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t('pill_my_notes')}
      </button>
      <button
        onClick={() => onChange('ai')}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'ai'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t('pill_ai_notes')}
      </button>
    </div>
  )
}
