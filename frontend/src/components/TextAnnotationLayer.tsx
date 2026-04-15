import { useState, useRef } from 'react'
import { type TextAnnotation } from '../hooks/useTextAnnotations'

interface TextAnnotationLayerProps {
  annotations: TextAnnotation[]
  textToolActive: boolean
  /** 点击空白区域时的坐标回调（百分比） */
  onPlaceAnnotation: (x: number, y: number) => void
  onUpdate: (id: string, text: string) => void
  onRemove: (id: string) => void
}

function AnnotationBox({
  annotation,
  onUpdate,
  onRemove,
}: {
  annotation: TextAnnotation
  onUpdate: (id: string, text: string) => void
  onRemove: (id: string) => void
}) {
  const [editing, setEditing] = useState(annotation.text === '')
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${annotation.x}%`,
        top: `${annotation.y}%`,
        zIndex: 20,
        minWidth: '120px',
        maxWidth: '280px',
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,180,0.95)',
          border: '1px solid rgba(200,180,0,0.4)',
          borderRadius: '4px',
          padding: '4px 6px',
          fontSize: '13px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          position: 'relative',
        }}
      >
        {editing ? (
          <textarea
            autoFocus
            defaultValue={annotation.text}
            placeholder="输入文字..."
            onBlur={(e) => {
              const t = e.currentTarget.value.trim()
              if (!t) { onRemove(annotation.id); return }
              onUpdate(annotation.id, t)
              setEditing(false)
            }}
            style={{
              width: '100%',
              minHeight: '48px',
              border: 'none',
              background: 'transparent',
              outline: 'none',
              resize: 'none',
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{ cursor: 'text', display: 'block', whiteSpace: 'pre-wrap' }}
          >
            {annotation.text}
          </span>
        )}
        <button
          onClick={() => onRemove(annotation.id)}
          style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: '#666',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: '10px',
            lineHeight: '16px',
            textAlign: 'center',
            padding: 0,
          }}
          aria-label="删除标注"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export default function TextAnnotationLayer({
  annotations,
  textToolActive,
  onPlaceAnnotation,
  onUpdate,
  onRemove,
}: TextAnnotationLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!textToolActive) return
    // 不响应来自 AnnotationBox 内部的点击
    if ((e.target as HTMLElement).closest('[data-annotation-box]')) return
    const rect = containerRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    onPlaceAnnotation(x, y)
  }

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: textToolActive ? 'auto' : 'none',
        zIndex: 10,
        cursor: textToolActive ? 'crosshair' : 'default',
      }}
    >
      {annotations.map((ann) => (
        <div key={ann.id} data-annotation-box>
          <AnnotationBox annotation={ann} onUpdate={onUpdate} onRemove={onRemove} />
        </div>
      ))}
    </div>
  )
}
