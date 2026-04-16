import { useState, useCallback, useRef } from 'react'

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
  // 记住本次会话中用户最后一次设置的颜色和字号，新建标注时复用
  const lastFormatRef = useRef<{ color: string; fontSize: number }>({ color: '#1A1916', fontSize: 14 })

  const addAnnotation = useCallback((pageNum: number, x: number, y: number) => {
    const id = crypto.randomUUID()
    const { color, fontSize } = lastFormatRef.current
    const record: TextAnnotation = { id, sessionId, pageNum, x, y, text: '', color, fontSize }
    const next = [...load(), record]
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
    return id
  }, [sessionId])

  const updateAnnotation = useCallback((id: string, text: string, color?: string, fontSize?: number) => {
    // 用户改了颜色或字号时，记住最新配置供下次新建使用
    if (color !== undefined) lastFormatRef.current.color = color
    if (fontSize !== undefined) lastFormatRef.current.fontSize = fontSize
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
