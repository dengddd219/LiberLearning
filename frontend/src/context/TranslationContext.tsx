import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { translateWithMyMemory } from '../lib/translation'

export type TargetLang = 'zh-CN' | 'zh-TW'

interface TranslationContextValue {
  enabled: boolean
  targetLang: TargetLang
  setTargetLang: (lang: TargetLang) => void
  setEnabled: (v: boolean) => void
  translate: (text: string) => Promise<string>
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-CN')
  // cache key: `${targetLang}:${originalText}` → translatedText
  const cacheRef = useRef<Map<string, string>>(new Map())

  const translate = useCallback(
    async (text: string): Promise<string> => {
      const key = `${targetLang}:${text}`
      if (cacheRef.current.has(key)) {
        return cacheRef.current.get(key)!
      }
      const result = await translateWithMyMemory(text, `en|${targetLang}`)
      cacheRef.current.set(key, result)
      return result
    },
    [targetLang],
  )

  return (
    <TranslationContext.Provider value={{ enabled, setEnabled, targetLang, setTargetLang, translate }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(TranslationContext)
  if (!ctx) throw new Error('useTranslation must be used inside TranslationProvider')
  return ctx
}
