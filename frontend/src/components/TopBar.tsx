// frontend/src/components/TopBar.tsx
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'

const C = {
  bg: 'rgba(240,239,234,0.95)',
  fg: '#2F3331',
  muted: '#556071',
  white: '#FFFFFF',
  border: 'rgba(175,179,176,0.25)',
}

// TopBar 总高度
const BAR_H = 40
// 标签高度（底部对齐，顶部留空白）
const TAB_H = 34
// 标签反向圆角半径
const CORNER_R = 8

/**
 * Chrome 风格标签。激活时白色底，底部"打通"底边线，两侧反向圆角。
 * 非激活：透明底，圆角 pill，hover 时略带底色。
 */
function ChromeTab({
  label,
  favicon,
  isActive,
  onClick,
  onClose,
}: {
  label: string
  favicon?: string
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onClick}
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
        // 激活：白色背景，底部无圆角——用 border-radius 只给顶部
        borderRadius: isActive ? `${CORNER_R}px ${CORNER_R}px 0 0` : `${CORNER_R}px ${CORNER_R}px 0 0`,
        background: isActive ? C.white : 'transparent',
        // 底边：激活时白色"覆盖"掉 TopBar 的底边线，非激活无
        boxShadow: isActive
          ? `0 1px 0 0 ${C.white}, inset 0 1px 0 rgba(0,0,0,0.04)`
          : 'none',
        marginBottom: '-1px', // 让底部与 TopBar 底边线重叠，打通效果
        zIndex: isActive ? 2 : 1,
        transition: 'background 0.12s',
      }}
      className={isActive ? '' : 'hover:bg-black/5'}
    >
      {/* 激活标签左侧反向圆角（内切角） */}
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
              // 用 radial-gradient 模拟内切角
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

      {/* 标题，截断 */}
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

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        aria-label={`关闭 ${label}`}
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
  const { tabs, activeTabId, closeTab, activateTab } = useTabs()

  // 从路径解析当前 sessionId（用于 Detailed Note 按钮）
  const notesMatch = location.pathname.match(/^\/notes\/([^/]+)$/)
  const currentSessionId = notesMatch ? notesMatch[1] : null

  const onLobby = location.pathname === '/'

  function handleDashboard() {
    navigate('/')
  }

  function handleTabClick(sessionId: string) {
    activateTab(sessionId)
    navigate(`/notes/${sessionId}`)
  }

  function handleTabClose(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    closeTab(sessionId)
    if (activeTabId === sessionId) {
      navigate('/')
    }
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
      {/* Logo + Dashboard，垂直底对齐，与标签同行 */}
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
        {/* Logo */}
        <button
          style={{ fontSize: '16px', fontWeight: '700', color: C.fg, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
          onClick={handleDashboard}
        >
          LiberStudy
        </button>

        {/* Dashboard */}
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
          Dashboard
        </button>
      </div>

      {/* 分隔线 */}
      <div style={{ width: '1px', height: '16px', background: C.border, flexShrink: 0, marginRight: '8px' }} />

      {/* 标签区，底部对齐 */}
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
          return (
            <ChromeTab
              key={tab.sessionId}
              label={tab.label}
              isActive={isActive}
              onClick={() => handleTabClick(tab.sessionId)}
              onClose={(e) => handleTabClose(e, tab.sessionId)}
            />
          )
        })}
      </div>

      {/* 右侧：Detailed Note 按钮（仅在 notes 页面显示） */}
      {currentSessionId && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: `${TAB_H}px` }}>
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
            Detailed Note →
          </button>
        </div>
      )}
    </header>
  )
}
