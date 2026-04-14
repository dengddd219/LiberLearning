// frontend/src/components/TopBar.tsx
import { useNavigate, useLocation } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'

const C = {
  bg: 'rgba(240,239,234,0.85)',
  fg: '#2F3331',
  muted: '#556071',
  dark: '#2F3331',
  white: '#FFFFFF',
}

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tabs, activeTabId, closeTab, activateTab } = useTabs()

  // 判断当前是否在大厅
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
    // 如果关闭的是当前激活 tab，回到大厅
    if (activeTabId === sessionId) {
      navigate('/')
    }
  }

  return (
    <header
      className="flex items-center justify-between px-6 flex-shrink-0 z-30"
      style={{
        height: '64px',
        background: C.bg,
        backdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(175,179,176,0.1)',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
      }}
    >
      {/* Left: Logo + Dashboard + Course Tabs */}
      <div className="flex items-center gap-2 overflow-hidden">
        <button
          className="font-bold flex-shrink-0"
          style={{ fontSize: '20px', color: C.fg, background: 'none', border: 'none', padding: 0 }}
          onClick={handleDashboard}
        >
          LiberStudy
        </button>

        {/* Dashboard button */}
        <button
          onClick={handleDashboard}
          className="px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all duration-150 flex-shrink-0"
          style={{
            color: onLobby ? C.fg : C.muted,
            fontWeight: onLobby ? '500' : '400',
            background: onLobby ? 'rgba(175,179,176,0.1)' : 'transparent',
          }}
        >
          Dashboard
        </button>

        {/* Divider */}
        {tabs.length > 0 && (
          <div
            className="flex-shrink-0 mx-1"
            style={{ width: '1px', height: '18px', background: 'rgba(175,179,176,0.3)' }}
          />
        )}

        {/* Dynamic course tabs */}
        <div className="flex items-center gap-1 overflow-x-auto" style={{ maxWidth: 'calc(100vw - 320px)' }}>
          {tabs.map((tab) => {
            const isActive = tab.sessionId === activeTabId
            return (
              <div
                key={tab.sessionId}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150 flex-shrink-0 group"
                style={{
                  color: isActive ? C.fg : C.muted,
                  fontWeight: isActive ? '500' : '400',
                  background: isActive ? 'rgba(175,179,176,0.1)' : 'transparent',
                  fontSize: '14px',
                }}
                onClick={() => handleTabClick(tab.sessionId)}
              >
                {tab.label}
                <button
                  onClick={(e) => handleTabClose(e, tab.sessionId)}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity rounded"
                  style={{ fontSize: '12px', lineHeight: 1, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div />
    </header>
  )
}
