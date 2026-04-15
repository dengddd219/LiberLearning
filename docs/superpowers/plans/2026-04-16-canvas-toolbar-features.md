# Canvas Toolbar Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CanvasToolbar 的各工具实现真实功能：文本高亮标注（选中文字涂色，localStorage 持久化）、文本贴纸、PDF+笔记双向搜索、PDF 画布缩放、页码跳转滚动。

**Architecture:** 新功能状态和逻辑全部抽到独立 hooks 和组件中，NotesPage 只做组装（传 props）。react-pdf TextLayer 已渲染为普通 DOM span，高亮通过 `Range.surroundContents(<mark>)` 实现，持久化存储 XPath+offset 序列化数据到 localStorage。搜索结果作为浮层展示，分笔记侧和 PDF 侧两栏。

**Tech Stack:** React + TypeScript，react-pdf（已集成），localStorage，CSS position:absolute overlay，DOM Range API

---

## 文件地图

| 文件 | 动作 | 职责 |
|------|------|------|
| `frontend/src/hooks/useHighlights.ts` | 新建 | 高亮记录的 CRUD + localStorage 持久化 |
| `frontend/src/hooks/useTextAnnotations.ts` | 新建 | 文本贴纸的 CRUD + localStorage 持久化 |
| `frontend/src/hooks/useSearch.ts` | 新建 | 搜索逻辑：过滤 session 笔记 + 扫描 PDF TextLayer DOM |
| `frontend/src/components/HighlightLayer.tsx` | 新建 | 在 react-pdf TextLayer 上恢复和应用 `<mark>` 高亮 |
| `frontend/src/components/TextAnnotationLayer.tsx` | 新建 | 渲染绝对定位的可拖拽文本贴纸 |
| `frontend/src/components/SearchDropdown.tsx` | 新建 | 搜索结果浮层（笔记侧 + PDF侧，分区显示，点击跳转） |
| `frontend/src/components/CanvasToolbar.tsx` | 修改 | 接收搜索结果 prop，传给 SearchDropdown |
| `frontend/src/pages/NotesPage.tsx` | 修改 | 实例化新 hooks，调整 PDF 渲染区支持缩放+叠加层，传 props |

---

### Task 1: useHighlights hook

**Files:**
- Create: `frontend/src/hooks/useHighlights.ts`

**数据结构：**
```ts
interface HighlightRecord {
  id: string           // nanoid
  sessionId: string
  pageNum: number
  color: string        // e.g. '#FAFF00'
  // XPath from pdf page root to the text node
  startXPath: string
  startOffset: number
  endXPath: string
  endOffset: number
  text: string         // 被高亮的文字（仅用于 debug，不用于恢复）
}
```

- [ ] **Step 1: 新建 `frontend/src/hooks/useHighlights.ts`**

```ts
import { useState, useCallback } from 'react'

export interface HighlightRecord {
  id: string
  sessionId: string
  pageNum: number
  color: string
  startXPath: string
  startOffset: number
  endXPath: string
  endOffset: number
  text: string
}

const STORAGE_KEY = 'liberstudy:highlights'

function load(): HighlightRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function save(records: HighlightRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function useHighlights(sessionId: string) {
  const [highlights, setHighlights] = useState<HighlightRecord[]>(() =>
    load().filter((r) => r.sessionId === sessionId)
  )

  const addHighlight = useCallback((record: Omit<HighlightRecord, 'id'>) => {
    const id = crypto.randomUUID()
    const next = [...load(), { ...record, id }]
    save(next)
    setHighlights(next.filter((r) => r.sessionId === sessionId))
    return id
  }, [sessionId])

  const removeHighlight = useCallback((id: string) => {
    const next = load().filter((r) => r.id !== id)
    save(next)
    setHighlights(next.filter((r) => r.sessionId === sessionId))
  }, [sessionId])

  const highlightsForPage = useCallback((pageNum: number) =>
    highlights.filter((r) => r.pageNum === pageNum),
  [highlights])

  return { highlights, addHighlight, removeHighlight, highlightsForPage }
}
```

- [ ] **Step 2: 确认文件保存，无 TypeScript 报错**

