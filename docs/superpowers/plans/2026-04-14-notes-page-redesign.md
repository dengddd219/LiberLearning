# NotesPage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四项改动：删除对齐置信度 badge、用 react-pdf 渲染中间画布、中/右面板加可拖动分割线、右侧 AI Notes 区域重设计（PPT bullet + 点击展开 AI 解释打字机效果）。

**Architecture:** 全部改动在 `frontend/src/pages/NotesPage.tsx` 单文件内完成，抽出一个轻量 `useTypewriter` hook 到独立文件。react-pdf 用 `@react-pdf-viewer/core` 替代方案——实际用 `react-pdf`（pdfjs-dist）逐页渲染，worker 通过 vite config 配置。

**Tech Stack:** react-pdf (pdfjs-dist), TypeScript, React hooks, Tailwind CSS (inline styles 保持现有风格)

---

## 文件地图

| 操作 | 路径 | 说明 |
|------|------|------|
| Modify | `frontend/package.json` | 添加 `react-pdf` 依赖 |
| Modify | `frontend/vite.config.ts` | 配置 pdf worker 静态资源路径 |
| Create | `frontend/src/hooks/useTypewriter.ts` | 打字机 hook |
| Modify | `frontend/src/pages/NotesPage.tsx` | 所有 UI 改动 |

---

## Task 1: 安装 react-pdf 并配置 worker

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: 安装依赖**

在 `frontend/` 目录下运行：

```bash
cd frontend && npm install react-pdf
```

预期输出：`added N packages`，无报错。

- [ ] **Step 2: 配置 vite worker**

`react-pdf` 需要 pdf.js worker。编辑 `frontend/vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/slides': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/audio': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react-pdf'],
  },
})
```

- [ ] **Step 3: 验证安装**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

预期：build 成功，无 `react-pdf` 相关报错。

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts
git commit -m "feat: install react-pdf and configure vite worker"
```

---

## Task 2: 创建 useTypewriter hook

**Files:**
- Create: `frontend/src/hooks/useTypewriter.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/hooks/useTypewriter.ts
import { useState, useEffect, useRef } from 'react'

/**
 * 打字机效果 hook。
 * - 调用 start() 开始播放，只播一次，播完后 done=true
 * - 调用 reset() 清空（用于收起）
 */
export function useTypewriter(text: string, speed = 18) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)
  const indexRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function start() {
    if (running || done) return
    setRunning(true)
    indexRef.current = 0
    setDisplayed('')
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setDisplayed('')
    setDone(false)
    setRunning(false)
    indexRef.current = 0
  }

  useEffect(() => {
    if (!running || done) return
    if (indexRef.current >= text.length) {
      setDone(true)
      setRunning(false)
      return
    }
    timerRef.current = setTimeout(() => {
      indexRef.current += 1
      setDisplayed(text.slice(0, indexRef.current))
    }, speed)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [running, displayed, text, speed, done])

  return { displayed, done, start, reset }
}
```

- [ ] **Step 2: 验证 TypeScript 类型正确**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep useTypewriter
```

预期：无输出（无报错）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTypewriter.ts
git commit -m "feat: add useTypewriter hook"
```

---

## Task 3: 删除对齐置信度 badge

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx:381-388`

- [ ] **Step 1: 删除 confidence badge**

在 `NotesPage.tsx` 找到以下代码块并删除（约在 381-388 行）：

```tsx
{/* 删除以下整块 */}
{page.alignment_confidence < 0.6 && (
  <div
    className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded-full"
    style={{ background: '#F59E0B', color: C.white }}
  >
    对齐置信度低
  </div>
)}
```

`alignment_confidence` 字段保留在 `PageData` interface 里，不动数据层。

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: remove alignment confidence badge from slide canvas"
```

---

## Task 4: 中间画布改用 react-pdf 渲染

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

**背景：** 后端每页数据有 `pdf_url`（如 `/slides/slides.pdf`）和 `pdf_page_num`。同一 session 所有页共享同一个 PDF 文件，只是页码不同。用 `react-pdf` 的 `<Document>` + `<Page>` 逐页渲染，每页一个卡片。

- [ ] **Step 1: 在文件顶部添加 react-pdf import**

在 `NotesPage.tsx` 顶部已有 import 列表之后添加：

```tsx
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()
```

- [ ] **Step 2: 添加 canvasWidth state**

在 `NotesPage` 组件内，已有 state 列表之后添加：

```tsx
const canvasAreaRef = useRef<HTMLDivElement>(null)
const [canvasWidth, setCanvasWidth] = useState(800)

