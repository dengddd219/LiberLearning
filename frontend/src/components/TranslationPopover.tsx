import { useEffect, useRef, useState } from 'react'
import { type TargetLang } from '../context/TranslationContext'

interface TranslationPopoverProps {
  onClose: () => void          // 仅关闭弹窗，不改变翻译状态
  onTranslate: () => void      // 点击「翻译」按钮
  onShowOriginal: () => void   // 点击「显示原文」
  targetLang: TargetLang
  onTargetLangChange: (lang: TargetLang) => void
  enabled: boolean             // 翻译是否已开启（控制「更多」菜单内容）
}

export default function TranslationPopover({
  onClose,
  onTranslate,
  onShowOriginal,
  targetLang,
  onTargetLangChange,
}: TranslationPopoverProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击弹窗外部关闭
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: '280px',
        background: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
        padding: '16px',
        zIndex: 50,
        fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span style={{ fontSize: '15px', fontWeight: 500, color: '#1A1916' }}>
          翻译 英语 页面？
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            color: '#9B9A94',
            padding: '0 2px',
            lineHeight: 1,
          }}
          aria-label="关闭翻译弹窗"
        >
          ✕
        </button>
      </div>

      {/* 翻译为 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#6B6A64', marginBottom: '6px' }}>翻译为</div>
        <select
          value={targetLang}
          onChange={(e) => onTargetLangChange(e.target.value as TargetLang)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #E4E3DE',
            fontSize: '14px',
            color: '#1A1916',
            background: '#FAFAF8',
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6A64' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            paddingRight: '32px',
          }}
        >
          <option value="zh-CN">中文（简体）</option>
          <option value="zh-TW">中文（繁体）</option>
        </select>
      </div>

      {/* 底部按钮行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', position: 'relative' }}>
        {/* 更多 ▾ */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#6B6A64',
              padding: '6px 8px',
              borderRadius: '6px',
            }}
          >
            更多 ▾
          </button>
          {moreOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                right: 0,
                background: '#FFFFFF',
                borderRadius: '8px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
                padding: '4px',
                minWidth: '120px',
                zIndex: 51,
              }}
            >
              <button
                onClick={() => {
                  setMoreOpen(false)
                  onShowOriginal()
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: '#1A1916',
                  padding: '8px 12px',
                  borderRadius: '6px',
                }}
                className="hover:bg-black/5"
              >
                显示原文
              </button>
            </div>
          )}
        </div>

        {/* 翻译按钮 */}
        <button
          onClick={onTranslate}
          style={{
            background: '#1A1916',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            padding: '6px 16px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          翻译
        </button>
      </div>
    </div>
  )
}
