import { useState, useRef, useEffect } from 'react'
import { type TextAnnotation } from '../hooks/useTextAnnotations'

interface TextAnnotationLayerProps {
  annotations: TextAnnotation[]
  textToolActive: boolean
  onPlaceAnnotation: (x: number, y: number) => void
  onUpdate: (id: string, text: string, color?: string, fontSize?: number) => void
  onRemove: (id: string) => void
  onFocusChange?: (hasFocus: boolean) => void
}

const FONT_SIZES = [10, 12, 14, 16, 18, 24, 32]
const COLORS = ['#1A1916', '#e53e3e', '#2b6cb0', '#276749', '#975a16', '#6b46c1', '#ffffff']

function FormatToolbar({
  color,
  fontSize,
  onColorChange,
  onFontSizeChange,
  onRemove,
}: {
  color: string
  fontSize: number
  onColorChange: (c: string) => void
  onFontSizeChange: (s: number) => void
  onRemove: () => void
}) {
  const [sizeOpen, setSizeOpen] = useState(false)
  const sizeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sizeOpen) return
    const handler = (e: MouseEvent) => {
      if (sizeRef.current && !sizeRef.current.contains(e.target as Node)) setSizeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sizeOpen])

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: '#FAFAF8',
        border: '1px solid rgba(175,179,176,0.5)',
        borderRadius: '6px',
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        whiteSpace: 'nowrap',
        zIndex: 50,
      }}
    >
      {/* 颜色选择 */}
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(100,100,100,0.6)" strokeWidth="2">
          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
        </svg>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onColorChange(c) }}
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: c,
              border: 'none',
              cursor: 'pointer',
              outline: color === c ? '2px solid #666' : '1px solid rgba(0,0,0,0.15)',
              outlineOffset: '1px',
              padding: 0,
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* 分隔 */}
      <span style={{ width: '1px', height: '16px', background: 'rgba(175,179,176,0.4)', margin: '0 2px' }} />

      {/* 字号选择 */}
      <div ref={sizeRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setSizeOpen((v) => !v) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(175,179,176,0.4)',
            borderRadius: '3px',
            padding: '2px 5px',
            fontSize: '12px',
            cursor: 'pointer',
            color: '#1A1916',
          }}
        >
          <span style={{ fontSize: '10px', color: '#6B6A64' }}>A</span>
          <span style={{ fontSize: '13px' }}>A</span>
          {fontSize}
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {sizeOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            background: '#FAFAF8',
            border: '1px solid rgba(175,179,176,0.4)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            zIndex: 60,
            overflow: 'hidden',
          }}>
            {FONT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onFontSizeChange(s); setSizeOpen(false) }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 14px',
                  textAlign: 'left',
                  background: fontSize === s ? 'rgba(0,0,0,0.06)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: '#1A1916',
                  whiteSpace: 'nowrap',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 分隔 */}
      <span style={{ width: '1px', height: '16px', background: 'rgba(175,179,176,0.4)', margin: '0 2px' }} />

      {/* 删除 */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onRemove() }}
        title="删除"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '22px',
          height: '22px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#9B9A94',
          borderRadius: '3px',
          padding: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
    </div>
  )
}

function AnnotationBox({
  annotation,
  onUpdate,
  onRemove,
  onFocusChange,
}: {
  annotation: TextAnnotation
  onUpdate: (id: string, text: string, color?: string, fontSize?: number) => void
  onRemove: (id: string) => void
  onFocusChange: (focused: boolean) => void
}) {
  const [editing, setEditing] = useState(annotation.text === '')
  const [focused, setFocused] = useState(annotation.text === '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) textareaRef.current.focus()
  }, [editing])

  // 初始新建时通知父组件有 focus
  useEffect(() => {
    if (annotation.text === '') onFocusChange(true)
    return () => onFocusChange(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setFocusedState = (val: boolean) => {
    setFocused(val)
    onFocusChange(val)
  }

  const color = annotation.color ?? '#1A1916'
  const fontSize = annotation.fontSize ?? 14

  return (
    <div
      style={{
        position: 'absolute',
        left: `${annotation.x}%`,
        top: `${annotation.y}%`,
        zIndex: 20,
        minWidth: '80px',
        maxWidth: '300px',
      }}
    >
      {/* 格式工具栏 */}
      {focused && (
        <FormatToolbar
          color={color}
          fontSize={fontSize}
          onColorChange={(c) => onUpdate(annotation.id, annotation.text, c, fontSize)}
          onFontSizeChange={(s) => {
            onUpdate(annotation.id, annotation.text, color, s)
            textareaRef.current?.focus()
          }}
          onRemove={() => onRemove(annotation.id)}
        />
      )}

      {/* 文字本体：无背景色，虚线边框仅在 focused 时显示 */}
      <div
        style={{
          position: 'relative',
          border: focused ? '1px dashed rgba(100,100,200,0.5)' : '1px solid transparent',
          borderRadius: '2px',
          padding: '1px 2px',
          minWidth: '80px',
        }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            defaultValue={annotation.text}
            placeholder="输入文字..."
            onFocus={() => setFocusedState(true)}
            onBlur={(e) => {
              const t = e.currentTarget.value.trim()
              if (!t) { onRemove(annotation.id); return }
              onUpdate(annotation.id, t, color, fontSize)
              setEditing(false)
              setFocusedState(false)
            }}
            style={{
              width: '100%',
              minWidth: '80px',
              minHeight: '1.5em',
              border: 'none',
              background: 'transparent',
              outline: 'none',
              resize: 'both',
              fontSize: `${fontSize}px`,
              fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
              color,
              lineHeight: 1.4,
              padding: 0,
              margin: 0,
            }}
          />
        ) : (
          <span
            onClick={() => { setEditing(true); setFocusedState(true) }}
            onFocus={() => setFocusedState(true)}
            onBlur={() => setFocusedState(false)}
            tabIndex={0}
            style={{
              cursor: 'text',
              display: 'block',
              whiteSpace: 'pre-wrap',
              fontSize: `${fontSize}px`,
              fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
              color,
              lineHeight: 1.4,
              userSelect: 'none',
            }}
          >
            {annotation.text}
          </span>
        )}
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
  // 追踪当前有多少个 box 处于 focused 状态（blur 前的快照）
  const focusCountRef = useRef(0)
  // 点击时 blur 已发生前，记录是否有 box 聚焦
  const hadFocusOnClickRef = useRef(false)

  const handleFocusChange = (focused: boolean) => {
    focusCountRef.current = Math.max(0, focusCountRef.current + (focused ? 1 : -1))
  }

  const handleMouseDown = () => {
    // mousedown 在 blur 之前触发，此时可以准确读到 focusCount
    hadFocusOnClickRef.current = focusCountRef.current > 0
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!textToolActive) return
    if ((e.target as HTMLElement).closest('[data-annotation-box]')) return
    // 如果 mousedown 时有 box 在 focused，点击空白只是失焦，不新建
    if (hadFocusOnClickRef.current) {
      hadFocusOnClickRef.current = false
      return
    }
    const rect = containerRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    onPlaceAnnotation(x, y)
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: textToolActive ? 'auto' : 'none',
        zIndex: 10,
        cursor: textToolActive ? 'text' : 'default',
      }}
    >
      {annotations.map((ann) => (
        <div key={ann.id} data-annotation-box>
          <AnnotationBox annotation={ann} onUpdate={onUpdate} onRemove={onRemove} onFocusChange={handleFocusChange} />
        </div>
      ))}
    </div>
  )
}
