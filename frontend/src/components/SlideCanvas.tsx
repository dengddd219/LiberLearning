import { useEffect, useRef, useState, useCallback } from 'react'
import InlineAnnotation from './InlineAnnotation'

interface Annotation {
  id: string
  pageNum: number
  text: string
  yPosition: number
  timestamp: number
}

interface SlideInfo {
  pageNum: number
  slideImageUrl: string
}

interface SlideCanvasProps {
  slides: SlideInfo[]
  annotations: Annotation[]
  sessionId: string
  onCurrentPageChange: (pageNum: number) => void
  onAnnotationAdd: (annotation: Annotation) => void
  onPageClick?: (pageNum: number) => void
  scrollToPage?: number | null
}

export default function SlideCanvas({
  slides,
  annotations,
  onCurrentPageChange,
  onAnnotationAdd,
  scrollToPage,
}: SlideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    pageNum: number
    yPosition: number
    clickY: number
  } | null>(null)

  // Intersection Observer — track which page is most visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0
        let mostVisible = 1
        entries.forEach((entry) => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const pageNum = Number(entry.target.getAttribute('data-page'))
            if (!isNaN(pageNum)) mostVisible = pageNum
          }
        })
        if (maxRatio > 0) onCurrentPageChange(mostVisible)
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i * 0.05) }
    )

    pageRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [slides, onCurrentPageChange])

  // Scroll to page when nav clicked
  useEffect(() => {
    if (scrollToPage == null) return
    const el = pageRefs.current.get(scrollToPage)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollToPage])

  const handleSlideClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageNum: number) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const relY = ((e.clientY - rect.top) / rect.height) * 100
      setPendingAnnotation({ pageNum, yPosition: relY, clickY: e.clientY - rect.top })
    },
    []
  )

  const handleAnnotationConfirm = useCallback(
    (text: string) => {
      if (!pendingAnnotation || !text.trim()) {
        setPendingAnnotation(null)
        return
      }
      onAnnotationAdd({
        id: `ann-${Date.now()}`,
        pageNum: pendingAnnotation.pageNum,
        text,
        yPosition: pendingAnnotation.yPosition,
        timestamp: Date.now(),
      })
      setPendingAnnotation(null)
    },
    [pendingAnnotation, onAnnotationAdd]
  )

  return (
    <div ref={containerRef} className="p-6 space-y-8">
      {slides.map((slide) => {
        const pageAnnotations = annotations.filter((a) => a.pageNum === slide.pageNum)
        return (
          <div
            key={slide.pageNum}
            data-page={slide.pageNum}
            ref={(el) => {
              if (el) pageRefs.current.set(slide.pageNum, el)
              else pageRefs.current.delete(slide.pageNum)
            }}
            className="relative rounded-xl shadow-md overflow-hidden border border-gray-200 cursor-crosshair"
            onClick={(e) => handleSlideClick(e, slide.pageNum)}
          >
            {/* Slide image */}
            <img
              src={slide.slideImageUrl}
              alt={`第${slide.pageNum}页`}
              className="w-full block"
              draggable={false}
            />

            {/* Page number badge */}
            <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded">
              {slide.pageNum}
            </div>

            {/* Existing annotations */}
            {pageAnnotations.map((ann) => (
              <div
                key={ann.id}
                className="absolute left-4 right-4 bg-amber-50 border border-amber-300 rounded px-2 py-1 text-xs text-amber-900 shadow"
                style={{ top: `${ann.yPosition}%`, transform: 'translateY(-50%)' }}
                onClick={(e) => e.stopPropagation()}
              >
                📝 {ann.text}
              </div>
            ))}

            {/* Pending annotation input */}
            {pendingAnnotation?.pageNum === slide.pageNum && (
              <InlineAnnotation
                yPosition={pendingAnnotation.clickY}
                onConfirm={handleAnnotationConfirm}
                onCancel={() => setPendingAnnotation(null)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
