# Button Navigation Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通所有页面的按钮交互——顶栏导航、Courses 动态 Tab、DetailedNote 入口迁移、My/AI Notes Tab 切换、PREVIOUS/NEXT 翻页——保留后端接口门，现在用 mock 数据，之后换真实 API 即可工作。

**Architecture:** 
用 React Context (`TabsContext`) 管理全局打开的 Courses Tab 列表，所有页面顶栏共享这个状态。顶栏提取为独立组件 `TopBar`，在 App 层渲染一次，各页面不再各自维护顶栏。DetailedNote 入口从顶栏移到 NotesPage 右侧面板内。

**Tech Stack:** React 18, React Router v6, TypeScript, Tailwind CSS

---

## 文件变更地图

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `frontend/src/context/TabsContext.tsx` | 全局 Courses Tab 状态：打开列表、当前激活 tab、open/close/activate |
| 新建 | `frontend/src/components/TopBar.tsx` | 统一顶栏组件：Logo、Dashboard、Courses tab 栏、铃铛、头像 |
| 修改 | `frontend/src/App.tsx` | 包裹 `TabsProvider`，在路由外层渲染 `<TopBar>` |
| 修改 | `frontend/src/pages/NotesPage.tsx` | 1) 移除页内顶栏 JSX；2) 顶栏高度占位保留；3) 打开笔记时调用 `openTab()`；4) 添加「Detailed Note」入口按钮到右侧面板顶部 |
| 修改 | `frontend/src/pages/DetailedNotePage.tsx` | 1) 移除页内顶栏 JSX；2) 顶栏占位保留；3) 接入真实 `sessionId`；4) 实现 My/AI Notes Tab 切换；5) 实现 PREVIOUS/NEXT 翻页 |
| 修改 | `frontend/src/pages/SessionPage.tsx` | 移除页内顶栏 JSX，保留顶栏高度占位 |
| 修改 | `frontend/src/pages/LiveSessionPage.tsx` | 移除页内顶栏 JSX，保留顶栏高度占位 |
| 修改 | `frontend/src/pages/LobbyPage.tsx` | 移除页内顶栏 JSX，保留顶栏高度占位；卡片点击时调用 `openTab()` |

---

## Task 1：创建 TabsContext

**Files:**
- Create: `frontend/src/context/TabsContext.tsx`

这是整个计划的数据基础，先建好再动其他文件。

- [ ] **Step 1: 创建 TabsContext.tsx**

```tsx
// frontend/src/context/TabsContext.tsx
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export interface CourseTab {
  sessionId: string
  label: string          // 显示在 tab 上的名字，如 "7028" 或课程名
}

interface TabsState {
  tabs: CourseTab[]
  activeTabId: string | null
  openTab: (tab: CourseTab) => void
  closeTab: (sessionId: string) => void
  activateTab: (sessionId: string) => void
}

const TabsContext = createContext<TabsState | null>(null)

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<CourseTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const openTab = useCallback((tab: CourseTab) => {
    setTabs((prev) => {
      if (prev.find((t) => t.sessionId === tab.sessionId)) return prev
      return [...prev, tab]
    })
    setActiveTabId(tab.sessionId)
  }, [])

  const closeTab = useCallback((sessionId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== sessionId)
      return next
    })
    setActiveTabId((prev) => {
      if (prev !== sessionId) return prev
      // 激活相邻 tab
      const idx = tabs.findIndex((t) => t.sessionId === sessionId)
      const next = tabs.filter((t) => t.sessionId !== sessionId)
      return next[Math.max(0, idx - 1)]?.sessionId ?? null
    })
  }, [tabs])

  const activateTab = useCallback((sessionId: string) => {
    setActiveTabId(sessionId)
  }, [])

  return (
    <TabsContext.Provider value={{ tabs, activeTabId, openTab, closeTab, activateTab }}>
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within TabsProvider')
  return ctx
}
```

- [ ] **Step 2: 验证文件存在**