在 `frontend/` 目录运行：
```bash
npx tsc --noEmit
```
Expected: 0 errors（新文件独立，无外部依赖）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useHighlights.ts
git commit -m "feat: add useHighlights hook with localStorage persistence"
```

---

### Task 2: XPath 工具函数（高亮恢复所需）

**Files:**
- Create: `frontend/src/lib/xpath.ts`

- [ ] **Step 1: 新建 `frontend/src/lib/xpath.ts`**

```ts
/** 从 root 到 node 生成 XPath 字符串（仅处理文本节点和元素节点） */
export function getXPath(node: Node, root: Node): string {
  const parts: string[] = []
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.TEXT_NODE) {
      // 找出是父元素的第几个文本节点（1-based）
      const parent = current.parentNode!
      let idx = 0
      for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) idx++
        if (child === current) break
      }
      parts.unshift(`text()[${idx}]`)
      current = parent
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element
      const tag = el.tagName.toLowerCase()
      // 找出是同名兄弟中的第几个（1-based）
      let idx = 1
      let sibling = el.previousElementSibling
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) idx++
        sibling = sibling.previousElementSibling
      }
      parts.unshift(`${tag}[${idx}]`)
      current = el.parentNode
    } else {
      break
    }
  }
  return parts.join('/')
}

