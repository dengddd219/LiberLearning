import { useEffect, useRef } from 'react'
import { type HighlightRecord } from '../hooks/useHighlights'

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

/** 把 DOMRect 转换为相对于容器的坐标 */
function toRelativeRect(
  rect: DOMRect,
  container: HTMLElement,
): { x: number; y: number; w: number; h: number } {
  const containerRect = container.getBoundingClientRect()
  return {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    w: rect.width,
    h: rect.height,
  }
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
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 荧光笔工具激活时监听 mouseup
  useEffect(() => {
    if (!highlightToolActive) return
    const pageContainer = pageContainerRef.current
    if (!pageContainer) return

    const handleMouseUp = (_e: MouseEvent) => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)

      // 确保选区在 TextLayer 内
      const textLayer = pageContainer.querySelector('.react-pdf__Page__textContent')
      if (!textLayer || !textLayer.contains(range.commonAncestorContainer)) return

      const clientRects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 0 && r.height > 0,
      )
      if (clientRects.length === 0) return

      const rects = clientRects.map((r) => toRelativeRect(r, pageContainer))

      onAdd({
        sessionId: '',
        pageNum,
        color: highlightColor,
        rects,
        text: range.toString(),
      })

      sel.removeAllRanges()
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [highlightToolActive, pageNum, highlightColor, onAdd, pageContainerRef])

  // 橡皮擦工具激活时，点击高亮矩形删除
  const handleEraserClick = (id: string) => {
    if (eraserToolActive) onRemove(id)
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: eraserToolActive ? 'auto' : 'none',
        zIndex: 10,
        cursor: eraserToolActive
          ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='4' y='12' width='12' height='8' rx='1' fill='%23f8f0e3' stroke='%23888' stroke-width='1.5'/%3E%3Cpath d='M4 16h12' stroke='%23888' stroke-width='1'/%3E%3Cpath d='M8 20H18a2 2 0 0 0 1.4-3.4L12 9l-8 8 1.6 1.6' fill='%23f8f0e3' stroke='%23888' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E\") 4 20, cell"
          : 'default',
      }}
    >
      {highlights.map((rec) =>
        rec.rects.map((rect, i) => (
          <div
            key={`${rec.id}-${i}`}
            onClick={() => handleEraserClick(rec.id)}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              backgroundColor: rec.color,
              opacity: 0.4,
              borderRadius: '2px',
              cursor: 'inherit',
              mixBlendMode: 'multiply',
            }}
          />
        )),
      )}
    </div>
  )
}
