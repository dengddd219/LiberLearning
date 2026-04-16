import { useState, useCallback } from 'react'

export interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
}

export interface HighlightRecord {
  id: string
  sessionId: string
  pageNum: number
  color: string
  rects: HighlightRect[]
  text: string
}

const STORAGE_KEY = 'liberstudy:highlights:v2'

function load(): HighlightRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function save(records: HighlightRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function useHighlights(sessionId: string) {
  const [highlights, setHighlights] = useState<HighlightRecord[]>(() =>
    load().filter((r) => r.sessionId === sessionId)
  )

  const addHighlight = useCallback((record: Omit<HighlightRecord, 'id'>) => {
    const id = crypto.randomUUID()
    const next = [...load(), { ...record, id }]
    save(next)
    setHighlights(next.filter((r) => r.sessionId === sessionId))
    return id
  }, [sessionId])

  const removeHighlight = useCallback((id: string) => {
    const next = load().filter((r) => r.id !== id)
    save(next)
    setHighlights(next.filter((r) => r.sessionId === sessionId))
  }, [sessionId])

  const highlightsForPage = useCallback((pageNum: number) =>
    highlights.filter((r) => r.pageNum === pageNum),
  [highlights])

  return { highlights, addHighlight, removeHighlight, highlightsForPage }
}