```bash
ls frontend/src/context/
```
期望：输出 `TabsContext.tsx`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/TabsContext.tsx
git commit -m "feat: add TabsContext for global course tab state"
```

---

## Task 2：创建 TopBar 组件

**Files:**
- Create: `frontend/src/components/TopBar.tsx`

TopBar 读取 TabsContext，渲染 Dashboard 按钮 + 动态 Courses Tab 列表 + 铃铛 + 头像。

- [ ] **Step 1: 创建 TopBar.tsx**

```tsx
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
        <span
          className="font-bold flex-shrink-0 cursor-pointer"
          style={{ fontSize: '20px', color: C.fg }}
          onClick={handleDashboard}
        >
          LiberStudy
        </span>

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

      {/* Right: Bell + Avatar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button className="cursor-pointer transition-all duration-150 p-1.5 rounded-lg hover:bg-black/5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <div
          className="rounded-full flex items-center justify-center cursor-pointer"
          style={{ width: '32px', height: '32px', background: C.dark, color: C.white, fontSize: '13px', fontWeight: '600' }}
        >
          U
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TopBar.tsx
git commit -m "feat: add TopBar component with dynamic course tabs"
```

---

## Task 3：在 App.tsx 挂载 TabsProvider 和 TopBar

**Files:**
- Modify: `frontend/src/App.tsx`

TopBar 必须在路由外层，才能在所有页面显示同一个顶栏（否则每次路由切换顶栏会重置）。

- [ ] **Step 1: 修改 App.tsx**

用以下内容完整替换 `frontend/src/App.tsx`：

```tsx
// frontend/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { TabsProvider } from './context/TabsContext'
import TopBar from './components/TopBar'
import LobbyPage from './pages/LobbyPage'
import SessionPage from './pages/SessionPage'
import LiveSessionPage from './pages/LiveSessionPage'
import UploadPage from './pages/UploadPage'
import ProcessingPage from './pages/ProcessingPage'
import NotesPage from './pages/NotesPage'
import DetailedNotePage from './pages/DetailedNotePage'

function App() {
  return (
    <TabsProvider>
      <TopBar />
      <Routes>
        <Route path="/"                        element={<LobbyPage />} />
        <Route path="/session"                 element={<SessionPage />} />
        <Route path="/session/live"            element={<LiveSessionPage />} />
        <Route path="/upload"                  element={<UploadPage />} />
        <Route path="/processing"              element={<ProcessingPage />} />
        <Route path="/notes/:sessionId"        element={<NotesPage />} />
        <Route path="/notes/detail/:sessionId" element={<DetailedNotePage />} />
        <Route path="*"                        element={<Navigate to="/" replace />} />
      </Routes>
    </TabsProvider>
  )
}

export default App
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wrap app in TabsProvider, mount global TopBar"
```

---

## Task 4：LobbyPage 去掉页内顶栏，卡片点击时打开 Tab

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`

需要做两件事：
1. 删除页内顶栏 header JSX（TopBar 已在 App 层渲染）
2. 卡片点击时调用 `openTab({ sessionId, label })` 再导航

- [ ] **Step 1: 找到 LobbyPage 顶栏 JSX 的边界**

读取文件，找到 `<header` 开始和结束的行号，确认要删除的范围。

- [ ] **Step 2: 删除顶栏 JSX**

找到 LobbyPage 里从 `{/* Header */}` 或 `<header` 开始到对应 `</header>` 的区块，整段删除。

顶栏区块的特征（搜索这行定位）：
```
inline-flex justify-between items-center
```

- [ ] **Step 3: 添加 64px 顶部 padding 占位**

在 LobbyPage 最外层容器（`<div className="flex ...`）上加 `pt-16`（= 64px），补回被 fixed TopBar 遮挡的高度：

```tsx
// 原来的
<div className="flex h-screen overflow-hidden" ...>

// 改为（加 pt-16）
<div className="flex h-screen overflow-hidden pt-16" ...>
```

- [ ] **Step 4: 引入 useTabs，卡片点击时 openTab**

在 LobbyPage 文件顶部 import：
```tsx
import { useTabs } from '../context/TabsContext'
```

在组件内解构：
```tsx
const { openTab } = useTabs()
```

找到卡片点击 navigate 的地方，改为先 openTab 再 navigate：

```tsx
// 原来（DoneCard onClick）：
onClick={() => navigate(`/notes/${s.id}`)}

// 改为：
onClick={() => {
  openTab({ sessionId: s.id, label: s.course })
  navigate(`/notes/${s.id}`)
}}
```

列表模式 ListTable 的 onRowClick 同理：

```tsx
// 原来：
onRowClick={(id) => navigate(`/notes/${id}`)}

// 改为：
onRowClick={(id) => {
  const card = SESSIONS.find((s) => s.id === id)
  openTab({ sessionId: id, label: card?.course ?? id })
  navigate(`/notes/${id}`)
}}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx
git commit -m "feat: LobbyPage opens course tab on card click, removes inline topbar"
```

---

## Task 5：NotesPage 去掉页内顶栏，添加 Detailed Note 入口

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: 引入 useTabs，进入页面时 openTab**

文件顶部已有 `useParams`, `useNavigate`，追加：
```tsx
import { useTabs } from '../context/TabsContext'
```

