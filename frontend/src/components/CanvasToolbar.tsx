import { useState, useEffect, useRef } from 'react'
import TranslationPopover from './TranslationPopover'
import { type TargetLang } from '../context/TranslationContext'

const C = {
  fg: '#1A1916',
  secondary: '#6B6A64',
  muted: '#9B9A94',
  white: '#FAFAF8',
}

function Divider() {
  return (
    <span
      style={{
        width: '1px',
        height: '20px',
        background: 'rgba(175,179,176,0.4)',
        margin: '0 6px',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  )
}

function ToolBtn({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
  size = 32,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  size?: number
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: '4px',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? 'rgba(0,0,0,0.06)' : 'transparent',
        color: active ? C.fg : C.secondary,
        opacity: disabled ? 0.3 : 1,
        transition: 'background 150ms, color 150ms',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

export interface CanvasToolbarProps {
  navVisible: boolean
  onNavToggle: () => void
  activeTool: 'none' | 'highlight' | 'eraser' | 'text'
  onToolChange: (tool: 'none' | 'highlight' | 'eraser' | 'text') => void
  highlightColor: string
  onHighlightColorChange: (color: string) => void
  translationEnabled: boolean
  popoverOpen: boolean
  onPopoverToggle: () => void
  targetLang: TargetLang
  onTargetLangChange: (lang: TargetLang) => void
  onTranslate: () => void
  onShowOriginal: () => void
  onClosePopover: () => void
  zoomLevel: number
  onZoomChange: (z: number) => void
  currentPage: number
  totalPages: number
  pageInputValue: string
  onPageInputChange: (val: string) => void
  onPageInputCommit: () => void
  onPrevPage: () => void
  onNextPage: () => void
  searchOpen: boolean
  onSearchToggle: () => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
}

export default function CanvasToolbar({
  navVisible,
  onNavToggle,
  activeTool,
  onToolChange,
  highlightColor,
  onHighlightColorChange,
  translationEnabled,
  popoverOpen,
  onPopoverToggle,
  targetLang,
  onTargetLangChange,
  onTranslate,
  onShowOriginal,
  onClosePopover,
  zoomLevel,
  onZoomChange,
  currentPage,
  totalPages,
  pageInputValue,
  onPageInputChange,
  onPageInputCommit,
  onPrevPage,
  onNextPage,
  searchOpen,
  onSearchToggle,
  searchQuery,
  onSearchQueryChange,
}: CanvasToolbarProps) {
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false)
  const colorDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!colorDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(e.target as Node)) {
        setColorDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorDropdownOpen])

  useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus()
  }, [searchOpen])

  return (
    <div
      className="flex items-center flex-shrink-0 px-2"
      style={{
        height: '48px',
        background: C.white,
        borderBottom: '1px solid rgba(175,179,176,0.15)',
        boxShadow: '0px 1px 2px rgba(0,0,0,0.05)',
      }}
    >
      {/* 1. 目录 */}
      <ToolBtn title="目录" active={navVisible} onClick={onNavToggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </ToolBtn>

      <Divider />

      {/* 2. 荧光笔 + 颜色 */}
      <div ref={colorDropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <ToolBtn
          title="荧光笔"
          active={activeTool === 'highlight'}
          onClick={() => onToolChange(activeTool === 'highlight' ? 'none' : 'highlight')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </ToolBtn>
        <button
          type="button"
          title="选择颜色"
          onClick={() => setColorDropdownOpen((v) => !v)}
          style={{
            width: '10px', height: '10px',
            background: highlightColor,
            marginLeft: '1px',
            padding: 0,
            border: 'none',
            outline: '1px solid rgba(0,0,0,0.15)',
            borderRadius: '2px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        {colorDropdownOpen && (
          <div style={{
            position: 'absolute', top: '36px', left: 0, zIndex: 50,
            background: C.white,
            border: '1px solid rgba(175,179,176,0.3)',
            borderRadius: '8px',
            padding: '10px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['#FAFF00', '#B2F0A0', '#A8E6FF', '#FFB7D5', '#FF8080'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => { onHighlightColorChange(color); setColorDropdownOpen(false) }}
                  style={{
                    width: '22px', height: '22px',
                    background: color,
                    border: 'none',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    outline: highlightColor === color ? '2px solid rgba(0,0,0,0.5)' : '2px solid transparent',
                    outlineOffset: '1px',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <Divider />

      {/* 3. 橡皮擦 */}
      <ToolBtn title="橡皮擦" active={activeTool === 'eraser'} onClick={() => onToolChange(activeTool === 'eraser' ? 'none' : 'eraser')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 20H7L3 16l10-10 7 7-4.5 4.5" />
          <path d="M6.0001 10.5001L13.5001 18.0001" />
        </svg>
      </ToolBtn>

      <Divider />

      {/* 4. 文本 */}
      <ToolBtn title="添加文本" active={activeTool === 'text'} onClick={() => onToolChange(activeTool === 'text' ? 'none' : 'text')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      </ToolBtn>

      <Divider />

      {/* 5. 翻译 */}
      <div style={{ position: 'relative' }}>
        <ToolBtn title="翻译" active={translationEnabled} onClick={onPopoverToggle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </ToolBtn>
        {popoverOpen && (
          <TranslationPopover
            enabled={translationEnabled}
            targetLang={targetLang}
            onTargetLangChange={onTargetLangChange}
            onClose={onClosePopover}
            onTranslate={onTranslate}
            onShowOriginal={onShowOriginal}
          />
        )}
      </div>

      <Divider />

      {/* 6. 缩放 - + 适应宽度 */}
      <ToolBtn title="缩小" size={28} onClick={() => onZoomChange(Math.max(25, zoomLevel - 10))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </ToolBtn>
      <ToolBtn title="放大" size={28} onClick={() => onZoomChange(Math.min(300, zoomLevel + 10))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </ToolBtn>
      <ToolBtn title="适应宽度" size={28} onClick={() => onZoomChange(100)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </ToolBtn>

      <Divider />

      {/* 7. 页码导航 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <ToolBtn title="上一页" size={28} disabled={currentPage <= 1} onClick={onPrevPage}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </ToolBtn>
        <input
          type="text"
          value={pageInputValue}
          onChange={(e) => onPageInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPageInputCommit() }}
          onBlur={onPageInputCommit}
          style={{
            width: '32px', height: '24px',
            textAlign: 'center',
            fontSize: '12px',
            color: C.fg,
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(175,179,176,0.4)',
            borderRadius: '4px',
            outline: 'none',
            padding: 0,
          }}
        />
        <span style={{ fontSize: '12px', color: C.muted, margin: '0 3px' }}>/ {totalPages}</span>
        <ToolBtn title="下一页" size={28} disabled={currentPage >= totalPages} onClick={onNextPage}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </ToolBtn>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <Divider />

      {/* 8. 搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {searchOpen && (
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onSearchToggle() }}
            placeholder="搜索..."
            style={{
              width: '140px', height: '26px',
              fontSize: '12px',
              color: C.fg,
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid rgba(175,179,176,0.4)',
              borderRadius: '4px',
              padding: '0 8px',
              outline: 'none',
            }}
          />
        )}
        <ToolBtn title="搜索" active={searchOpen} onClick={onSearchToggle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </ToolBtn>
      </div>
    </div>
  )
}
