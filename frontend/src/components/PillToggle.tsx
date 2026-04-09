interface PillToggleProps {
  value: 'my' | 'ai'
  onChange: (v: 'my' | 'ai') => void
}

export default function PillToggle({ value, onChange }: PillToggleProps) {
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => onChange('my')}
        title="My note"
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'my'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        我的笔记
      </button>
      <button
        onClick={() => onChange('ai')}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'ai'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        AI 笔记
      </button>
    </div>
  )
}