/** 根据 XPath 从 root 查找节点 */
export function resolveXPath(xpath: string, root: Node): Node | null {
  const parts = xpath.split('/')
  let current: Node | null = root
  for (const part of parts) {
    if (!current) return null
    const textMatch = part.match(/^text\(\)\[(\d+)\]$/)
    const elemMatch = part.match(/^([a-z]+)\[(\d+)\]$/)
    if (textMatch) {
      const idx = parseInt(textMatch[1])
      let count = 0
      let found: Node | null = null
      for (const child of Array.from(current.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          count++
          if (count === idx) { found = child; break }
        }
      }
      current = found
    } else if (elemMatch) {
      const [, tag, idxStr] = elemMatch
      const idx = parseInt(idxStr)
      let count = 0
      let found: Node | null = null
      for (const child of Array.from(current.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === tag) {
          count++
          if (count === idx) { found = child; break }
        }
      }
      current = found
    }
  }
  return current
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/xpath.ts
git commit -m "feat: add XPath serialization/resolution utilities for highlight restore"
```

---

### Task 3: HighlightLayer 组件

**Files:**
- Create: `frontend/src/components/HighlightLayer.tsx`

此组件放在 PDF `<Page>` 外层的包裹 `div` 内（绝对定位，pointer-events:none 时不影响文本选择）。它做两件事：
1. **恢复**：页面渲染完成后，把 localStorage 里该页的高亮通过 `Range + surroundContents` 重新施加到 TextLayer DOM
2. **监听**：荧光笔工具激活时，监听 mouseup，读取 `window.getSelection()`，若有选中范围则创建高亮记录

**Files:**
- Create: `frontend/src/components/HighlightLayer.tsx`

- [ ] **Step 1: 新建 `frontend/src/components/HighlightLayer.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { type HighlightRecord } from '../hooks/useHighlights'
import { getXPath, resolveXPath } from '../lib/xpath'

interface HighlightLayerProps {
  /** react-pdf Page 的外层容器 ref（TextLayer 在其内部） */
  pageContainerRef: React.RefObject<HTMLDivElement | null>
  /** 当前显示的页码（切换时触发重新应用） */
  pageNum: number
  /** 该页的高亮记录 */
  highlights: HighlightRecord[]
  /** 荧光笔工具是否激活 */
  highlightToolActive: boolean
  /** 橡皮擦工具是否激活 */
  eraserToolActive: boolean
  /** 当前选中颜色 */
  highlightColor: string
  onAdd: (record: Omit<HighlightRecord, 'id'>) => void
  onRemove: (id: string) => void
}

/** 把 <mark> 施加到 range，返回 mark 元素 */
function applyMarkToRange(range: Range, color: string, highlightId: string): HTMLElement | null {
  try {
    const mark = document.createElement('mark')
    mark.style.backgroundColor = color
    mark.style.color = 'inherit'
    mark.style.borderRadius = '2px'
    mark.dataset.highlightId = highlightId
    range.surroundContents(mark)
    return mark
  } catch {
    // surroundContents 在 range 跨越多个元素边界时会失败，忽略
    return null
  }
}

/** 从 TextLayer 容器里清除所有 <mark> */
function clearMarks(container: HTMLElement) {
  const marks = Array.from(container.querySelectorAll('mark[data-highlight-id]'))
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

export default function HighlightLayer({
  pageContainerRef,
  pageNum,
  highlights,
  highlightToolActive,
  eraserToolActive,
  highlightColor,
  onAdd,
  onRemove,
}: HighlightLayerProps) {
  const appliedPageRef = useRef<number>(-1)

  // 页面渲染后恢复高亮（等 TextLayer 出现）
  useEffect(() => {
    const container = pageContainerRef.current
    if (!container) return

    // TextLayer 可能是异步渲染的，poll 直到出现
    let attempts = 0
    const tryApply = () => {
      const textLayer = container.querySelector('.react-pdf__Page__textContent')
      if (!textLayer) {
        if (attempts++ < 20) setTimeout(tryApply, 100)
        return
      }
      clearMarks(textLayer as HTMLElement)
      highlights.forEach((rec) => {
        const startNode = resolveXPath(rec.startXPath, textLayer)
        const endNode = resolveXPath(rec.endXPath, textLayer)
        if (!startNode || !endNode) return
        try {
          const range = document.createRange()
          range.setStart(startNode, rec.startOffset)
          range.setEnd(endNode, rec.endOffset)
          applyMarkToRange(range, rec.color, rec.id)
        } catch {
          // range 无效，跳过
        }
      })
      appliedPageRef.current = pageNum
    }
    // 每次 pageNum 变化或 highlights 变化时重新施加
    tryApply()
  }, [pageNum, highlights, pageContainerRef])

  // 荧光笔工具激活时监听 mouseup
  useEffect(() => {
    if (!highlightToolActive) return
    const container = pageContainerRef.current
    if (!container) return

    const handleMouseUp = (e: MouseEvent) => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const textLayer = container.querySelector('.react-pdf__Page__textContent')
      if (!textLayer || !textLayer.contains(range.commonAncestorContainer)) return

      const startXPath = getXPath(range.startContainer, textLayer)
      const endXPath = getXPath(range.endContainer, textLayer)

      onAdd({
        sessionId: '', // 由调用方填入
        pageNum,
        color: highlightColor,
        startXPath,
        startOffset: range.startOffset,
        endXPath,
        endOffset: range.endOffset,
        text: range.toString(),
      })
      sel.removeAllRanges()
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [highlightToolActive, pageNum, highlightColor, onAdd, pageContainerRef])

  // 橡皮擦工具激活时，点击 <mark> 删除
  useEffect(() => {
    if (!eraserToolActive) return
    const container = pageContainerRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const mark = target.closest('mark[data-highlight-id]') as HTMLElement | null
      if (!mark) return
      const id = mark.dataset.highlightId
      if (id) onRemove(id)
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [eraserToolActive, onRemove, pageContainerRef])

  return null // 无自身渲染，纯逻辑组件
}
```

- [ ] **Step 2: 检查 TypeScript**

```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HighlightLayer.tsx
git commit -m "feat: add HighlightLayer component for text selection highlighting"
```

---

### Task 4: 接入 NotesPage（高亮功能）

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: 在 NotesPage 中实例化 useHighlights，添加 pageContainerRef**

在 NotesPage 的 state 区域（约 L416 附近）添加：

```tsx
import { useHighlights } from '../hooks/useHighlights'
import HighlightLayer from '../components/HighlightLayer'

// 在 NotesPage 组件内，已有 state 下方添加：
const pageContainerRef = useRef<HTMLDivElement | null>(null)
const { addHighlight, removeHighlight, highlightsForPage } = useHighlights(sessionId ?? '')
```

- [ ] **Step 2: 给 PDF 页面外层 div 加 ref，并挂载 HighlightLayer**

找到 NotesPage.tsx 约 L777 的 `<div className="relative rounded-lg overflow-hidden">` 块，改为：

```tsx
<div
  ref={pageContainerRef}
  className="relative rounded-lg overflow-hidden"
  style={{
    background: C.white,
    boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
  }}
>
  {/* PDF 渲染（不变） */}
  {pdfUrl ? ( ... ) : ( ... )}
  
  {/* 高亮层 */}
  <HighlightLayer
    pageContainerRef={pageContainerRef}
    pageNum={currentPage}
    highlights={highlightsForPage(currentPage)}
    highlightToolActive={activeTool === 'highlight'}
    eraserToolActive={activeTool === 'eraser'}
    highlightColor={highlightColor}
    onAdd={(rec) => addHighlight({ ...rec, sessionId: sessionId ?? '' })}
    onRemove={removeHighlight}
  />
  
  {/* Play button（不变） */}
  {/* Slide label（不变） */}
</div>
```

- [ ] **Step 3: 检查 TypeScript 并目测功能**

```bash
cd frontend && npx tsc --noEmit
```

启动开发服务器，打开一个 session 的 NotesPage，选中荧光笔工具，在 PDF TextLayer 上选中文字，确认出现黄色高亮。切换页面再切回来，高亮依然存在。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: wire HighlightLayer into NotesPage PDF canvas"
```

---

### Task 5: useTextAnnotations hook + TextAnnotationLayer 组件

**Files:**
- Create: `frontend/src/hooks/useTextAnnotations.ts`
- Create: `frontend/src/components/TextAnnotationLayer.tsx`

- [ ] **Step 1: 新建 `frontend/src/hooks/useTextAnnotations.ts`**

```ts
import { useState, useCallback } from 'react'

export interface TextAnnotation {
  id: string
  sessionId: string
  pageNum: number
  x: number   // 相对于页面容器的百分比 0-100
  y: number
  text: string
}

const STORAGE_KEY = 'liberstudy:text-annotations'

function load(): TextAnnotation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
function save(records: TextAnnotation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function useTextAnnotations(sessionId: string) {
  const [annotations, setAnnotations] = useState<TextAnnotation[]>(() =>
    load().filter((a) => a.sessionId === sessionId)
  )

  const addAnnotation = useCallback((pageNum: number, x: number, y: number) => {
    const id = crypto.randomUUID()
    const record: TextAnnotation = { id, sessionId, pageNum, x, y, text: '' }
    const next = [...load(), record]
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
    return id
  }, [sessionId])

  const updateAnnotation = useCallback((id: string, text: string) => {
    const next = load().map((a) => a.id === id ? { ...a, text } : a)
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
  }, [sessionId])

  const removeAnnotation = useCallback((id: string) => {
    const next = load().filter((a) => a.id !== id)
    save(next)
    setAnnotations(next.filter((a) => a.sessionId === sessionId))
  }, [sessionId])

  const annotationsForPage = useCallback((pageNum: number) =>
    annotations.filter((a) => a.pageNum === pageNum),
  [annotations])

  return { annotations, addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage }
}
```

- [ ] **Step 2: 新建 `frontend/src/components/TextAnnotationLayer.tsx`**

```tsx
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
```

- [ ] **Step 3: 在 NotesPage 接入**

在 NotesPage 的 import 区和 state 区（L416 附近）添加：

```tsx
import { useTextAnnotations } from '../hooks/useTextAnnotations'
import TextAnnotationLayer from '../components/TextAnnotationLayer'

// state 区
const { addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage } = useTextAnnotations(sessionId ?? '')
```

在 PDF 页面容器内（HighlightLayer 下方）添加：

```tsx
<TextAnnotationLayer
  annotations={annotationsForPage(currentPage)}
  textToolActive={activeTool === 'text'}
  onPlaceAnnotation={(x, y) => addAnnotation(currentPage, x, y)}
  onUpdate={updateAnnotation}
  onRemove={removeAnnotation}
/>
```

同时，该容器 div 需要有 `position: relative`（已有 `className="relative"`），确认即可。

- [ ] **Step 4: 检查 TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTextAnnotations.ts frontend/src/components/TextAnnotationLayer.tsx frontend/src/pages/NotesPage.tsx
git commit -m "feat: add text annotation sticker tool with localStorage persistence"
```

---

### Task 6: PDF 画布缩放（只缩放 PDF，超出时横向滚动）

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`（约 L767-L832 Canvas area 区域）

当前 `canvasWidth` 是根据容器宽度自动计算的（ResizeObserver）。缩放逻辑：`effectiveWidth = canvasWidth * zoomLevel / 100`，当 effectiveWidth > 容器宽度时出现横向滚动条。

- [ ] **Step 1: 修改 Canvas area div 的 overflow 和 PDF 宽度**

找到约 L768 的 Canvas area div：

```tsx
// 原来
<div
  ref={canvasAreaRef}
  className="flex-1 flex items-center justify-center overflow-hidden"
  style={{ background: 'rgba(232,231,226,0.6)' }}
  onWheel={handleWheel}
>
```

改为：

```tsx
<div
  ref={canvasAreaRef}
  className="flex-1 flex items-start justify-center"
  style={{
    background: 'rgba(232,231,226,0.6)',
    overflowX: zoomLevel > 100 ? 'auto' : 'hidden',
    overflowY: 'hidden',
  }}
  onWheel={handleWheel}
>
```

- [ ] **Step 2: 修改传给 react-pdf Page 的 width**

找到约 L799 的 `<Page>` 组件：

```tsx
// 原来
<Page
  pageNumber={currentPageData.pdf_page_num}
  width={canvasWidth}
  renderTextLayer={true}
  renderAnnotationLayer={false}
/>
```

改为：

```tsx
<Page
  pageNumber={currentPageData.pdf_page_num}
  width={Math.round(canvasWidth * zoomLevel / 100)}
  renderTextLayer={true}
  renderAnnotationLayer={false}
/>
```

- [ ] **Step 3: 适应宽度按钮已是 `() => onZoomChange(100)`，确认 CanvasToolbar 里已正确实现（已有，无需改动）**

- [ ] **Step 4: 验证**

启动开发服务器，打开 NotesPage，点击 `+` 按钮放大到 150%，确认 PDF 变大、出现横向滚动条，点击适应宽度恢复。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: implement zoom scaling for PDF canvas with overflow-x scroll"
```

---

### Task 7: 页码导航（输入框跳转 = 滚动到该页）

**当前情况：** NotesPage 是单页显示模式（每次只渲染 currentPage 对应的一张 PDF 页），切换靠 `setCurrentPage`。所以"跳转到第N页"就是 `setCurrentPage(N)`，已经实现了。

只需要确认：工具栏的 `onPageInputCommit`、`onPrevPage`、`onNextPage` 都已正确连接（检查 L754-L760 区域）。

- [ ] **Step 1: 确认 NotesPage 中 CanvasToolbar 的页码 props 已完整连接**

读取 NotesPage.tsx L750-L765，确认：
- `pageInputValue` = `String(currentPage)` (由 useEffect 同步)
- `onPageInputCommit` 中 `setCurrentPage(n)` 已调用
- `onPrevPage` / `onNextPage` 调用了 `setCurrentPage`

如果已完整，此 Task 无需代码变更。

左侧缩略图点击 `setCurrentPage(page.page_num)` 同步更新（已有）。

- [ ] **Step 2: Commit（仅文档确认，无代码）**

```bash
# 如果有任何修复：
git add frontend/src/pages/NotesPage.tsx
git commit -m "fix: ensure page navigation toolbar props are wired correctly"
```

---

### Task 8: useSearch hook

**Files:**
- Create: `frontend/src/hooks/useSearch.ts`

搜索逻辑：给定 query，返回：
- `noteResults`: 匹配到 bullet ppt_text 或 ai_comment 的结果列表（含 pageNum）
- `pdfResults`: 匹配到 PDF TextLayer DOM 中的文本的结果列表（含 pageNum、snippet）

PDF 侧搜索只能扫描**当前已渲染**的 TextLayer（用户当前看的那一页），无法扫描未渲染的页面。对于未渲染的页，用 session pages 的 `ppt_text` 字段作为兜底。

```ts
export interface SearchResult {
  pageNum: number
  type: 'note' | 'pdf'
  snippet: string  // 高亮匹配词的上下文（最多60字）
  field: string    // 'ppt_text' | 'ai_comment' | 'pdf_text'
}
```

- [ ] **Step 1: 新建 `frontend/src/hooks/useSearch.ts`**

```ts
import { useMemo } from 'react'

export interface SearchResult {
  pageNum: number
  type: 'note' | 'pdf'
  snippet: string
  field: string
}

interface PageData {
  page_num: number
  ppt_text: string
  passive_notes: { bullets: { ppt_text: string; ai_comment: string | null }[] } | null
}

function extractSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 60)
  const start = Math.max(0, idx - 20)
  const end = Math.min(text.length, idx + query.length + 40)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function useSearch(query: string, pages: PageData[]) {
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()

    const out: SearchResult[] = []

    pages.forEach((page) => {
      // 搜笔记：ppt_text（来自 ppt_text 字段）
      if (page.ppt_text?.toLowerCase().includes(q)) {
        out.push({
          pageNum: page.page_num,
          type: 'pdf',
          snippet: extractSnippet(page.ppt_text, query),
          field: 'ppt_text',
        })
      }

      // 搜笔记：bullet ppt_text + ai_comment
      page.passive_notes?.bullets.forEach((b) => {
        if (b.ppt_text?.toLowerCase().includes(q)) {
          out.push({
            pageNum: page.page_num,
            type: 'note',
            snippet: extractSnippet(b.ppt_text, query),
            field: 'ppt_text',
          })
        }
        if (b.ai_comment?.toLowerCase().includes(q)) {
          out.push({
            pageNum: page.page_num,
            type: 'note',
            snippet: extractSnippet(b.ai_comment!, query),
            field: 'ai_comment',
          })
        }
      })
    })

    // 去重（同一页同一 type 只保留第一个）
    const seen = new Set<string>()
    return out.filter((r) => {
      const key = `${r.pageNum}:${r.type}:${r.field}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [query, pages])

  const noteResults = useMemo(() => results.filter((r) => r.type === 'note'), [results])
  const pdfResults = useMemo(() => results.filter((r) => r.type === 'pdf'), [results])

  return { noteResults, pdfResults, hasResults: results.length > 0 }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useSearch.ts
git commit -m "feat: add useSearch hook for notes and PDF text search"
```

---

### Task 9: SearchDropdown 组件

**Files:**
- Create: `frontend/src/components/SearchDropdown.tsx`

- [ ] **Step 1: 新建 `frontend/src/components/SearchDropdown.tsx`**

```tsx
import { type SearchResult } from '../hooks/useSearch'

interface SearchDropdownProps {
  noteResults: SearchResult[]
  pdfResults: SearchResult[]
  query: string
  onJumpToPage: (pageNum: number) => void
}

function highlightMatch(text: string, query: string) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#FAFF00', borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function SearchDropdown({
  noteResults,
  pdfResults,
  query,
  onJumpToPage,
}: SearchDropdownProps) {
  const isEmpty = noteResults.length === 0 && pdfResults.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        width: '360px',
        background: '#FAFAF8',
        border: '1px solid rgba(175,179,176,0.3)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 60,
        overflow: 'hidden',
        fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        maxHeight: '480px',
        overflowY: 'auto',
      }}
    >
      {isEmpty && (
        <div style={{ padding: '16px', fontSize: '13px', color: '#9B9A94', textAlign: 'center' }}>
          没有找到"{query}"
        </div>
      )}

      {/* PDF 侧结果 */}
      {pdfResults.length > 0 && (
        <section>
          <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 600, color: '#9B9A94', letterSpacing: '0.08em' }}>
            幻灯片文本 {pdfResults.length} 条
          </div>
          {pdfResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToPage(r.pageNum)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderTop: '1px solid rgba(175,179,176,0.15)',
              }}
              className="hover:bg-black/5"
            >
              <div style={{ fontSize: '11px', color: '#9B9A94', marginBottom: '2px' }}>
                第 {r.pageNum} 页 · 幻灯片
              </div>
              <div style={{ fontSize: '13px', color: '#1A1916', lineHeight: 1.5 }}>
                {highlightMatch(r.snippet, query)}
              </div>
            </button>
          ))}
        </section>
      )}

      {/* 笔记侧结果 */}
      {noteResults.length > 0 && (
        <section style={{ borderTop: pdfResults.length > 0 ? '1px solid rgba(175,179,176,0.3)' : undefined }}>
          <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 600, color: '#9B9A94', letterSpacing: '0.08em' }}>
            笔记 {noteResults.length} 条
          </div>
          {noteResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToPage(r.pageNum)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderTop: '1px solid rgba(175,179,176,0.15)',
              }}
              className="hover:bg-black/5"
            >
              <div style={{ fontSize: '11px', color: '#9B9A94', marginBottom: '2px' }}>
                第 {r.pageNum} 页 · {r.field === 'ai_comment' ? 'AI 注释' : '笔记要点'}
              </div>
              <div style={{ fontSize: '13px', color: '#1A1916', lineHeight: 1.5 }}>
                {highlightMatch(r.snippet, query)}
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SearchDropdown.tsx
git commit -m "feat: add SearchDropdown component with note/PDF split results"
```

---

### Task 10: 接入搜索到 CanvasToolbar + NotesPage

**Files:**
- Modify: `frontend/src/components/CanvasToolbar.tsx`
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: 更新 CanvasToolbar props 接口，接收搜索结果**

在 `frontend/src/components/CanvasToolbar.tsx` 的 `CanvasToolbarProps` 接口（约 L69）添加：

```ts
noteResults: import('../hooks/useSearch').SearchResult[]
pdfResults: import('../hooks/useSearch').SearchResult[]
onJumpToPage: (pageNum: number) => void
```

并在组件参数解构中添加这三个参数。

- [ ] **Step 2: 在 CanvasToolbar 的搜索区域（约 L336）挂载 SearchDropdown**

在搜索区域的 `<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>` 改为：

```tsx
import SearchDropdown from './SearchDropdown'

// 搜索区域 div 添加 position: relative
<div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}>
  {searchOpen && (
    <input ... />
  )}
  <ToolBtn title="搜索" active={searchOpen} onClick={onSearchToggle}>
    ...
  </ToolBtn>
  {searchOpen && searchQuery.trim() && (
    <SearchDropdown
      noteResults={noteResults}
      pdfResults={pdfResults}
      query={searchQuery}
      onJumpToPage={onJumpToPage}
    />
  )}
</div>
```

- [ ] **Step 3: 在 NotesPage 中实例化 useSearch 并传给 CanvasToolbar**

在 NotesPage import 区添加：

```tsx
import { useSearch } from '../hooks/useSearch'
```

在 NotesPage state 区（L416 附近）添加：

```tsx
const { noteResults, pdfResults } = useSearch(searchQuery, session?.pages ?? [])
```

在 `<CanvasToolbar>` 的 props 中添加：

```tsx
noteResults={noteResults}
pdfResults={pdfResults}
onJumpToPage={(pageNum) => { setCurrentPage(pageNum); setSearchOpen(false); setSearchQuery('') }}
```

- [ ] **Step 4: 检查 TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: 验证搜索功能**

启动开发服务器，打开 NotesPage，点击搜索图标，输入笔记中存在的关键词，确认：
- 出现浮层，分「幻灯片文本」和「笔记」两区
- 点击结果跳转到对应页
- Esc 关闭搜索框，浮层消失

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CanvasToolbar.tsx frontend/src/pages/NotesPage.tsx
git commit -m "feat: wire search results into CanvasToolbar with SearchDropdown"
```

---

## Self-Review

**Spec coverage 检查：**
- ✅ 目录按钮控制左侧面板 — 已有，无需改动（确认）
- ✅ 荧光笔 + 颜色下拉 — Task 1-4
- ✅ 橡皮擦 — Task 3 (HighlightLayer eraserToolActive)
- ✅ 文本工具 — Task 5
- ✅ 翻译 — 已有，无需改动
- ✅ 缩放 - + 适应宽度 — Task 6
- ✅ 页码输入框 + 上/下页 — Task 7
- ✅ 搜索（笔记+PDF双侧，分区显示） — Task 8-10
- ✅ NotesPage 不再塞新逻辑：新逻辑全在 hooks/ 和 components/ 中

**Placeholder 扫描：** 无 TBD/TODO

**Type consistency 检查：**
- `HighlightRecord` 在 useHighlights.ts 定义，HighlightLayer.tsx 通过 import 引用 ✅
- `TextAnnotation` 在 useTextAnnotations.ts 定义，TextAnnotationLayer.tsx 通过 import 引用 ✅
- `SearchResult` 在 useSearch.ts 定义，SearchDropdown.tsx 通过 import 引用 ✅
- CanvasToolbar `noteResults`/`pdfResults` 类型通过 import() 动态引用，Task 10 需要改为顶层 import ✅（在实现时注意改为顶层 import）