在组件内解构：
```tsx
const { openTab } = useTabs()
```

在 `useEffect` 拉取 session 数据成功后，调用 openTab（session 标题作为 label）：

找到现有的 fetch 逻辑（类似 `setSession(data)` 的地方），在它后面加：
```tsx
openTab({ sessionId: sessionId!, label: data.ppt_filename ?? sessionId! })
```

- [ ] **Step 2: 删除页内顶栏 JSX**

找到 NotesPage 里的 `<header` 块（特征行：`position: 'fixed', top: 0`），整段删除到对应 `</header>`。

- [ ] **Step 3: 确认 marginTop: '64px' 占位已存在**

NotesPage 已有：
```tsx
<div className="flex flex-1 overflow-hidden" style={{ marginTop: '64px' }}>
```
这行不动，它本来就在，起到顶栏高度占位的作用。

- [ ] **Step 4: 在右侧面板顶部添加 Detailed Note 按钮**

找到右侧面板的 pill toggle 区域，在 pill toggle 上方插入：

```tsx
{/* Detailed Note 入口 */}
<div className="px-4 pt-3 pb-1 flex justify-end">
  <button
    onClick={() => navigate(`/notes/detail/${sessionId}`)}
    className="text-xs px-3 py-1 rounded-full cursor-pointer transition-all duration-150"
    style={{
      background: 'rgba(175,179,176,0.15)',
      color: '#556071',
      border: '1px solid rgba(175,179,176,0.2)',
    }}
  >
    Detailed Note →
  </button>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: NotesPage removes inline topbar, adds Detailed Note entry, opens tab on load"
```

---

## Task 6：DetailedNotePage 实现 My/AI Notes Tab 切换 + PREVIOUS/NEXT + 去掉顶栏

**Files:**
- Modify: `frontend/src/pages/DetailedNotePage.tsx`

DetailedNotePage 目前有大量静态 mock 内容。这个 Task 只改交互层，不重写内容渲染。

- [ ] **Step 1: 删除页内顶栏 JSX**

找到 DetailedNotePage 里的 `<header` 块，整段删除。

加顶部占位（在最外层 div 或 content wrapper 加 `style={{ paddingTop: '64px' }}`）。

- [ ] **Step 2: 添加 noteMode state，接通 My/AI Notes Pill**

文件顶部已有 `useState`，添加：
```tsx
const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
```

找到 My Notes / AI Notes Pill 的 JSX，改为绑定 state：

```tsx
{/* Pill toggle */}
<div className="inline-flex rounded-full p-0.5" style={{ background: 'rgba(175,179,176,0.15)' }}>
  {(['my', 'ai'] as const).map((mode) => (
    <button
      key={mode}
      onClick={() => setNoteMode(mode)}
      className="px-4 py-1 rounded-full text-sm cursor-pointer transition-all duration-150"
      style={{
        background: noteMode === mode ? '#FFFFFF' : 'transparent',
        color: noteMode === mode ? '#2F3331' : '#556071',
        fontWeight: noteMode === mode ? '500' : '400',
        boxShadow: noteMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {mode === 'my' ? 'My Notes' : 'AI Notes'}
    </button>
  ))}
</div>
```

- [ ] **Step 3: 根据 noteMode 渲染不同内容**

在 My Notes / AI Notes Pill 下方的内容区，用 `noteMode` 控制显示：

```tsx
{noteMode === 'ai' ? (
  <div>{/* 原有的 AI 笔记内容 JSX，保持不动 */}</div>
) : (
  <div className="py-8 text-center" style={{ color: '#8a8f8a', fontSize: '14px' }}>
    你还没有添加手动笔记
  </div>
)}
```

（My Notes 内容目前是 mock 占位，后端接通后替换）

- [ ] **Step 4: 实现 PREVIOUS / NEXT 翻页**

DetailedNotePage 通过 `useParams` 拿到 `sessionId`。PREVIOUS / NEXT 需要知道当前是哪一页，以及总页数。

在组件内添加 state（目前用 mock）：

```tsx
// 后端接通后，这里改为从 API 拿真实 pages 列表
const MOCK_PAGE_IDS = ['s1', 's2', 's3', 's4']  // 和 LobbyPage SESSIONS 对齐

const currentIndex = MOCK_PAGE_IDS.indexOf(sessionId ?? '')
const prevId = currentIndex > 0 ? MOCK_PAGE_IDS[currentIndex - 1] : null
const nextId = currentIndex < MOCK_PAGE_IDS.length - 1 ? MOCK_PAGE_IDS[currentIndex + 1] : null
```

找到底部 PREVIOUS / NEXT 的 JSX，改为：

