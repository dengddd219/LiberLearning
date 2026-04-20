# LivePage 重构与重建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 NotesPage 中可复用的组件、类型、工具函数提取为共享层（Phase 1），然后在此基础上重建 LivePage（Phase 2），实现「课中录音 + 实时字幕 + 课后自动切换为完整笔记视图」的完整流程，页面全程不跳转。

**架构：**
- Phase 1：从 NotesPage 提取 5 个渲染组件、共享类型、工具函数、IDB helpers，NotesPage 改为组合式（行为不变）
- Phase 2：LivePage 组合共享层 + 录音状态机 + WebSocket ASR + 底部字幕条 + 课后 NotesPanel
- LivePage 路由 `/live`，通过 URL 参数 `?new=1` 区分新建 vs 进入已有 live session

**技术栈：** React + TypeScript、WebSocket（MediaRecorder → 后端 → 阿里云 NLS）、FastAPI SSE（/api/live/explain）、IndexedDB（askDb）、react-pdf（PPT 渲染）

---

## 文件结构

### Phase 1 — 新建/修改文件

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `frontend/src/lib/notesTypes.ts` | 共享类型：AskMessage、PageChatMessage、Bullet、AlignedSegment、PageData、SessionData |
| 新建 | `frontend/src/lib/notesUtils.ts` | 共享工具：formatTime、stripBullet、renderMd、withApiBase、C 色板、CSS 注入 |
| 新建 | `frontend/src/lib/notesDb.ts` | 共享 IDB helpers：askKey、myNoteKey、loadMyNote、saveMyNote、loadPageChat、savePageChat、loadAskHistory、saveAskHistory |
| 新建 | `frontend/src/components/notes/RevealText.tsx` | 单词级 shimmer reveal 动画组件 |
| 新建 | `frontend/src/components/notes/LineByLineReveal.tsx` | 逐行 reveal 动画组件（含 LineRevealSpan） |
| 新建 | `frontend/src/components/notes/StreamingExpandText.tsx` | 流式扩写完成后的 shimmer 展示组件 |
| 新建 | `frontend/src/components/notes/InlineQA.tsx` | per-bullet 问答组件，含 IDB 持久化 |
| 新建 | `frontend/src/components/notes/AiBulletRow.tsx` | bullet 行组件，含 4 阶段展开动画 + InlineQA |
| 新建 | `frontend/src/components/notes/NotesPanel.tsx` | 右侧面板大组件：Tab bar + My Notes + AI Notes + Transcript + Bottom drawer |
| 修改 | `frontend/src/pages/NotesPage.tsx` | 改为组合式：删除已提取的局部定义，改用外部导入，JSX 右侧面板替换为 \<NotesPanel /\> |

### Phase 2 — 新建/修改文件

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `frontend/src/pages/LivePage.tsx` | 重建：录音状态机 + WebSocket + PPT 上传 + 字幕条 + NotesPanel 组合 |
| 新建 | `frontend/src/lib/api.ts`（修改） | 新增 `createLiveSession`（已有，确认签名） |
| 修改 | `backend/routers/live.py` | 确认 WebSocket /ws/live-asr + POST /api/live/explain 正确挂载 |

---

## Phase 1：提取共享层

---

### Task 1：提取共享类型 `notesTypes.ts`

**Files:**
- 新建：`frontend/src/lib/notesTypes.ts`
- 修改：`frontend/src/pages/NotesPage.tsx`（删除重复类型定义，改为从 notesTypes 导入）

- [x] **Step 1：创建 `frontend/src/lib/notesTypes.ts`**

```ts
// frontend/src/lib/notesTypes.ts

export interface AskMessage {
  role: 'user' | 'ai'
  content: string
  model: string
  timestamp: number
}

export interface PageChatMessage {
  role: 'user' | 'ai'
  content: string
  timestamp: number
}

export interface Bullet {
  ppt_text: string
  level: number
  ai_comment: string | null
  timestamp_start: number
  timestamp_end: number
}

export interface AlignedSegment {
  start: number
  end: number
  text: string
  similarity?: number
}

export interface PageData {
  page_num: number
  status?: string
  pdf_url: string
  pdf_page_num: number
  thumbnail_url?: string
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[]; error?: string } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
  aligned_segments?: AlignedSegment[]
}

export interface SessionData {
  session_id: string
  status: string
  ppt_filename: string
  audio_url: string
  total_duration: number
  pages: PageData[]
  progress?: { step: string; percent: number } | null
}
```

- [x] **Step 2：在 NotesPage.tsx 顶部导入替换**

在 `frontend/src/pages/NotesPage.tsx` 的 import 块末尾加入：
```ts
import type { AskMessage, PageChatMessage, Bullet, AlignedSegment, PageData, SessionData } from '../lib/notesTypes'
```

删除 NotesPage.tsx 中 lines 117–155 的重复类型定义（`interface AskMessage`、`interface PageChatMessage`、`interface Bullet`、`interface AlignedSegment`、`interface PageData`、`interface SessionData`）。

- [x] **Step 3：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 4：Commit**

```bash
git add frontend/src/lib/notesTypes.ts frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract shared note types to notesTypes.ts"
```

---

### Task 2：提取共享工具函数 `notesUtils.ts`

**Files:**
- 新建：`frontend/src/lib/notesUtils.ts`
- 修改：`frontend/src/pages/NotesPage.tsx`

- [x] **Step 1：创建 `frontend/src/lib/notesUtils.ts`**

