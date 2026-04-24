// frontend/src/components/TopBar.tsx
import { useNavigate, useLocation } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import { useAuth } from '../context/AuthContext'
import { useRef, useEffect, useState } from 'react'

const C = {
  bg: 'rgba(240,239,234,0.95)',
  fg: '#2F3331',
  muted: '#556071',
  white: '#FFFFFF',
  border: 'rgba(175,179,176,0.25)',
}

const BAR_H = 40
const TAB_H = 34
const CORNER_R = 8

/**
 * Chrome 风格标签。激活时白色底，底部"打通"底边线，两侧反向圆角。
 * 非激活：透明底，圆角 pill，hover 时略带底色。
 * 激活标签双击进入内联编辑；autoEdit=true 时进入时自动编辑一次。
 */
function ChromeTab({
  label,
  favicon,
  isActive,
  autoEdit,
  onClick,
  onClose,
  onRename,
  closeLabel,
}: {
  label: string
  favicon?: string
  isActive: boolean
  autoEdit?: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onRename: (newLabel: string) => void
  closeLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoEditDone = useRef(false)

  // 进入编辑时 focus + select
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // autoEdit：首次激活时自动进入编辑（只触发一次）
  useEffect(() => {
    if (autoEdit && isActive && !autoEditDone.current) {
      autoEditDone.current = true
      setDraft(label)
      setEditing(true)
    }
  }, [autoEdit, isActive, label])

  function commitEdit() {
    const trimmed = draft.trim() || label
    setEditing(false)
    onRename(trimmed)
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={() => { if (isActive) { setDraft(label); setEditing(true) } }}
      title={label}
      style={{
        position: 'relative',
        height: `${TAB_H}px`,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '10px',
        paddingRight: '6px',
        gap: '6px',
        cursor: 'pointer',
        userSelect: 'none',
        minWidth: '120px',
        maxWidth: '200px',
        flexShrink: 0,
        borderRadius: `${CORNER_R}px ${CORNER_R}px 0 0`,
        background: isActive ? C.white : 'transparent',
        boxShadow: isActive
          ? `0 1px 0 0 ${C.white}, inset 0 1px 0 rgba(0,0,0,0.04)`
          : 'none',
        marginBottom: '-1px',
        zIndex: isActive ? 2 : 1,
        transition: 'background 0.12s',
      }}
      className={isActive ? '' : 'hover:bg-black/5'}
    >
      {/* 激活标签两侧反向圆角 */}
      {isActive && (
        <>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: -CORNER_R,
              bottom: 0,
              width: CORNER_R,
              height: CORNER_R,
              background: `radial-gradient(circle at 0% 0%, transparent ${CORNER_R}px, ${C.white} ${CORNER_R}px)`,
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: -CORNER_R,
              bottom: 0,
              width: CORNER_R,
              height: CORNER_R,
              background: `radial-gradient(circle at 100% 0%, transparent ${CORNER_R}px, ${C.white} ${CORNER_R}px)`,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      {/* Favicon 占位符 */}
      {favicon ? (
        <img src={favicon} alt="" width={14} height={14} style={{ flexShrink: 0, borderRadius: '2px' }} />
      ) : (
        <span
          style={{
            width: '14px',
            height: '14px',
            flexShrink: 0,
            borderRadius: '2px',
            background: isActive ? 'rgba(85,96,113,0.15)' : 'rgba(85,96,113,0.1)',
            display: 'inline-block',
          }}
        />
      )}

      {/* 标题 / 内联编辑 */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
            if (e.key === 'Escape') { setEditing(false); setDraft(label) }
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '13px',
            fontWeight: '500',
            color: C.fg,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: 0,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '13px',
            fontWeight: isActive ? '500' : '400',
            color: isActive ? C.fg : C.muted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
      )}

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        aria-label={closeLabel}
        style={{
          flexShrink: 0,
          width: '18px',
          height: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: C.muted,
          fontSize: '12px',
          lineHeight: 1,
          opacity: 0.6,
          transition: 'opacity 0.1s, background 0.1s',
          padding: 0,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.opacity = '1'
          el.style.background = 'rgba(0,0,0,0.08)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.opacity = '0.6'
          el.style.background = 'none'
        }}
      >
        ✕
      </button>
    </div>
  )
}

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tabs, activeTabId, closeTab, activateTab, updateTabLabel } = useTabs()
  const { t } = useTranslation()
  const { user, logout } = useAuth()

  // 记录哪些 tab 是刚刚新开的（需要 autoEdit）
  // 只对从未 rename 过的 tab 触发，用 localStorage 跨页面持久化
  const RENAMED_KEY = 'liberstudy_renamed_tabs'
  function getRenamedSet(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(RENAMED_KEY) ?? '[]')) } catch { return new Set() }
  }
  function markRenamed(sessionId: string) {
    const s = getRenamedSet(); s.add(sessionId)
    localStorage.setItem(RENAMED_KEY, JSON.stringify([...s]))
  }

  const [newTabIds, setNewTabIds] = useState<Set<string>>(new Set())
  const prevTabIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.sessionId))
    const renamed = getRenamedSet()
    const added: string[] = []
    currentIds.forEach((id) => {
      if (!prevTabIds.current.has(id) && !renamed.has(id)) added.push(id)
    })
    if (added.length > 0) {
      setNewTabIds((prev) => {
        const next = new Set(prev)
        added.forEach((id) => next.add(id))
        return next
      })
    }
    prevTabIds.current = currentIds
  }, [tabs])

  const notesMatch = location.pathname.match(/^\/notes\/([^/]+)$/)
  const currentSessionId = notesMatch ? notesMatch[1] : null

  const onLobby = location.pathname === '/'

  if (location.pathname === '/login') {
    return null
  }

  function handleDashboard() {
    navigate('/')
  }

  function handleTabClick(sessionId: string) {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    const targetPath = tab?.path ?? `/notes/${sessionId}`
    activateTab(sessionId)
    if (location.pathname !== targetPath) {
      navigate(targetPath)
    }
  }

  function handleTabClose(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    closeTab(sessionId)
    if (activeTabId === sessionId) {
      activateTab('')
      navigate('/')
    }
  }

  function handleTabRename(sessionId: string, newLabel: string) {
    updateTabLabel(sessionId, newLabel)
    markRenamed(sessionId)
    // 标记 autoEdit 已完成，不再 autoEdit
    setNewTabIds((prev) => {
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }

  return (
    <header
      style={{
        height: `${BAR_H}px`,
        background: C.bg,
        backdropFilter: 'blur(24px)',
        borderBottom: `1px solid ${C.border}`,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingLeft: '16px',
        paddingRight: '16px',
      }}
    >
      {/* Logo + Dashboard */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          height: `${TAB_H}px`,
          flexShrink: 0,
          paddingLeft: '4px',
          paddingRight: '8px',
        }}
      >
        <button
          style={{ fontSize: '16px', fontWeight: '700', color: C.fg, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
          onClick={handleDashboard}
        >
          LiberStudy
        </button>

        <button
          onClick={handleDashboard}
          style={{
            fontSize: '12px',
            color: onLobby ? C.fg : C.muted,
            fontWeight: onLobby ? '500' : '400',
            background: onLobby ? 'rgba(175,179,176,0.12)' : 'transparent',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {t('topbar_dashboard')}
        </button>
      </div>

      {/* 分隔线 */}
      <div style={{ width: '1px', height: '16px', background: C.border, flexShrink: 0, marginRight: '8px' }} />

      {/* 标签区 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: `${TAB_H}px`,
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeTabId
          const autoEdit = newTabIds.has(tab.sessionId)
          return (
            <ChromeTab
              key={tab.sessionId}
              label={tab.label}
              isActive={isActive}
              autoEdit={autoEdit}
              onClick={() => handleTabClick(tab.sessionId)}
              onClose={(e) => handleTabClose(e, tab.sessionId)}
              onRename={(newLabel) => handleTabRename(tab.sessionId, newLabel)}
              closeLabel={`${t('topbar_close_tab')} ${tab.label}`}
            />
          )
        })}
      </div>

      {/* 右侧：Detailed Note 按钮（仅在 notes 页面显示） */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', height: `${TAB_H}px` }}>
        {currentSessionId && (
          <button
            onClick={() => navigate(`/notes/detail/${currentSessionId}`)}
            style={{
              fontSize: '12px',
              color: C.muted,
              background: 'rgba(175,179,176,0.12)',
              border: '1px solid rgba(175,179,176,0.2)',
              borderRadius: '6px',
              padding: '3px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('topbar_detailed_note')}
          </button>
        )}

        {user && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                borderRadius: '9999px',
                background: 'rgba(175,179,176,0.12)',
                color: C.muted,
                fontSize: '12px',
              }}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  style={{ width: '20px', height: '20px', borderRadius: '50%' }}
                />
              ) : (
                <span
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'rgba(85,96,113,0.18)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    color: C.fg,
                  }}
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span style={{ maxWidth: '140px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login'))
              }}
              style={{
                fontSize: '12px',
                color: C.muted,
                background: 'transparent',
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                padding: '3px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              退出
            </button>
          </>
        )}
      </div>
    </header>
  )
}
