import { useState, useEffect, useRef } from 'react'

/**
 * 打字机效果 hook。
 * - 调用 start() 开始播放，只播一次，播完后 done=true
 * - 调用 reset() 清空（用于收起）
 */
export function useTypewriter(text: string, speed = 18) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)
  const indexRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function start() {
    if (running || done) return
    setRunning(true)
    indexRef.current = 0
    setDisplayed('')
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setDisplayed('')
    setDone(false)
    setRunning(false)
    indexRef.current = 0
  }

  useEffect(() => {
    if (!running || done) return
    if (indexRef.current >= text.length) {
      setDone(true)
      setRunning(false)
      return
    }
    timerRef.current = setTimeout(() => {
      indexRef.current += 1
      setDisplayed(text.slice(0, indexRef.current))
    }, speed)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [running, displayed, text, speed, done])

  return { displayed, done, start, reset }
}