```ts
// frontend/src/lib/notesUtils.ts
import React from 'react'

// ── 色板 ─────────────────────────────────────────────────────────────────────
export const FONT_SERIF = "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"

export const C = {
  bg: '#F7F7F2',
  sidebar: '#F2F2EC',
  fg: '#292929',
  secondary: '#72726E',
  muted: '#D0CFC5',
  dark: '#292929',
  white: '#FFFFFF',
  divider: '#E3E3DA',
}

// ── CSS 注入（AI shimmer 动画） ────────────────────────────────────────────────
const SWEEP_STYLE_ID = 'ai-sweep-animation'

export function injectNoteStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(SWEEP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SWEEP_STYLE_ID
  style.textContent = `
    @keyframes ai-shimmer-sweep {
      0% { background-position: 200% 50%; }
      100% { background-position: -100% 50%; }
    }
    @keyframes ellipsis {
      0%   { width: 0; }
      33%  { width: 0.5em; }
      66%  { width: 1em; }
      100% { width: 1.5em; }
    }
    .ai-bullet-reveal {
      color: transparent;
      background: linear-gradient(110deg, #333333 40%, #ffffff 50%, #333333 60%);
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: ai-shimmer-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .ai-bullet-placeholder {
      color: #999999;
      transition: opacity 0.3s ease;
    }
  `
  document.head.appendChild(style)
}

// ── URL 工具 ──────────────────────────────────────────────────────────────────
const ABSOLUTE_URL_RE = /^https?:\/\//i
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export function withApiBase(url?: string | null): string | null {
  if (!url) return null
  return ABSOLUTE_URL_RE.test(url) ? url : `${API_BASE}${url}`
}

// ── 格式化工具 ────────────────────────────────────────────────────────────────
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function stripBullet(text: string): string {
  return text.replace(/^[\s•\-–—*]+/, '')
}

// ── Markdown 渲染 ─────────────────────────────────────────────────────────────
export function renderMd(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return React.createElement(
        'p',
        { key: i, style: { fontWeight: 700, marginBottom: '4px', marginTop: i === 0 ? 0 : '10px' } },
        line.slice(3)
      )
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      const content = line.slice(2)
      return React.createElement(
        'p',
        { key: i, style: { margin: '2px 0', paddingLeft: '12px' } },
        React.createElement('span', { style: { marginRight: '6px', opacity: 0.5 } }, '•'),
        applyBold(content)
      )
    }
    if (line.trim() === '') {
      return React.createElement('br', { key: i })
    }
    return React.createElement('p', { key: i, style: { margin: '2px 0' } }, applyBold(line))
  })
}

function applyBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? React.createElement('strong', { key: i }, part.slice(2, -2))
      : part
  )
}
```

- [x] **Step 2：更新 NotesPage.tsx 导入**

在 NotesPage.tsx import 块末尾加入：
```ts
import { C, FONT_SERIF, injectNoteStyles, withApiBase, formatTime, stripBullet, renderMd } from '../lib/notesUtils'
```

删除 NotesPage.tsx 中以下内容（lines 17–46 的 SWEEP_STYLE_ID/CSS 注入块，lines 157–199 的 C/FONT_SERIF/withApiBase/formatTime/stripBullet 定义）。

在 NotesPage.tsx 组件函数体最顶部（`const { sessionId } = useParams` 之前）加入：
```ts
injectNoteStyles()
```

删除 NotesPage.tsx 中的 `renderMd` 函数定义（lines 360–398）。

- [x] **Step 3：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 4：Commit**

```bash
git add frontend/src/lib/notesUtils.ts frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract shared utils/styles to notesUtils.ts"
```

---

### Task 3：提取 IDB helpers `notesDb.ts`

**Files:**
- 新建：`frontend/src/lib/notesDb.ts`
- 修改：`frontend/src/pages/NotesPage.tsx`

- [x] **Step 1：创建 `frontend/src/lib/notesDb.ts`**

```ts
// frontend/src/lib/notesDb.ts
import { openAskDB, STORE_NAME, MY_NOTES_STORE, PAGE_CHAT_STORE } from './askDb'
import type { AskMessage, PageChatMessage } from './notesTypes'

export function askKey(sessionId: string, pageNum: number, bulletIndex: number) {
  return `${sessionId}:${pageNum}:${bulletIndex}`
}

export function myNoteKey(sessionId: string, pageNum: number) {
  return `${sessionId}:${pageNum}`
}

export async function loadMyNote(sessionId: string, pageNum: number): Promise<string> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readonly')
    const req = tx.objectStore(MY_NOTES_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.text ?? '')
    req.onerror = () => resolve('')
  })
}

export async function saveMyNote(sessionId: string, pageNum: number, text: string) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readwrite')
    tx.objectStore(MY_NOTES_STORE).put({ text }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function loadPageChat(sessionId: string, pageNum: number): Promise<PageChatMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readonly')
    const req = tx.objectStore(PAGE_CHAT_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

export async function savePageChat(sessionId: string, pageNum: number, messages: PageChatMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readwrite')
    tx.objectStore(PAGE_CHAT_STORE).put({ messages }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function loadAskHistory(sessionId: string, pageNum: number, bulletIndex: number): Promise<AskMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(askKey(sessionId, pageNum, bulletIndex))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

export async function saveAskHistory(sessionId: string, pageNum: number, bulletIndex: number, messages: AskMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ messages }, askKey(sessionId, pageNum, bulletIndex))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}
```

- [x] **Step 2：更新 NotesPage.tsx 导入**

在 NotesPage.tsx import 块末尾加入：
```ts
import {
  askKey, myNoteKey,
  loadMyNote, saveMyNote,
  loadPageChat, savePageChat,
  loadAskHistory, saveAskHistory,
} from '../lib/notesDb'
```

删除 NotesPage.tsx 中 lines 48–115 的 8 个 IDB helper 函数定义（`askKey`、`myNoteKey`、`loadMyNote`、`saveMyNote`、`loadPageChat`、`savePageChat`、`loadAskHistory`、`saveAskHistory`）。

- [x] **Step 3：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 4：Commit**

```bash
git add frontend/src/lib/notesDb.ts frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract IDB helpers to notesDb.ts"
```

---

### Task 4：提取 `RevealText` 和 `LineByLineReveal`

**Files:**
- 新建：`frontend/src/components/notes/RevealText.tsx`
- 新建：`frontend/src/components/notes/LineByLineReveal.tsx`
- 修改：`frontend/src/pages/NotesPage.tsx`

- [x] **Step 1：创建 `frontend/src/components/notes/RevealText.tsx`**

从 NotesPage.tsx lines 202–241 提取，完整内容：

```tsx
// frontend/src/components/notes/RevealText.tsx
import { useRef, useEffect } from 'react'

interface RevealTextProps {
  children: React.ReactNode
  revealed: boolean
  muted: boolean
  highlight: boolean
}

export default function RevealText({ children, revealed, muted, highlight }: RevealTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!revealed || !spanRef.current) return
    const el = spanRef.current
    el.classList.add('drop-in', 'shimmer-text')
    const timer = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
    }, 500)
    return () => clearTimeout(timer)
  }, [revealed])

  return (
    <span
      ref={spanRef}
      style={{
        color: !revealed ? 'transparent' : muted ? '#72726E' : highlight ? '#798C00' : '#292929',
        transition: 'color 0.3s',
      }}
    >
      {children}
    </span>
  )
}
```

- [x] **Step 2：创建 `frontend/src/components/notes/LineByLineReveal.tsx`**

从 NotesPage.tsx lines 244–357 提取（含 LineRevealSpan），完整内容：

```tsx
// frontend/src/components/notes/LineByLineReveal.tsx
import { useState, useEffect, useRef } from 'react'

interface LineRevealSpanProps {
  text: string
  revealed: boolean
}

function LineRevealSpan({ text, revealed }: LineRevealSpanProps) {
  const spanRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!revealed || !spanRef.current) return
    const el = spanRef.current
    el.classList.add('drop-in', 'shimmer-text')
    const timer = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
    }, 500)
    return () => clearTimeout(timer)
  }, [revealed])
  return (
    <span ref={spanRef} style={{ color: revealed ? '#292929' : 'transparent', display: 'block' }}>
      {text}
    </span>
  )
}

interface LineByLineRevealProps {
  text: string
  startReveal: boolean
  onDone: () => void
}

export default function LineByLineReveal({ text, startReveal, onDone }: LineByLineRevealProps) {
  const [revealedLines, setRevealedLines] = useState<number>(0)
  const measureRef = useRef<HTMLSpanElement>(null)
  const linesRef = useRef<string[]>([])

  useEffect(() => {
    if (!startReveal) return
    if (!measureRef.current) return

    // 计算视觉行
    const range = document.createRange()
    const textNode = measureRef.current.firstChild
    if (!textNode) return
    const rects: DOMRect[] = []
    for (let i = 0; i < text.length; i++) {
      range.setStart(textNode, i)
      range.setEnd(textNode, i + 1)
      const rect = range.getBoundingClientRect()
      if (rects.length === 0 || Math.abs(rect.top - rects[rects.length - 1].top) > 4) {
        rects.push(rect)
      }
    }
    // 按行高分割文本（简化：按换行符分割）
    const lines = text.split('\n').filter(Boolean)
    linesRef.current = lines

    let i = 0
    const reveal = () => {
      i++
      setRevealedLines(i)
      if (i < lines.length) {
        setTimeout(reveal, 120)
      } else {
        onDone()
      }
    }
    setTimeout(reveal, 0)
  }, [startReveal, text, onDone])

  const lines = linesRef.current.length > 0 ? linesRef.current : text.split('\n').filter(Boolean)

  return (
    <span style={{ display: 'block' }}>
      {/* 隐藏测量层 */}
      <span ref={measureRef} style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap' }}>
        {text}
      </span>
      {/* 可见层 */}
      {lines.map((line, idx) => (
        <LineRevealSpan key={idx} text={line} revealed={idx < revealedLines} />
      ))}
    </span>
  )
}
```

- [x] **Step 3：在 NotesPage.tsx 中替换导入**

在 NotesPage.tsx import 块末尾加入：
```ts
import RevealText from '../components/notes/RevealText'
import LineByLineReveal from '../components/notes/LineByLineReveal'
```

删除 NotesPage.tsx 中 lines 202–357 的 `RevealText`、`LineRevealSpan`、`LineByLineReveal` 三个组件定义。

- [x] **Step 4：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 5：Commit**

```bash
git add frontend/src/components/notes/RevealText.tsx frontend/src/components/notes/LineByLineReveal.tsx frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract RevealText and LineByLineReveal to components/notes/"
```

---

### Task 5：提取 `StreamingExpandText` 和 `InlineQA`

**Files:**
- 新建：`frontend/src/components/notes/StreamingExpandText.tsx`
- 新建：`frontend/src/components/notes/InlineQA.tsx`
- 修改：`frontend/src/pages/NotesPage.tsx`

- [x] **Step 1：创建 `frontend/src/components/notes/StreamingExpandText.tsx`**

从 NotesPage.tsx lines 401–426 提取：

```tsx
// frontend/src/components/notes/StreamingExpandText.tsx
import { useRef, useEffect } from 'react'
import { renderMd } from '../../lib/notesUtils'

interface StreamingExpandTextProps {
  text: string
}

export default function StreamingExpandText({ text }: StreamingExpandTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!spanRef.current) return
    const el = spanRef.current
    el.classList.add('drop-in', 'shimmer-text')
    const timer = setTimeout(() => {
      el.classList.remove('shimmer-text')
      el.classList.add('color-settle')
    }, 600)
    return () => clearTimeout(timer)
  }, [])

  return <span ref={spanRef}>{renderMd(text)}</span>
}
```

- [x] **Step 2：创建 `frontend/src/components/notes/InlineQA.tsx`**

从 NotesPage.tsx lines 429–603 提取，完整代码（注意依赖 notesTypes、notesDb、askBullet API）：

```tsx
// frontend/src/components/notes/InlineQA.tsx
import { useState, useEffect, useRef } from 'react'
import { askBullet } from '../../lib/api'
import { loadAskHistory, saveAskHistory } from '../../lib/notesDb'
import type { AskMessage } from '../../lib/notesTypes'
import { C } from '../../lib/notesUtils'

const MODELS = ['中转站', '通义千问', 'DeepSeek', '豆包'] as const

interface InlineQAProps {
  sessionId: string
  pageNum: number
  bulletIndex: number
  bulletText: string
  bulletAiComment: string
}

export default function InlineQA({ sessionId, pageNum, bulletIndex, bulletText, bulletAiComment }: InlineQAProps) {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>('中转站')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadAskHistory(sessionId, pageNum, bulletIndex).then(setMessages)
  }, [sessionId, pageNum, bulletIndex])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const handleSend = async () => {
    const q = input.trim()
    if (!q || streaming) return
    setInput('')
    const userMsg: AskMessage = { role: 'user', content: q, model, timestamp: Date.now() }
    const next = [...messages, userMsg]
    setMessages(next)
    setStreaming(true)
    setStreamingText('')

    let full = ''
    try {
      full = await askBullet(sessionId, pageNum, bulletIndex, bulletText, bulletAiComment, q, model, (chunk) => {
        full += chunk
        setStreamingText(full)
      })
    } finally {
      setStreaming(false)
      setStreamingText('')
      const aiMsg: AskMessage = { role: 'ai', content: full, model, timestamp: Date.now() }
      const done = [...next, aiMsg]
      setMessages(done)
      saveAskHistory(sessionId, pageNum, bulletIndex, done)
    }
  }

  return (
    <div style={{ marginTop: '8px', background: C.bg, borderRadius: '8px', padding: '12px', fontSize: '13px' }}>
      {/* 模型选择 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {MODELS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModel(m)}
            style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', cursor: 'pointer',
              border: `1px solid ${model === m ? '#798C00' : C.divider}`,
              background: model === m ? '#798C00' : 'transparent',
              color: model === m ? '#fff' : C.secondary,
              fontWeight: model === m ? 600 : 400,
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* 对话历史 */}
      <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              background: msg.role === 'user' ? C.fg : C.white,
              color: msg.role === 'user' ? C.white : C.fg,
              borderRadius: '8px',
              padding: '6px 10px',
              maxWidth: '85%',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.5',
            }}
          >
            {msg.content}
          </div>
        ))}
        {streaming && streamingText && (
          <div style={{ alignSelf: 'flex-start', background: C.white, color: C.fg, borderRadius: '8px', padding: '6px 10px', maxWidth: '85%', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
            {streamingText}<span style={{ opacity: 0.5 }}>▋</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="问一个问题…"
          rows={2}
          style={{ flex: 1, resize: 'none', border: `1px solid ${C.divider}`, borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontFamily: 'inherit', outline: 'none', background: C.white, color: C.fg }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{ background: '#798C00', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: streaming ? 'not-allowed' : 'pointer', opacity: streaming ? 0.5 : 1 }}
        >
          发送
        </button>
      </div>
    </div>
  )
}
```

- [x] **Step 3：在 NotesPage.tsx 中替换导入**

在 NotesPage.tsx import 块末尾加入：
```ts
import StreamingExpandText from '../components/notes/StreamingExpandText'
import InlineQA from '../components/notes/InlineQA'
```

删除 NotesPage.tsx 中 lines 401–603 的 `StreamingExpandText` 和 `InlineQA` 组件定义。

- [x] **Step 4：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 5：Commit**

```bash
git add frontend/src/components/notes/StreamingExpandText.tsx frontend/src/components/notes/InlineQA.tsx frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract StreamingExpandText and InlineQA to components/notes/"
```

---

### Task 6：提取 `AiBulletRow`

**Files:**
- 新建：`frontend/src/components/notes/AiBulletRow.tsx`
- 修改：`frontend/src/pages/NotesPage.tsx`

- [x] **Step 1：创建 `frontend/src/components/notes/AiBulletRow.tsx`**

从 NotesPage.tsx lines 606–847 提取，完整代码：

```tsx
// frontend/src/components/notes/AiBulletRow.tsx
import { useState, useEffect } from 'react'
import RevealText from './RevealText'
import LineByLineReveal from './LineByLineReveal'
import InlineQA from './InlineQA'
import { C, formatTime, stripBullet } from '../../lib/notesUtils'
import type { Bullet } from '../../lib/notesTypes'

interface AiBulletRowProps {
  bullet: Bullet
  expanded: boolean
  animationDone: boolean
  onToggle: () => void
  onAnimationDone: () => void
  onTimestampClick: (t: number) => void
  translationEnabled?: boolean
  translatedPptText?: string
  translatedAiComment?: string | null
  sessionId: string
  pageNum: number
  bulletIndex: number
}

export default function AiBulletRow({
  bullet, expanded, animationDone, onToggle, onAnimationDone, onTimestampClick,
  translationEnabled, translatedPptText, translatedAiComment,
  sessionId, pageNum, bulletIndex,
}: AiBulletRowProps) {
  const [hovered, setHovered] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set())
  const [pptExiting, setPptExiting] = useState(false)
  const [pptSwipedAway, setPptSwipedAway] = useState(false)
  const [startAiLineReveal, setStartAiLineReveal] = useState(false)

  // 重置动画（当切换页面后 expanded/animationDone 重置）
  useEffect(() => {
    if (!expanded) {
      setPptExiting(false)
      setPptSwipedAway(false)
      setRevealedSet(new Set())
      setStartAiLineReveal(false)
    }
  }, [expanded])

  // 4 阶段展开动画
  useEffect(() => {
    if (!expanded || animationDone) return
    setPptExiting(true)
    const t1 = setTimeout(() => {
      setPptSwipedAway(true)
      setRevealedSet(new Set([0]))
    }, 320)
    const t2 = setTimeout(() => setRevealedSet(new Set([0, 1])), 620)
    const t3 = setTimeout(() => setStartAiLineReveal(true), 870)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [expanded, animationDone])

  const displayPptText = translationEnabled && translatedPptText ? translatedPptText : bullet.ppt_text
  const displayAiComment = translationEnabled && translatedAiComment !== undefined ? translatedAiComment : bullet.ai_comment
  const hasAiComment = !!(displayAiComment && displayAiComment.trim())

  return (
    <div
      style={{
        borderRadius: '6px',
        background: hovered ? C.bg : 'transparent',
        transition: 'background 0.15s',
        padding: '4px 6px',
        marginLeft: `${bullet.level * 16}px`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 主行 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: hasAiComment ? 'pointer' : 'default' }} onClick={hasAiComment ? onToggle : undefined}>
        {/* 展开箭头 */}
        {hasAiComment && (
          <span style={{ marginTop: '3px', fontSize: '10px', color: C.muted, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>▶</span>
        )}
        {!hasAiComment && <span style={{ width: '14px', flexShrink: 0 }} />}

        {/* PPT 文字 */}
        <div style={{ flex: 1, fontSize: '13px', lineHeight: '1.6', color: C.fg }}>
          {expanded && !animationDone ? (
            pptSwipedAway ? (
              <RevealText revealed={revealedSet.has(0)} muted={false} highlight={false}>
                {stripBullet(displayPptText)}
              </RevealText>
            ) : (
              <span style={{ display: 'inline-block', animation: pptExiting ? 'slide-up 0.32s ease forwards' : 'none' }}>
                {stripBullet(displayPptText)}
              </span>
            )
          ) : (
            <span>{stripBullet(displayPptText)}</span>
          )}
        </div>

        {/* 时间戳 */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTimestampClick(bullet.timestamp_start) }}
          style={{ flexShrink: 0, fontSize: '11px', color: C.secondary, background: C.bg, border: 'none', borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {formatTime(bullet.timestamp_start)}
        </button>
      </div>

      {/* 展开区域：AI 解释 */}
      {expanded && hasAiComment && (
        <div style={{ marginTop: '6px', paddingLeft: '22px' }}>
          {/* AI 标签 */}
          {(animationDone || revealedSet.has(1)) && (
            <RevealText revealed={animationDone || revealedSet.has(1)} muted={true} highlight={false}>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: C.secondary, textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                AI Clarification ✦
              </span>
            </RevealText>
          )}

          {/* AI 正文 */}
          {animationDone ? (
            <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: C.fg, whiteSpace: 'pre-wrap' }}>
              {displayAiComment}
            </p>
          ) : (
            startAiLineReveal && (
              <LineByLineReveal
                text={displayAiComment ?? ''}
                startReveal={startAiLineReveal}
                onDone={onAnimationDone}
              />
            )
          )}

          {/* Ask 按钮 */}
          <button
            type="button"
            onClick={() => setAskOpen((v) => !v)}
            style={{ marginTop: '6px', fontSize: '11px', color: askOpen ? '#798C00' : C.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {askOpen ? '▾ 收起问答' : '▸ 问一下 AI'}
          </button>

          {/* InlineQA */}
          {askOpen && (
            <InlineQA
              sessionId={sessionId}
              pageNum={pageNum}
              bulletIndex={bulletIndex}
              bulletText={bullet.ppt_text}
              bulletAiComment={bullet.ai_comment ?? ''}
            />
          )}
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2：在 NotesPage.tsx 中替换导入**

在 NotesPage.tsx import 块末尾加入：
```ts
import AiBulletRow from '../components/notes/AiBulletRow'
```

删除 NotesPage.tsx 中 lines 606–847 的 `AiBulletRow` 组件定义。

- [x] **Step 3：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 4：Commit**

```bash
git add frontend/src/components/notes/AiBulletRow.tsx frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract AiBulletRow to components/notes/"
```

---

### Task 7：提取 `NotesPanel` 大组件

**Files:**
- 新建：`frontend/src/components/notes/NotesPanel.tsx`
- 修改：`frontend/src/pages/NotesPage.tsx`

NotesPanel 封装右侧面板 aside 全部内容（Tab bar + 三个 Tab 内容 + Bottom drawer）。

- [x] **Step 1：定义 NotesPanel 的 Props 接口**

在 `frontend/src/components/notes/NotesPanel.tsx` 的顶部写出完整 props 接口（注意：所有 state 和 handler 由 NotesPage 传入，NotesPanel 是纯渲染组件）：

```tsx
// frontend/src/components/notes/NotesPanel.tsx
import { useRef } from 'react'
import AiBulletRow from './AiBulletRow'
import StreamingExpandText from './StreamingExpandText'
import { C, formatTime, renderMd } from '../../lib/notesUtils'
import { generateMyNote, askBullet } from '../../lib/api'
import type { PageData, SessionData, AlignedSegment } from '../../lib/notesTypes'
import { useTranslation } from '../../context/TranslationContext'

export interface NotesPanelProps {
  // 数据
  sessionId: string
  currentPage: number
  pageData: PageData | null
  session: SessionData | null
  notesPanelWidth: number

  // Tab 状态
  noteMode: 'my' | 'ai' | 'transcript'
  onNoteModeChange: (m: 'my' | 'ai' | 'transcript') => void

  // 课中/课后模式
  isLive?: boolean              // true = 课中，AI 纪要 Tab 显示占位
  subtitleLines?: string[]      // 课中实时字幕（Transcript Tab 课中内容）
  wsStatus?: 'idle' | 'connecting' | 'live' | 'stopped'

  // My Notes
  getMyNoteText: (pageNum: number) => string
  onMyNoteChange: (pageNum: number, text: string) => void

  // AI 扩写
  myNoteExpandStates: Map<number, { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }>
  onExpandMyNote: (pageNum: number) => void

  // bullet 展开动画
  expandedBullets: Map<number, Set<number>>
  animatedBullets: Map<number, Set<number>>
  onBulletToggle: (pageNum: number, bulletIndex: number) => void
  onBulletAnimationDone: (pageNum: number, bulletIndex: number) => void

  // 时间戳/转录播放
  onTimestampClick: (seconds: number) => void
  onSegmentPlay: (seg: AlignedSegment, idx: number) => void
  playingSegIdx: number | null
  playProgress: number

  // 翻译
  translationEnabled?: boolean
  translatedTexts: Map<number, { bullets?: string[]; aiComments?: (string | null)[]; supplement?: string; aiExpansion?: string }>

  // 重试
  retrying: number | null
  onRetryPage: (pageNum: number) => void

  // Page Chat (drawer)
  pageChatMessages: Map<number, { role: 'user' | 'ai'; content: string; timestamp: number }[]>
  pageChatInput: string
  onPageChatInputChange: (v: string) => void
  pageChatStreaming: boolean
  pageChatStreamingText: string
  onPageChatSend: () => void
  drawerPhase: 'closed' | 'input' | 'full'
  onDrawerPhaseChange: (p: 'closed' | 'input' | 'full') => void
  drawerHeightPx: number | null
  onDrawerHeightChange: (h: number | null) => void
  drawerModel: string
  onDrawerModelChange: (m: string) => void
  drawerModelDDOpen: boolean
  onDrawerModelDDToggle: () => void

  // SSE 进度指示
  pagePhase?: 'upload' | 'processing' | 'ready'
  transcriptJustDone?: boolean
  aiNotesJustDone?: boolean

  // 批注（AI Notes 区顶部展示）
  annotationsForPage: (pageNum: number) => { id: string; text: string }[]

  // 工具函数（传入避免依赖耦合）
  getMyNoteExpandState: (pageNum: number) => { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }
}
```

- [x] **Step 2：实现 NotesPanel 组件体**

在 Props 接口之后，将 NotesPage.tsx lines 1781–2635 的右侧面板 JSX 复制进来，作为 NotesPanel 的 return 内容。

关键改动：
- 将 `<aside ... width={notesPanelWidth}>` 作为 NotesPanel 的根元素返回
- 所有原本在 NotesPage state 中的变量，改为从 props 取（如 `noteMode` → `props.noteMode`，`session` → `props.session` 等）
- `isLive` 为 true 时，AI 纪要 Tab 内容替换为：
```tsx
<div style={{ padding: '32px 24px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
  课程结束后自动生成 AI 纪要
</div>
```
- Transcript Tab 在 `isLive && wsStatus !== 'stopped'` 时，显示 `subtitleLines` 实时字幕列表，而不是 `aligned_segments`

最终 NotesPanel 是一个完整的 `<aside>` 元素，不含外层布局。

- [x] **Step 3：在 NotesPage.tsx 中使用 NotesPanel**

在 NotesPage.tsx import 块末尾加入：
```ts
import NotesPanel from '../components/notes/NotesPanel'
```

找到 NotesPage JSX 中 `{/* Right panel: Notes */}` 注释（约 line 1780），将整个 `<aside>...</aside>`（lines 1781–2635）替换为：

```tsx
<NotesPanel
  sessionId={activeSessionId ?? ''}
  currentPage={currentPage}
  pageData={currentPageData ?? null}
  session={session}
  notesPanelWidth={notesPanelWidth}
  noteMode={noteMode}
  onNoteModeChange={setNoteMode}
  getMyNoteText={getMyNoteText}
  onMyNoteChange={handleMyNoteChange}
  myNoteExpandStates={myNoteExpandStates}
  onExpandMyNote={handleExpandMyNote}
  expandedBullets={expandedBullets}
  animatedBullets={animatedBullets}
  onBulletToggle={(pg, bi) => {
    setExpandedBullets(prev => {
      const next = new Map(prev)
      const s = new Set(next.get(pg) ?? [])
      s.has(bi) ? s.delete(bi) : s.add(bi)
      next.set(pg, s)
      return next
    })
  }}
  onBulletAnimationDone={(pg, bi) => {
    setAnimatedBullets(prev => {
      const next = new Map(prev)
      const s = new Set(next.get(pg) ?? [])
      s.add(bi)
      next.set(pg, s)
      return next
    })
  }}
  onTimestampClick={handleTimestampClick}
  onSegmentPlay={handleSegmentPlay}
  playingSegIdx={playingSegIdx}
  playProgress={playProgress}
  translationEnabled={enabled}
  translatedTexts={translatedTexts}
  retrying={retrying}
  onRetryPage={handleRetryPage}
  pageChatMessages={pageChatMessages}
  pageChatInput={pageChatInput}
  onPageChatInputChange={setPageChatInput}
  pageChatStreaming={pageChatStreaming}
  pageChatStreamingText={pageChatStreamingText}
  onPageChatSend={handlePageChatSend}
  drawerPhase={drawerPhase}
  onDrawerPhaseChange={setDrawerPhase}
  drawerHeightPx={drawerHeightPx}
  onDrawerHeightChange={setDrawerHeightPx}
  drawerModel={drawerModel}
  onDrawerModelChange={setDrawerModel}
  drawerModelDDOpen={drawerModelDDOpen}
  onDrawerModelDDToggle={() => setDrawerModelDDOpen(v => !v)}
  pagePhase={pagePhase}
  transcriptJustDone={transcriptJustDone}
  aiNotesJustDone={aiNotesJustDone}
  annotationsForPage={annotationsForPage}
  getMyNoteExpandState={getMyNoteExpandState}
/>
```

- [x] **Step 4：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors。如有类型错误，对齐 props 签名。

- [ ] **Step 5：手动验证 NotesPage 功能完整**

启动前端（`cd frontend && npm run dev`），打开一个已有 session 的 `/notes/:id`，验证：
- My Notes Tab 可以输入，500ms 后保存
- AI Notes Tab bullet 展开动画正常
- Transcript Tab 时间戳点击可以跳转音频
- Bottom drawer 可以打开/关闭，Page Chat 可以发送

- [x] **Step 6：Commit**

```bash
git add frontend/src/components/notes/NotesPanel.tsx frontend/src/pages/NotesPage.tsx
git commit -m "refactor: extract NotesPanel component, NotesPage now composition-based"
```

---

## Phase 2：重建 LivePage

---

### Task 8：LivePage — 框架结构 + 录音状态机

**Files:**
- 修改：`frontend/src/pages/LivePage.tsx`

LivePage 整体结构与 NotesPage 一致（三栏布局），但中间列加了字幕条，录音控制条替代 PillToggle，右侧面板使用 `<NotesPanel isLive>` 并在课后切换为完整模式。

- [x] **Step 1：建立 LivePage 骨架（状态机 + 布局）**

用以下完整代码替换现有 LivePage.tsx 占位内容（注意：此步骤先不包含 WebSocket 逻辑，专注于状态机和布局骨架）：

```tsx
// frontend/src/pages/LivePage.tsx
import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import CanvasToolbar from '../components/CanvasToolbar'
import NotesPanel from '../components/notes/NotesPanel'
import { uploadPpt, createLiveSession, getSession, uploadFiles } from '../lib/api'
import { C, injectNoteStyles } from '../lib/notesUtils'
import { loadMyNote, saveMyNote, loadPageChat, savePageChat } from '../lib/notesDb'
import type { PageData, SessionData, AlignedSegment } from '../lib/notesTypes'
import type { PptPage } from '../types/session'

// 录音状态机
type WsStatus = 'idle' | 'connecting' | 'live' | 'paused' | 'stopped' | 'processing' | 'done'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export default function LivePage() {
  injectNoteStyles()

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { openTab } = useTabs()
  const { t, enabled: translationEnabled } = useTranslation()

  // ── 录音状态 ──────────────────────────────────────────────────────────────
  const [wsStatus, setWsStatus] = useState<WsStatus>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // ── 实时字幕 ──────────────────────────────────────────────────────────────
  const [subtitleLines, setSubtitleLines] = useState<string[]>([])
  const [transcriptByPage, setTranscriptByPage] = useState<Record<number, string[]>>({})
  const subtitleBottomRef = useRef<HTMLDivElement>(null)

  // ── PPT（课中上传，可选） ─────────────────────────────────────────────────
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [pptId, setPptId] = useState<string | null>(null)
  const [pptPages, setPptPages] = useState<PptPage[]>([])
  const [pptUploading, setPptUploading] = useState(false)

  // ── Session（课后处理完成后填充） ─────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [processingProgress, setProcessingProgress] = useState(0)

  // ── 布局状态 ──────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('transcript')
  const [navVisible, setNavVisible] = useState(true)
  const [notesPanelWidth, setNotesPanelWidth] = useState(460)
  const [activeTool, setActiveTool] = useState<'none' | 'highlight' | 'eraser' | 'text'>('none')
  const [highlightColor, setHighlightColor] = useState('#FFD700')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageInputValue, setPageInputValue] = useState('1')
  const [popoverOpen, setPopoverOpen] = useState(false)

  // ── 笔记面板 state（与 NotesPage 一致） ──────────────────────────────────
  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const myNoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [myNoteExpandStates, setMyNoteExpandStates] = useState<Map<number, { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }>>(new Map())
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [translatedTexts] = useState<Map<number, { bullets?: string[]; aiComments?: (string | null)[]; supplement?: string; aiExpansion?: string }>>(new Map())
  const [retrying, setRetrying] = useState<number | null>(null)
  const [pageChatMessages, setPageChatMessages] = useState<Map<number, { role: 'user' | 'ai'; content: string; timestamp: number }[]>>(new Map())
  const [pageChatInput, setPageChatInput] = useState('')
  const [pageChatStreaming, setPageChatStreaming] = useState(false)
  const [pageChatStreamingText, setPageChatStreamingText] = useState('')
  const [drawerPhase, setDrawerPhase] = useState<'closed' | 'input' | 'full'>('closed')
  const [drawerHeightPx, setDrawerHeightPx] = useState<number | null>(null)
  const [drawerModel, setDrawerModel] = useState('中转站')
  const [drawerModelDDOpen, setDrawerModelDDOpen] = useState(false)

  // ── 音频播放（课后） ──────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playingSegIdx, setPlayingSegIdx] = useState<number | null>(null)
  const [playProgress, setPlayProgress] = useState(0)
  const segTimeUpdateRef = useRef<((e: Event) => void) | null>(null)
  const segEndRef = useRef<number | null>(null)
  const segStartRef = useRef<number | null>(null)

  // ── 初始化：创建 live session ──────────────────────────────────────────────
  useEffect(() => {
    const isNew = searchParams.get('new') === '1'
    const existingId = searchParams.get('sessionId')
    if (existingId) {
      setSessionId(existingId)
    } else if (isNew) {
      createLiveSession().then((res) => {
        setSessionId(res.session_id)
        openTab({ sessionId: res.session_id, label: '直播课堂' })
      })
    }
  }, [])

  // ── 字幕自动滚动 ──────────────────────────────────────────────────────────
  useEffect(() => {
    subtitleBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitleLines])

  // ── My Notes 懒加载 ───────────────────────────────────────────────────────
  const liveSessionId = sessionId ?? `live-draft`
  useEffect(() => {
    if (myNoteTexts.has(currentPage)) return
    loadMyNote(liveSessionId, currentPage).then((text) => {
      setMyNoteTexts((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, text)
        return next
      })
    })
    loadPageChat(liveSessionId, currentPage).then((messages) => {
      setPageChatMessages((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, messages)
        return next
      })
    })
  }, [currentPage, liveSessionId])

  // ── 工具函数 ──────────────────────────────────────────────────────────────
  const getMyNoteText = useCallback((pageNum: number) => myNoteTexts.get(pageNum) ?? '', [myNoteTexts])

  const getMyNoteExpandState = useCallback(
    (pageNum: number) => myNoteExpandStates.get(pageNum) ?? { userNote: '', aiText: '', status: 'idle' as const },
    [myNoteExpandStates]
  )

  const handleMyNoteChange = useCallback(
    (pageNum: number, text: string) => {
      setMyNoteTexts((prev) => { const next = new Map(prev); next.set(pageNum, text); return next })
      if (myNoteSaveTimerRef.current) clearTimeout(myNoteSaveTimerRef.current)
      myNoteSaveTimerRef.current = setTimeout(() => {
        saveMyNote(liveSessionId, pageNum, text)
      }, 500)
    },
    [liveSessionId]
  )

  const handleTimestampClick = useCallback((seconds: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = seconds
    audioRef.current.play()
  }, [])

  const handleSegmentPlay = useCallback((seg: AlignedSegment, idx: number) => {
    const audio = audioRef.current
    if (!audio) return
    if (playingSegIdx === idx) {
      audio.pause()
      segEndRef.current = null
      segStartRef.current = null
      if (segTimeUpdateRef.current) {
        audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
        segTimeUpdateRef.current = null
      }
      setPlayingSegIdx(null)
      setPlayProgress(0)
      return
    }
    if (segTimeUpdateRef.current) {
      audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
      segTimeUpdateRef.current = null
    }
    segEndRef.current = seg.end
    segStartRef.current = seg.start
    setPlayingSegIdx(idx)
    setPlayProgress(0)
    audio.currentTime = seg.start
    audio.play()
    const onTimeUpdate = () => {
      const start = segStartRef.current!
      const end = segEndRef.current!
      const duration = end - start
      if (duration > 0) {
        setPlayProgress(Math.min((audio.currentTime - start) / duration, 1))
      }
      if (audio.currentTime >= end) {
        audio.pause()
        audio.removeEventListener('timeupdate', onTimeUpdate)
        segTimeUpdateRef.current = null
        setPlayingSegIdx(null)
        setPlayProgress(0)
      }
    }
    segTimeUpdateRef.current = onTimeUpdate
    audio.addEventListener('timeupdate', onTimeUpdate)
  }, [playingSegIdx])

  const handlePageChatSend = useCallback(async () => {
    // Page Chat 发送逻辑（与 NotesPage 一致）
    // 此处留空，Task 9 完成后补充
  }, [])

  const annotationsForPage = useCallback((_pageNum: number) => [], [])

  // ── 计算当前页数据 ────────────────────────────────────────────────────────
  const totalPages = session?.pages?.length ?? pptPages.length
  const currentPageData: PageData | null = session?.pages?.find((p) => p.page_num === currentPage) ?? null

  const isLiveMode = wsStatus !== 'done'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', marginTop: '40px', background: C.bg }}>
      {/* 主体区域 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* 左侧：slide nav */}
        {navVisible && (
          <aside style={{ width: 200, flexShrink: 0, background: C.sidebar, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: C.secondary }}>TOC</span>
              <button type="button" onClick={() => setNavVisible(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '16px' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }} onWheel={(e) => e.stopPropagation()}>
              {(pptPages.length > 0 ? pptPages : session?.pages ?? []).map((pg, idx) => {
                const pageNum = 'page_num' in pg ? (pg as PptPage).page_num : (pg as PageData).page_num
                const thumb = 'thumbnail_url' in pg ? pg.thumbnail_url : null
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      width: '100%', padding: '4px', borderRadius: '6px', border: 'none',
                      background: currentPage === pageNum ? '#798C0020' : 'transparent',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginBottom: '4px',
                    }}
                  >
                    {thumb ? (
                      <img src={thumb} alt={`Slide ${pageNum}`} style={{ width: '100%', borderRadius: '4px', border: currentPage === pageNum ? '2px solid #798C00' : '2px solid transparent' }} />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '16/9', background: C.muted, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: C.secondary }}>
                        {pageNum}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        {/* 中间：PPT 画布 + 字幕条 */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <CanvasToolbar
            navVisible={navVisible}
            onNavToggle={() => setNavVisible((v) => !v)}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onHighlightColorChange={setHighlightColor}
            translationEnabled={false}
            popoverOpen={popoverOpen}
            onPopoverToggle={() => setPopoverOpen((v) => !v)}
            targetLang="zh"
            onTargetLangChange={() => {}}
            onTranslate={() => {}}
            onShowOriginal={() => {}}
            onClosePopover={() => setPopoverOpen(false)}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            currentPage={currentPage}
            totalPages={totalPages || 1}
            pageInputValue={pageInputValue}
            onPageInputChange={setPageInputValue}
            onPageInputCommit={() => {
              const n = parseInt(pageInputValue, 10)
              if (!isNaN(n) && n >= 1 && n <= (totalPages || 1)) setCurrentPage(n)
            }}
            onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setCurrentPage((p) => Math.min(totalPages || 1, p + 1))}
            searchOpen={searchOpen}
            onSearchToggle={() => setSearchOpen((v) => !v)}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          {/* PPT 渲染区 */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
            {/* PPT 上传入口（无 PPT 时显示） */}
            {pptPages.length === 0 && !session && (
              <div style={{ textAlign: 'center', color: C.muted }}>
                <p style={{ fontSize: '13px', marginBottom: '12px' }}>可选：上传 PPT 同步显示幻灯片</p>
                <label style={{ cursor: 'pointer', background: '#798C00', color: '#fff', borderRadius: '9999px', padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}>
                  上传 PPT
                  <input type="file" accept=".ppt,.pptx,.pdf" style={{ display: 'none' }} onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setPptFile(file)
                    setPptUploading(true)
                    uploadPpt(file).then((res) => {
                      setPptId(res.ppt_id)
                      setPptPages(res.pages)
                    }).finally(() => setPptUploading(false))
                  }} />
                </label>
                {pptUploading && <p style={{ marginTop: '8px', fontSize: '12px' }}>上传中…</p>}
              </div>
            )}

            {/* 已有 PPT：渲染幻灯片 */}
            {(pptPages.length > 0 || session) && (() => {
              const pages = session?.pages ?? pptPages
              const pg = pages.find((p) => ('page_num' in p ? (p as PptPage | PageData).page_num === currentPage : false))
              const imgUrl = pg && 'pdf_url' in pg ? (pg as PageData | PptPage).pdf_url ?? (pg as PptPage).thumbnail_url : null
              return imgUrl ? (
                <img src={`${API_BASE}${imgUrl}`} alt={`Slide ${currentPage}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '16/9', maxWidth: '800px', background: C.muted, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.secondary, fontSize: '14px' }}>
                  第 {currentPage} 页
                </div>
              )
            })()}
          </div>

          {/* 字幕条（叠加在画布底部） */}
          {isLiveMode && (
            <div style={{
              height: '100px', flexShrink: 0, overflowY: 'auto',
              background: 'rgba(30,30,30,0.88)', margin: '0 12px 8px',
              borderRadius: '8px', padding: '8px 14px',
              fontSize: '13px', lineHeight: '1.6', color: '#E8E8E0',
            }}>
              {subtitleLines.length === 0 ? (
                <span style={{ opacity: 0.4 }}>开始录音后，字幕将在这里实时显示…</span>
              ) : (
                subtitleLines.map((line, i) => <p key={i} style={{ margin: '2px 0' }}>{line}</p>)
              )}
              <div ref={subtitleBottomRef} />
            </div>
          )}

          {/* 录音控制条 */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 20px', borderTop: `1px solid ${C.divider}`, background: C.white,
          }}>
            {/* 录音状态指示 */}
            <span style={{
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: wsStatus === 'live' ? '#798C00' : wsStatus === 'processing' ? '#F59E0B' : C.muted,
            }}>
              {wsStatus === 'idle' ? '未开始' : wsStatus === 'connecting' ? '连接中…' : wsStatus === 'live' ? '● 录音中' : wsStatus === 'paused' ? '已暂停' : wsStatus === 'stopped' ? '录音已停止' : wsStatus === 'processing' ? '处理中…' : '已完成'}
            </span>

            {/* 开始录音 */}
            {wsStatus === 'idle' && (
              <button type="button" onClick={() => { /* Task 9 实现 */ }}
                style={{ background: '#798C00', color: '#fff', border: 'none', borderRadius: '9999px', padding: '6px 18px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                开始录音
              </button>
            )}

            {/* 暂停 / 继续 */}
            {wsStatus === 'live' && (
              <button type="button" onClick={() => { /* Task 9 实现 */ }}
                style={{ background: C.bg, color: C.fg, border: `1px solid ${C.divider}`, borderRadius: '9999px', padding: '6px 18px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                暂停
              </button>
            )}
            {wsStatus === 'paused' && (
              <button type="button" onClick={() => { /* Task 9 实现 */ }}
                style={{ background: '#798C00', color: '#fff', border: 'none', borderRadius: '9999px', padding: '6px 18px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                继续录音
              </button>
            )}

            {/* 结束课堂 */}
            {(wsStatus === 'live' || wsStatus === 'paused') && (
              <button type="button" onClick={() => { /* Task 10 实现 */ }}
                style={{ background: '#EF4444', color: '#fff', border: 'none', borderRadius: '9999px', padding: '6px 18px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>
                结束课堂
              </button>
            )}

            {/* 课后处理进度 */}
            {wsStatus === 'processing' && (
              <div style={{ flex: 1, height: '4px', background: C.muted, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#798C00', width: `${processingProgress}%`, transition: 'width 0.5s' }} />
              </div>
            )}
          </div>
        </main>

        {/* Resizer */}
        <div
          style={{ width: '8px', flexShrink: 0, cursor: 'col-resize', background: C.divider, opacity: 0 }}
          onMouseDown={(e) => {
            const startX = e.clientX
            const startW = notesPanelWidth
            const onMove = (ev: MouseEvent) => setNotesPanelWidth(Math.max(300, startW - (ev.clientX - startX)))
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        />

        {/* 右侧：NotesPanel */}
        <NotesPanel
          sessionId={liveSessionId}
          currentPage={currentPage}
          pageData={currentPageData}
          session={session}
          notesPanelWidth={notesPanelWidth}
          noteMode={noteMode}
          onNoteModeChange={setNoteMode}
          isLive={isLiveMode}
          subtitleLines={subtitleLines}
          wsStatus={wsStatus}
          getMyNoteText={getMyNoteText}
          onMyNoteChange={handleMyNoteChange}
          myNoteExpandStates={myNoteExpandStates}
          onExpandMyNote={() => {}}
          expandedBullets={expandedBullets}
          animatedBullets={animatedBullets}
          onBulletToggle={(pg, bi) => {
            setExpandedBullets((prev) => {
              const next = new Map(prev)
              const s = new Set(next.get(pg) ?? [])
              s.has(bi) ? s.delete(bi) : s.add(bi)
              next.set(pg, s)
              return next
            })
          }}
          onBulletAnimationDone={(pg, bi) => {
            setAnimatedBullets((prev) => {
              const next = new Map(prev)
              const s = new Set(next.get(pg) ?? [])
              s.add(bi)
              next.set(pg, s)
              return next
            })
          }}
          onTimestampClick={handleTimestampClick}
          onSegmentPlay={handleSegmentPlay}
          playingSegIdx={playingSegIdx}
          playProgress={playProgress}
          translationEnabled={translationEnabled}
          translatedTexts={translatedTexts}
          retrying={retrying}
          onRetryPage={() => {}}
          pageChatMessages={pageChatMessages}
          pageChatInput={pageChatInput}
          onPageChatInputChange={setPageChatInput}
          pageChatStreaming={pageChatStreaming}
          pageChatStreamingText={pageChatStreamingText}
          onPageChatSend={handlePageChatSend}
          drawerPhase={drawerPhase}
          onDrawerPhaseChange={setDrawerPhase}
          drawerHeightPx={drawerHeightPx}
          onDrawerHeightChange={setDrawerHeightPx}
          drawerModel={drawerModel}
          onDrawerModelChange={setDrawerModel}
          drawerModelDDOpen={drawerModelDDOpen}
          onDrawerModelDDToggle={() => setDrawerModelDDOpen((v) => !v)}
          annotationsForPage={annotationsForPage}
          getMyNoteExpandState={getMyNoteExpandState}
        />
      </div>

      {/* 隐藏音频（课后播放用） */}
      {session?.audio_url && (
        <audio ref={audioRef} src={`${API_BASE}${session.audio_url}`} preload="metadata" style={{ display: 'none' }} />
      )}
    </div>
  )
}
```

- [x] **Step 2：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 3：Commit**

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: LivePage skeleton - state machine, layout, NotesPanel integration"
```

---

### Task 9：LivePage — WebSocket 录音 + 实时 ASR

**Files:**
- 修改：`frontend/src/pages/LivePage.tsx`

- [x] **Step 1：实现 `startRecording` 函数**

在 LivePage.tsx 的工具函数区域（`handleMyNoteChange` 之后、`return` 之前）加入：

```tsx
const startRecording = useCallback(async () => {
  setWsStatus('connecting')
  audioChunksRef.current = []
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const ws = new WebSocket(`${WS_BASE}/api/ws/live-asr`)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('live')
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
      }
      mr.start(250)
    }

    ws.onmessage = (e) => {
      const msg: { text: string; is_final: boolean; timestamp: number } = JSON.parse(e.data)
      if (msg.is_final) {
        setSubtitleLines((prev) => {
          const next = [...prev.filter((l) => l !== '…'), msg.text]
          return next.length > 50 ? next.slice(next.length - 50) : next
        })
        setTranscriptByPage((prev) => ({
          ...prev,
          [currentPage]: [...(prev[currentPage] ?? []), msg.text],
        }))
      } else {
        // 非 final：替换最后一行为实时预览
        setSubtitleLines((prev) => {
          const withoutLast = prev[prev.length - 1] === '…' ? prev.slice(0, -1) : prev
          return [...withoutLast, msg.text || '…']
        })
      }
    }

    ws.onerror = () => setWsStatus('stopped')
    ws.onclose = () => {
      if (wsStatus === 'live' || wsStatus === 'paused') setWsStatus('stopped')
    }
  } catch {
    setWsStatus('idle')
  }
}, [currentPage, wsStatus])
```

- [x] **Step 2：实现 `pauseRecording` 和 `resumeRecording` 函数**

```tsx
const pauseRecording = useCallback(() => {
  mediaRecorderRef.current?.pause()
  setWsStatus('paused')
}, [])

const resumeRecording = useCallback(() => {
  mediaRecorderRef.current?.resume()
  setWsStatus('live')
}, [])
```

- [x] **Step 3：在录音控制条按钮上绑定真实 handler**

找到 Task 8 中录音控制条里的 `onClick={() => { /* Task 9 实现 */ }}` 占位，替换为：

- 「开始录音」按钮：`onClick={startRecording}`
- 「暂停」按钮：`onClick={pauseRecording}`
- 「继续录音」按钮：`onClick={resumeRecording}`

- [x] **Step 4：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [x] **Step 5：Commit**

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: LivePage - WebSocket recording with real-time ASR subtitles"
```

---

### Task 10：LivePage — 结束课堂 + 课后处理 + 切换 done 模式

**Files:**
- 修改：`frontend/src/pages/LivePage.tsx`

- [x] **Step 1：实现 `stopRecording`（结束课堂）函数**

```tsx
const stopRecording = useCallback(async () => {
  // 停止录音
  mediaRecorderRef.current?.stop()
  mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop())
  wsRef.current?.close()
  setWsStatus('processing')

  // 合并音频 Blob
  const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
  const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })

  try {
    // 提交到 /api/process
    const result = await uploadFiles(pptFile ?? undefined, audioFile, 'zh', undefined, pptId ?? undefined)
    const newSessionId = result.session_id
    setSessionId(newSessionId)

    // 轮询 session 状态，直到 ready
    const poll = async () => {
      const data = await getSession(newSessionId) as SessionData
      if (data.status === 'ready' || data.status === 'partial_ready') {
        setSession(data)
        setWsStatus('done')
        setNoteMode('ai')
        // 切换到第一页
        if (data.pages.length > 0) setCurrentPage(data.pages[0].page_num)
      } else if (data.status === 'error') {
        setWsStatus('stopped')
      } else {
        // 更新进度条
        if (data.progress) setProcessingProgress(data.progress.percent)
        setTimeout(poll, 3000)
      }
    }
    poll()
  } catch {
    setWsStatus('stopped')
  }
}, [pptFile, pptId])
```

- [x] **Step 2：在「结束课堂」按钮上绑定 handler**

找到 Task 8 中「结束课堂」按钮的 `onClick={() => { /* Task 10 实现 */ }}`，替换为：`onClick={stopRecording}`

- [x] **Step 3：课后模式隐藏字幕条（wsStatus === 'done' 时）**

字幕条的渲染条件已经是 `{isLiveMode && ...}`，`isLiveMode = wsStatus !== 'done'`，因此 done 后字幕条自动隐藏。无需额外修改。

- [x] **Step 4：课后音频播放 — 确认 audio 元素条件渲染**

Task 8 骨架中音频元素是 `{session?.audio_url && <audio ref={audioRef} ... />}`，session 在 done 后填充，自动生效。

- [x] **Step 5：确认编译无报错**

```bash
cd frontend && npx tsc --noEmit
```

预期：0 errors

- [ ] **Step 6：Commit**

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: LivePage - end class, submit to /api/process, poll until done, switch to notes mode"
```

---

### Task 11：手动端到端验证

**无代码修改，纯验证步骤。**

- [ ] **Step 1：启动前后端**

```bash
# 终端 1
cd backend && python -m uvicorn main:app --reload --port 8000

# 终端 2
cd frontend && npm run dev
```

- [ ] **Step 2：验证 Phase 1 — NotesPage 无回归**

打开 `http://localhost:5173/notes/<已有sessionId>`，验证：
1. My Notes Tab — 输入文字，刷新页面后内容还在（IDB 持久化）
2. AI Notes Tab — 展开一个 bullet，4 阶段动画正常播放
3. InlineQA — 点「问一下 AI」，输入问题，收到流式回复
4. Transcript Tab — 点击时间戳，音频跳转播放
5. Bottom drawer — 打开 Page Chat，发送消息，收到回复

- [ ] **Step 3：验证 LivePage 课中流程**

打开 `http://localhost:5173/live?new=1`：
1. 点「上传 PPT」上传一个 PPTX，PPT 缩略图出现在左侧导航
2. 点「开始录音」，浏览器弹权限提示 → 允许
3. 状态变为「● 录音中」
4. 约 5 秒后，字幕条出现 mock 字幕文字
5. 左侧点击第 2 页，currentPage 切换，字幕继续累积到第 2 页
6. 点「暂停」，状态变为「已暂停」；点「继续录音」，状态恢复
7. My Notes Tab — 在第 1 页输入一段笔记，切换到第 2 页再回来，内容还在

- [ ] **Step 4：验证 LivePage 课后流程**

1. 点「结束课堂」，状态变为「处理中…」，进度条出现
2. 等待处理完成（约 1–3 分钟，取决于录音时长）
3. 状态切换为「已完成」，字幕条消失
4. 右侧自动切换到 AI Notes Tab
5. AI Notes Tab — bullet 列表显示，展开一个 bullet，动画正常
6. Transcript Tab — 显示完整流水转录，点击句子跳转音频
7. My Notes Tab — 课中输入的笔记还在，可以点星号 AI 扩写

- [ ] **Step 5：如有 bug，修复后提交**

```bash
git add -p
git commit -m "fix: LivePage end-to-end issues found in manual testing"
```

---

## 自查：Spec 覆盖率检查

| 需求 | 对应 Task |
|------|-----------|
| 全文转录 + 分秒点击跳转音频 | Task 7（NotesPanel Transcript Tab）+ Task 10（音频元素） |
| 实时字幕（课中） | Task 9（WebSocket ASR） + Task 8（字幕条 UI） |
| 即时提纲（课后 AI 纪要） | Task 10（done 后 NotesPanel 切换为完整模式）|
| 录音开始/暂停/继续/结束 | Task 8（控制条 UI）+ Task 9（start/pause/resume）+ Task 10（stop）|
| 课中 AI 纪要占位 | Task 7（NotesPanel isLive 分支）|
| 课后与 NotesPage 等效功能 | Task 7（NotesPanel 复用）|
| PPT 上传（课中可选） | Task 8（页面内上传区）|
| 无 PPT 模式 | Task 8（无 PPT 时显示上传入口 + 字幕大屏）|
| 页面不跳转（原地 processing → done）| Task 10（轮询 + setWsStatus('done')）|
| NotesPage 无回归 | Task 7（NotesPanel 组合后验证）|