useEffect(() => {
  if (!canvasAreaRef.current) return
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // 画布宽度 = 容器宽度 - padding (96px * 2)
      setCanvasWidth(Math.max(400, entry.contentRect.width - 192))
    }
  })
  ro.observe(canvasAreaRef.current)
  return () => ro.disconnect()
}, [])
```

- [ ] **Step 3: 替换画布区域渲染**

找到 Canvas area 那一块（约 350-408 行）：

```tsx
{/* Canvas area */}
<div className="flex-1 overflow-y-auto p-12" style={{ background: 'rgba(232,231,226,0.6)' }}>
  <div className="flex flex-col items-center gap-8 max-w-4xl mx-auto">
    {session.pages.map((page) => (
      <div
        key={page.page_num}
        data-page={page.page_num}
        ref={(el) => {
          if (el) pageRefs.current.set(page.page_num, el)
          else pageRefs.current.delete(page.page_num)
        }}
        className="relative w-full"
        style={{ maxWidth: '896px' }}
      >
        {/* Slide card */}
        <div
          className="relative w-full rounded-lg overflow-hidden"
          style={{
            background: C.white,
            boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          }}
        >
          <img
            src={page.thumbnail_url
              ? `${API_BASE}${page.thumbnail_url}`
              : `${API_BASE}/api/sessions/${sessionId}/slide/${page.pdf_page_num}.png`}
            alt={`第${page.page_num}页`}
            style={{ width: '100%', display: 'block' }}
            loading="lazy"
          />
          {/* Confidence warning - 已在 Task 3 删除 */}
          {/* Play button */}
          <button
            onClick={() => handleTimestampClick(page.page_start_time)}
            className="absolute top-3 left-3 text-xs px-2 py-0.5 rounded cursor-pointer transition-all duration-150"
            style={{ background: 'rgba(47,51,49,0.7)', color: C.white }}
          >
            ▶ {formatTime(page.page_start_time)}
          </button>
          {/* Slide label bottom-right */}
          <div
            className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
            style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
          >
            SLIDE {String(page.page_num).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
          </div>
        </div>
      </div>
    ))}
  </div>
</div>
```

替换为：

```tsx
{/* Canvas area */}
<div
  ref={canvasAreaRef}
  className="flex-1 overflow-y-auto p-12"
  style={{ background: 'rgba(232,231,226,0.6)' }}
>
  <div className="flex flex-col items-center gap-8 mx-auto" style={{ maxWidth: '896px' }}>
    {session.pages.map((page) => {
      const pdfUrl = page.pdf_url
        ? `${API_BASE}${page.pdf_url}`
        : null
      return (
        <div
          key={page.page_num}
          data-page={page.page_num}
          ref={(el) => {
            if (el) pageRefs.current.set(page.page_num, el)
            else pageRefs.current.delete(page.page_num)
          }}
          className="relative w-full"
        >
          {/* Slide card */}
          <div
            className="relative rounded-lg overflow-hidden"
            style={{
              background: C.white,
              boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
              display: 'inline-block',
              width: '100%',
            }}
          >
            {pdfUrl ? (
              <Document
                file={pdfUrl}
                loading={
                  <div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
                  </div>
                }
              >
                <Page
                  pageNumber={page.pdf_page_num}
                  width={canvasWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>
            ) : (
              <img
                src={`${API_BASE}/api/sessions/${sessionId}/slide/${page.pdf_page_num}.png`}
                alt={`第${page.page_num}页`}
                style={{ width: '100%', display: 'block' }}
                loading="lazy"
              />
            )}
            {/* Play button */}
            <button
              onClick={() => handleTimestampClick(page.page_start_time)}
              className="absolute top-3 left-3 text-xs px-2 py-0.5 rounded cursor-pointer transition-all duration-150"
              style={{ background: 'rgba(47,51,49,0.7)', color: C.white }}
            >
              ▶ {formatTime(page.page_start_time)}
            </button>
            {/* Slide label bottom-right */}
            <div
              className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
            >
              SLIDE {String(page.page_num).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </div>
          </div>
        </div>
      )
    })}
  </div>
</div>
```

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：无报错。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: replace img with react-pdf renderer in slide canvas"
```

---

## Task 5: 中/右面板可拖动分割线

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: 添加 notesPanelWidth state 和 resizer 逻辑**

在组件内已有 state 之后添加：

```tsx
const [notesPanelWidth, setNotesPanelWidth] = useState(320)
const isResizingRef = useRef(false)
const resizeStartXRef = useRef(0)
const resizeStartWidthRef = useRef(320)

const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
  isResizingRef.current = true
  resizeStartXRef.current = e.clientX
  resizeStartWidthRef.current = notesPanelWidth
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const onMouseMove = (ev: MouseEvent) => {
    if (!isResizingRef.current) return
    const delta = resizeStartXRef.current - ev.clientX
    setNotesPanelWidth(Math.max(100, resizeStartWidthRef.current + delta))
  }

  const onMouseUp = () => {
    isResizingRef.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}, [notesPanelWidth])
```

- [ ] **Step 2: 在 main 和右侧 aside 之间插入 Resizer**

找到 `{/* Right panel: Notes */}` 那一行（约 411 行），在 `<main>` 的结束标签 `</main>` 之后、右侧 `<aside>` 之前插入：

```tsx
{/* Resizer */}
<div
  onMouseDown={handleResizerMouseDown}
  className="flex-shrink-0 flex items-center justify-center"
  style={{
    width: '8px',
    cursor: 'col-resize',
    background: 'transparent',
    position: 'relative',
    zIndex: 10,
  }}
  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.06)' }}
  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
>
  <div style={{ width: '1px', height: '100%', background: 'rgba(175,179,176,0.2)' }} />
</div>
```

- [ ] **Step 3: 右侧 aside 改为受控宽度**

找到右侧 aside 的 style，把 `width: '320px'` 改为：

```tsx
style={{ width: `${notesPanelWidth}px`, background: C.white, borderLeft: 'none' }}
```

注意同时把 `borderLeft: '1px solid rgba(175,179,176,0.1)'` 删掉（分割线已由 Resizer 承担）。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：无报错。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: add draggable resizer between canvas and notes panel"
```

---

## Task 6: 右侧 AI Notes 重设计 — Pill Toggle 精细化

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

按 Figma node `2:1100`~`2:1107` 重写 pill toggle。

- [ ] **Step 1: 替换 pill toggle JSX**

找到 pill toggle 部分（约 432-479 行），整块替换为：

```tsx
{/* Pill toggle */}
<div className="flex-shrink-0 px-6 pt-6 pb-4">
  <div
    role="group"
    aria-label="笔记模式"
    className="flex items-center p-1"
    style={{ background: C.sidebar, borderRadius: '9999px' }}
  >
    {/* My Notes */}
    <button
      type="button"
      role="tab"
      aria-selected={noteMode === 'my'}
      onClick={() => setNoteMode('my')}
      className="flex-1 flex items-center justify-center text-sm cursor-pointer transition-all duration-150 py-1.5 px-3"
      style={{
        borderRadius: '9999px',
        fontWeight: noteMode === 'my' ? '500' : '500',
        background: noteMode === 'my' ? C.white : 'transparent',
        color: noteMode === 'my' ? C.fg : C.muted,
        boxShadow: noteMode === 'my' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
        border: 'none',
        fontSize: '12px',
      }}
    >
      My Notes
    </button>
    {/* AI Notes */}
    <button
      type="button"
      role="tab"
      aria-selected={noteMode === 'ai'}
      onClick={() => setNoteMode('ai')}
      className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 py-1.5 px-3"
      style={{
        borderRadius: '9999px',
        fontWeight: noteMode === 'ai' ? '600' : '500',
        background: noteMode === 'ai' ? C.white : 'transparent',
        color: noteMode === 'ai' ? C.fg : C.muted,
        boxShadow: noteMode === 'ai' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
        border: 'none',
        fontSize: '12px',
      }}
    >
      {/* Left sparkle icon — always shown in AI Notes button */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
          fill={noteMode === 'ai' ? C.fg : C.muted}
        />
      </svg>
      AI Notes
      {/* Right sparkle icon — only when active */}
      {noteMode === 'ai' && (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
            fill={C.fg}
          />
        </svg>
      )}
    </button>
  </div>
</div>
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: redesign AI Notes pill toggle with sparkle icons per Figma"
```

---

## Task 7: 右侧 AI Notes 内容区 — PPT bullet + 点击展开打字机

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

**数据映射逻辑：**
- `ppt_text` 按 `\n` 分割，过滤空行，得到 PPT 原文行数组 `pptLines`
- `passive_notes.bullets` 是 AI 解释数组
- 第 i 个 PPT line 对应第 i 个 AI bullet（多出来的那方不显示对应）
- 点击某行 → 展开 AI 解释（打字机）；再次点击 → 收起

- [ ] **Step 1: 导入 useTypewriter hook**

在 `NotesPage.tsx` 顶部添加：

```tsx
import { useTypewriter } from '../hooks/useTypewriter'
```

- [ ] **Step 2: 创建 AiBulletRow 子组件**

在 `NotesPage` 函数**之前**（文件内，export default 上方）添加：

```tsx
/** 单行：PPT 原文 + 点击展开 AI 解释（打字机） */
function AiBulletRow({
  pptLine,
  aiBullet,
  onTimestampClick,
}: {
  pptLine: string
  aiBullet?: { text: string; ai_comment: string; timestamp_start: number; timestamp_end: number }
  onTimestampClick: (t: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { displayed, done, start, reset } = useTypewriter(aiBullet?.text ?? '', 15)

  function toggle() {
    if (!aiBullet) return
    if (expanded) {
      setExpanded(false)
      reset()
    } else {
      setExpanded(true)
      start()
    }
  }

  // Strip leading bullet markers (•, -, *)
  const cleanLine = pptLine.replace(/^[\u2022\-\*]\s*/, '').trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* PPT 原文行 */}
      <button
        type="button"
        onClick={toggle}
        className="text-left w-full transition-all duration-150"
        style={{
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: aiBullet ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <span style={{ color: '#AFB3B0', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>•</span>
        <span
          style={{
            fontSize: '14px',
            color: '#1A1916',
            lineHeight: '1.625',
            fontWeight: '500',
            textDecoration: aiBullet && !expanded ? 'none' : 'none',
            opacity: aiBullet ? 1 : 0.5,
          }}
        >
          {cleanLine}
        </span>
        {/* Expand indicator */}
        {aiBullet && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              marginTop: '4px',
              color: '#9B9A94',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {/* AI 解释（展开时显示，打字机效果） */}
      {expanded && aiBullet && (
        <div
          style={{
            marginLeft: '18px',
            paddingLeft: '14px',
            borderLeft: '2px solid rgba(85,96,113,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {/* AI CLARIFICATION header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                fill="#556071"
              />
            </svg>
            <span
              style={{
                fontSize: '9px',
                fontWeight: '700',
                letterSpacing: '0.08em',
                color: '#556071',
                textTransform: 'uppercase',
              }}
            >
              AI Clarification
            </span>
            {/* Timestamp */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTimestampClick(aiBullet.timestamp_start) }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '9px',
                color: '#AFB3B0',
                fontWeight: '700',
                padding: 0,
                marginLeft: '4px',
              }}
            >
              {String(Math.floor(aiBullet.timestamp_start / 60)).padStart(2, '0')}:
              {String(Math.floor(aiBullet.timestamp_start % 60)).padStart(2, '0')}
            </button>
          </div>
          {/* 打字机正文 */}
          <p
            style={{
              fontSize: '14px',
              color: '#374151',
              lineHeight: '1.625',
              fontWeight: '400',
              margin: 0,
            }}
          >
            {displayed}
            {!done && <span style={{ opacity: 0.4 }}>▍</span>}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 替换 AI Notes 内容区**

找到 AI Notes 模式内容区（约 512-651 行，`{noteMode === 'ai' ? ...}`），**仅替换 passive notes bullets 那一段**。找到：

```tsx
{/* Passive notes bullets */}
{currentPageData?.passive_notes && currentPageData.passive_notes.bullets.length > 0 && (
  <div>
    <div className="mb-3">
      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
        AI NOTES
      </span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {currentPageData.passive_notes.bullets.map((bullet, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="flex items-start gap-2">
            <span style={{ color: '#AFB3B0', marginTop: '2px', flexShrink: 0 }}>•</span>
            <button
              onClick={() => handleTimestampClick(bullet.timestamp_start)}
              className="text-left cursor-pointer transition-all duration-150 hover:opacity-70"
              style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6', background: 'none', border: 'none', padding: 0 }}
            >
              {bullet.text}
            </button>
          </div>
          {bullet.ai_comment && (
            <div style={{ marginLeft: '18px', paddingLeft: '10px', borderLeft: '2px solid rgba(175,179,176,0.2)' }}>
              <p style={{ fontSize: '12px', color: C.secondary, lineHeight: '1.5' }}>
                {bullet.ai_comment}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

替换为：

```tsx
{/* PPT bullets + AI 解释（点击展开，打字机） */}
{currentPageData?.ppt_text && (
  <div>
    <div className="mb-3">
      <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.1em', color: '#777C79', textTransform: 'uppercase' }}>
        AI Notes
      </span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {currentPageData.ppt_text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line, i) => (
          <AiBulletRow
            key={i}
            pptLine={line}
            aiBullet={currentPageData.passive_notes?.bullets[i]}
            onTimestampClick={handleTimestampClick}
          />
        ))}
    </div>
  </div>
)}

{/* Fallback: 如果没有 ppt_text，退回显示纯 AI bullets */}
{!currentPageData?.ppt_text && currentPageData?.passive_notes && currentPageData.passive_notes.bullets.length > 0 && (
  <div>
    <div className="mb-3">
      <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.1em', color: '#777C79', textTransform: 'uppercase' }}>
        AI Notes
      </span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {currentPageData.passive_notes.bullets.map((bullet, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <span style={{ color: '#AFB3B0', marginTop: '2px', flexShrink: 0 }}>•</span>
          <button
            onClick={() => handleTimestampClick(bullet.timestamp_start)}
            className="text-left cursor-pointer transition-all duration-150 hover:opacity-70"
            style={{ fontSize: '14px', color: C.fg, lineHeight: '1.625', background: 'none', border: 'none', padding: 0 }}
          >
            {bullet.text}
          </button>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：无报错。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx frontend/src/hooks/useTypewriter.ts
git commit -m "feat: AI Notes panel — PPT bullets with typewriter AI clarification on click"
```

---

## Task 8: 端对端验证

- [ ] **Step 1: 启动开发服务器**

```bash
# 项目根目录
npm run dev
```

- [ ] **Step 2: 打开 mock session 验证**

浏览器访问 `http://localhost:5173/notes/mock-session-001`，逐项检查：

| 检查项 | 预期 |
|--------|------|
| 中间画布 | react-pdf 渲染 PDF，无浏览器原生工具栏 |
| 对齐置信度 badge | 第 3 页右上角**不再出现**「对齐置信度低」 |
| 可拖动分割线 | 拖动中/右面板边界，两侧宽度实时调整 |
| AI Notes pill | 左侧实心星形 icon + 「AI Notes」文字 + 激活时右侧小星 |
| AI Notes 内容 | 第 1 页显示 4 个 PPT bullet，点击任一 → 打字机展开 AI 解释 |
| 再次点击 | 收起 AI 解释 |
| 打字机光标 | 播放中显示 `▍`，播完消失 |

- [ ] **Step 3: 最终 commit**

```bash
git add -A
git commit -m "feat: notes page redesign — react-pdf, resizer, AI bullet typewriter"
```
