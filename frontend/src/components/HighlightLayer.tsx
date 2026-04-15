import { useEffect, useRef } from 'react'
import { type HighlightRecord } from '../hooks/useHighlights'
import { getXPath, resolveXPath } from '../lib/xpath'

interface HighlightLayerProps {
  /** react-pdf Page 的外层容器 ref（TextLayer 在其内部） */
  pageContainerRef: React.RefObject<HTMLDivElement | null>
  /** 当前显示的页码（切换时触发重新应用） */
  pageNum: number
  /** 该页的高亮记录 */
  highlights: HighlightRecord[]
  /** 荧光笔工具是否激活 */
  highlightToolActive: boolean
  /** 橡皮擦工具是否激活 */
  eraserToolActive: boolean
  /** 当前选中颜色 */
  highlightColor: string
  onAdd: (record: Omit<HighlightRecord, 'id'>) => void
  onRemove: (id: string) => void
}

/** 把 <mark> 施加到 range，返回 mark 元素 */
function applyMarkToRange(range: Range, color: string, highlightId: string): HTMLElement | null {
  try {
    const mark = document.createElement('mark')
    mark.style.backgroundColor = color
    mark.style.color = 'inherit'
    mark.style.borderRadius = '2px'
    mark.dataset.highlightId = highlightId
    range.surroundContents(mark)
    return mark
  } catch {
    // surroundContents 在 range 跨越多个元素边界时会失败，忽略
    return null
  }
}

/** 从 TextLayer 容器里清除所有 <mark> */
function clearMarks(container: HTMLElement) {
  const marks = Array.from(container.querySelectorAll('mark[data-highlight-id]'))
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

export default function HighlightLayer({
  pageContainerRef,
  pageNum,
  highlights,
  highlightToolActive,
  eraserToolActive,
  highlightColor,
  onAdd,
  onRemove,
}: HighlightLayerProps) {
  const appliedPageRef = useRef<number>(-1)

  // 页面渲染后恢复高亮（等 TextLayer 出现）
  useEffect(() => {
    const container = pageContainerRef.current
    if (!container) return

    // TextLayer 可能是异步渲染的，poll 直到出现
    let attempts = 0
    const tryApply = () => {
      const textLayer = container.querySelector('.react-pdf__Page__textContent')
      if (!textLayer) {
        if (attempts++ < 20) setTimeout(tryApply, 100)
        return
      }
      clearMarks(textLayer as HTMLElement)
      highlights.forEach((rec) => {
        const startNode = resolveXPath(rec.startXPath, textLayer)
        const endNode = resolveXPath(rec.endXPath, textLayer)
        if (!startNode || !endNode) return
        try {
          const range = document.createRange()
          range.setStart(startNode, rec.startOffset)
          range.setEnd(endNode, rec.endOffset)
          applyMarkToRange(range, rec.color, rec.id)
        } catch {
          // range 无效，跳过
        }
      })
      appliedPageRef.current = pageNum
    }
    // 每次 pageNum 变化或 highlights 变化时重新施加
    tryApply()
  }, [pageNum, highlights, pageContainerRef])

  // 荧光笔工具激活时监听 mouseup
  useEffect(() => {
    if (!highlightToolActive) return
    const container = pageContainerRef.current
    if (!container) return

    const handleMouseUp = (e: MouseEvent) => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const textLayer = container.querySelector('.react-pdf__Page__textContent')
      if (!textLayer || !textLayer.contains(range.commonAncestorContainer)) return

      const startXPath = getXPath(range.startContainer, textLayer)
      const endXPath = getXPath(range.endContainer, textLayer)

      onAdd({
        sessionId: '', // 由调用方填入
        pageNum,
        color: highlightColor,
        startXPath,
        startOffset: range.startOffset,
        endXPath,
        endOffset: range.endOffset,
        text: range.toString(),
      })
      sel.removeAllRanges()
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [highlightToolActive, pageNum, highlightColor, onAdd, pageContainerRef])

  // 橡皮擦工具激活时，点击 <mark> 删除
  useEffect(() => {
    if (!eraserToolActive) return
    const container = pageContainerRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const mark = target.closest('mark[data-highlight-id]') as HTMLElement | null
      if (!mark) return
      const id = mark.dataset.highlightId
      if (id) onRemove(id)
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [eraserToolActive, onRemove, pageContainerRef])

  return null // 无自身渲染，纯逻辑组件
}
