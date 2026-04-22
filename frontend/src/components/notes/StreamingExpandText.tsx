import { useEffect, useRef } from 'react'
import { renderMd } from '../../lib/notesUtils'

interface StreamingExpandTextProps {
  text: string
}

export default function StreamingExpandText({ text }: StreamingExpandTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (settledRef.current || !text) return

    const el = ref.current
    if (!el) return

    settledRef.current = true
    el.classList.add('drop-in', 'shimmer-text')

    const timer = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
    }, 600)

    return () => clearTimeout(timer)
  }, [text])

  return (
    <span
      ref={ref}
      style={{ fontSize: '13px', color: 'transparent', lineHeight: '1.7', display: 'block' }}
    >
      {renderMd(text)}
    </span>
  )
}
