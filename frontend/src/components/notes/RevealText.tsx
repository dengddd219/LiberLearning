import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface RevealTextProps {
  children: ReactNode
  revealed: boolean
  muted: boolean
  highlight: boolean
}

export default function RevealText({ children, revealed, muted, highlight }: RevealTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (!revealed || settledRef.current) return
    const el = ref.current
    if (!el) return

    el.classList.add('drop-in', 'shimmer-text')

    const timer = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
      el.style.color = highlight ? '#92400e' : muted ? '#D0CFC5' : '#292929'
      settledRef.current = true
    }, 500)

    return () => clearTimeout(timer)
  }, [revealed, muted, highlight])

  return (
    <span ref={ref} style={{ color: 'transparent', display: 'inline' }}>
      {children}
    </span>
  )
}