```tsx
{/* Bottom Navigation */}
<div className="flex justify-between items-center py-8 mt-4" style={{ borderTop: '1px solid rgba(175,179,176,0.2)' }}>
  <button
    onClick={() => prevId && navigate(`/notes/detail/${prevId}`)}
    disabled={!prevId}
    className="flex items-center gap-2 text-sm cursor-pointer transition-all duration-150"
    style={{ color: prevId ? '#2F3331' : '#C4C7C4', background: 'none', border: 'none' }}
  >
    ← PREVIOUS
  </button>
  <button
    onClick={() => nextId && navigate(`/notes/detail/${nextId}`)}
    disabled={!nextId}
    className="flex items-center gap-2 text-sm cursor-pointer transition-all duration-150"
    style={{ color: nextId ? '#2F3331' : '#C4C7C4', background: 'none', border: 'none' }}
  >
    NEXT →
  </button>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DetailedNotePage.tsx
git commit -m "feat: DetailedNotePage - My/AI Notes tab, PREVIOUS/NEXT nav, remove inline topbar"
```

---

## Task 7：SessionPage 和 LiveSessionPage 去掉页内顶栏

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`
- Modify: `frontend/src/pages/LiveSessionPage.tsx`

这两个页面去掉顶栏 JSX，加顶栏高度占位即可。

- [ ] **Step 1: 修改 SessionPage.tsx**

找到 `<header` 块，找到特征行（如 `顶部导航` 注释或 `Dashboard` / `Courses` / `Detailed Note` 这三个文字）所在的整个 header 区块，完整删除。

在 SessionPage 最外层布局 div 添加顶部 padding：
```tsx
// 找到最外层 div 或 main，加 style={{ paddingTop: '64px' }} 或 className 加 pt-16
```

SessionPage 顶栏特征行：
```
顶部 "Dashboard" 链接 // 纯文字 div
```
或搜索：`Detailed Note` 所在的行。

- [ ] **Step 2: 修改 LiveSessionPage.tsx**

同 Step 1，找到 LiveSessionPage 的顶栏 JSX（特征：包含 `Dashboard`、`Courses`、`Detailed Note` 三个 div 文字），整段删除，加 `paddingTop: '64px'` 占位。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SessionPage.tsx frontend/src/pages/LiveSessionPage.tsx
git commit -m "feat: remove inline topbars from SessionPage and LiveSessionPage"
```

---

## Task 8：冒烟测试全流程

手动点一遍核心路径，确认交互正常。

- [ ] **Step 1: 启动前端开发服务器**

```bash
cd frontend && npm run dev
```

打开浏览器访问 `http://localhost:5173`

- [ ] **Step 2: 测试 Dashboard 导航**

在任意非大厅页面点 Dashboard → 应跳回 `/`，TopBar 的 Dashboard 按钮高亮。

- [ ] **Step 3: 测试 Courses Tab**

1. 在大厅点一个课程卡片 → 跳到 `/notes/{id}`，顶栏出现该课程的 Tab
2. 返回大厅，再点另一个卡片 → 顶栏出现第二个 Tab
3. 点第一个 Tab → 跳回第一个笔记页
4. 点 Tab 上的 ✕ → Tab 关闭，若是当前激活 Tab 则跳回大厅

- [ ] **Step 4: 测试 Detailed Note 入口**

进入 NotesPage → 右侧面板顶部应看到「Detailed Note →」按钮 → 点击 → 跳到 `/notes/detail/{sessionId}`

- [ ] **Step 5: 测试 DetailedNotePage**

1. My Notes / AI Notes Pill 点击可切换，内容区随之切换
2. 点 PREVIOUS / NEXT → 在 mock session 之间翻页（sessionId 变化）
3. 到第一个时 PREVIOUS 置灰，到最后一个时 NEXT 置灰

- [ ] **Step 6: 确认无顶栏重叠**

所有页面顶栏应只出现一次（来自 App 层的 TopBar），不应有双重顶栏。

---

## 后端接入预留门

以下位置在后端接通时需要替换：

| 位置 | 现在 | 接通后替换为 |
|------|------|-------------|
| `LobbyPage` SESSIONS | 静态 mock 数组 | `GET /api/sessions` 列表接口 |
| `NotesPage` openTab label | `data.ppt_filename` | 同，字段名已对齐 |
| `DetailedNotePage` MOCK_PAGE_IDS | 静态 `['s1','s2','s3','s4']` | 从 `GET /api/sessions` 拿 id 列表 |
| `DetailedNotePage` noteMode=my 内容 | 占位文字 | `GET /api/sessions/{id}` 的用户笔记字段 |
