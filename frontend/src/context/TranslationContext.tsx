import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { translateWithMyMemory } from '../lib/translation'
import { i18n, type UiLang, type I18nKey } from '../lib/i18n'

export type TargetLang = 'zh-CN' | 'zh-TW'

interface TranslationContextValue {
  // Content translation (ASR / notes)
  enabled: boolean
  targetLang: TargetLang
  setTargetLang: (lang: TargetLang) => void
  setEnabled: (v: boolean) => void
  translate: (text: string) => Promise<string>
  // UI language
  uiLang: UiLang
  setUiLang: (lang: UiLang) => void
  t: (key: I18nKey) => string
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

function readStoredLang(): UiLang {
  try {
    const stored = localStorage.getItem('ui-lang')
    if (stored === 'en' || stored === 'zh') return stored
  } catch { /* ignore */ }
  return 'en'
}

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-CN')
  const [uiLang, setUiLangState] = useState<UiLang>(readStoredLang)
  const cacheRef = useRef<Map<string, string>>(new Map())

  const setUiLang = useCallback((lang: UiLang) => {
    setUiLangState(lang)
    try { localStorage.setItem('ui-lang', lang) } catch { /* ignore */ }
  }, [])

  const t = useCallback(
    (key: I18nKey): string => i18n[uiLang][key],
    [uiLang],
  )

  const translate = useCallback(
    async (text: string): Promise<string> => {
      const key = `${targetLang}:${text}`
      if (cacheRef.current.has(key)) return cacheRef.current.get(key)!
      const result = await translateWithMyMemory(text, `en|${targetLang}`)
      cacheRef.current.set(key, result)
      return result
    },
    [targetLang],
  )

  return (
    <TranslationContext.Provider value={{ enabled, setEnabled, targetLang, setTargetLang, translate, uiLang, setUiLang, t }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(TranslationContext)
  if (!ctx) throw new Error('useTranslation must be used inside TranslationProvider')
  return ctx
}
