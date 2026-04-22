import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

interface LineByLineRevealProps {
  text: string
  startReveal: boolean
  onDone: () => void
}

interface LineRevealSpanProps {
  text: string
  revealed: boolean
}

function LineRevealSpan({ text, revealed }: LineRevealSpanProps) {
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
      el.style.color = '#72726E'
      settledRef.current = true
    }, 300)

    return () => clearTimeout(timer)
  }, [revealed])

  return (
    <span ref={ref} style={{ color: 'transparent', display: 'inline' }}>
      {text}
    </span>
  )
}

export default function LineByLineReveal({ text, startReveal, onDone }: LineByLineRevealProps) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [lines, setLines] = useState<string[]>([])
  const [revealedLines, setRevealedLines] = useState<Set<number>>(new Set())

  useEffect(() => {
    const el = measureRef.current
    if (!el || !text) return

    const range = document.createRange()
    const textNode = el.firstChild
    if (!textNode) return

    const measured: string[] = []
    let lineStart = 0
    let prevTop: number | null = null

    for (let i = 0; i <= text.length; i++) {
      range.setStart(textNode, i === text.length ? i - 1 : i)
      range.setEnd(textNode, i === text.length ? i : i + 1)
      const rect = range.getBoundingClientRect()
      const top = Math.round(rect.top)

      if (prevTop !== null && top !== prevTop) {
        measured.push(text.slice(lineStart, i))
        lineStart = i
      }
      prevTop = top
    }

    if (lineStart < text.length) {
      measured.push(text.slice(lineStart))
    }

    setLines(measured.length > 0 ? measured : [text])
  }, [text])

  useEffect(() => {
    if (!startReveal || lines.length === 0) return
    setRevealedLines(new Set())

    const interval = 120
    const timers: number[] = []
    lines.forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setRevealedLines((prev) => new Set(prev).add(index))
        if (index === lines.length - 1) {
          window.setTimeout(onDone, 500)
        }
      }, index * interval)
      timers.push(timer)
    })

    return () => timers.forEach(clearTimeout)
  }, [startReveal, lines, onDone])

  const baseStyle: CSSProperties = {
    fontSize: '14px',
    lineHeight: '1.625',
    fontWeight: '400',
    margin: 0,
    userSelect: 'text',
  }

  return (
    <>
      <p style={{ ...baseStyle, position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: '100%' }}>
        <span ref={measureRef}>{text}</span>
      </p>
      <p style={baseStyle}>
        {lines.length === 0
          ? <span style={{ color: 'transparent' }}>{text}</span>
          : lines.map((line, index) => (
              <LineRevealSpan key={index} text={line} revealed={revealedLines.has(index)} />
            ))}
      </p>
    </>
  )
}
