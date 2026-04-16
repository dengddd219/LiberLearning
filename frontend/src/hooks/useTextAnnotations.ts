import { useState, useCallback } from 'react'

export interface TextAnnotation {
  id: string
  sessionId: string
  pageNum: number
  x: number   // 相对于页面容器的百分比 0-100
  y: number
  text: string
  color: string
  fontSize: number
}

const STORAGE_KEY = 'liberstudy:text-annotations'

function load(): TextAnnotation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
function save(records: TextAnnotation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function useTextAnnotations(sessionId: string) {
  const [annotations, setAnnotations] = useState<TextAnnotation[]>(() =>
    load().filter((a) => a.sessionId === sessionId)
  )

  const addAnnotation = useCallback((pageNum: number, x: number, y: number) => {
    const id = crypto.randomUUID()
    const record: TextAnnotation = { id, sessionId, pageNum, x, y, text: '', color: '#1A1916', fontSize: 14 }
    const next = [...load(), record]
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
    return id
  }, [sessionId])

  const updateAnnotation = useCallback((id: string, text: string, color?: string, fontSize?: number) => {
    const next = load().map((a) => a.id === id ? { ...a, text, ...(color !== undefined ? { color } : {}), ...(fontSize !== undefined ? { fontSize } : {}) } : a)
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
  }, [sessionId])

  const removeAnnotation = useCallback((id: string) => {
    const next = load().filter((a) => a.id !== id)
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
  }, [sessionId])

  const annotationsForPage = useCallback((pageNum: number) =>
    annotations.filter((a) => a.pageNum === pageNum),
  [annotations])

  return { annotations, addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage }
}
