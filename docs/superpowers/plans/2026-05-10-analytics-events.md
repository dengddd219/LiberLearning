# Analytics Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## 总览

### 我们想验证的核心问题

> **AI 笔记有没有被用户真正消费？消费了的用户，会不会回来第二次？**

LiberStudy 的价值主张是"录完课，AI 帮你整理好笔记"。但这个价值只有在用户真的看了笔记、觉得有用之后才能成立。如果用户生成了笔记但从来不看，说明产品流程断了——不是 AI 质量问题，而是体验设计问题。

### 核心漏斗

```
上传录音 + PPT（upload_started）
        ↓
上传成功，流水线启动（upload_completed）
        ↓
AI 笔记生成完成（pipeline_completed）
        ↓
用户有效查看笔记，停留 > 60s（ai_notes_consumed）
        ↓
用户对笔记质量表态（ai_notes_rated 点赞/点踩）
        ↓
用户隔天/隔周回来复习（ai_notes_revisited）
        ↓
用户下次再来录音（recording_started，session_index >= 2）
```

### 每个事件对应的决策

| 事件 | 观察什么 | 触发什么决策 |
|------|---------|------------|
| `upload_started` → `upload_completed` 转化率 | 上传流程有没有卡人 | 转化率 < 70% → 优化上传 UX |
| `pipeline_completed` → `ai_notes_consumed` 转化率 | 笔记生成后有没有人看 | 转化率 < 40% → 问题在生成时机或入口可发现性 |
| `ai_notes_consumed` 停留时长分布 | 看了多久 | 中位数 < 90s → 笔记内容质量或排版有问题 |
| `ai_notes_rated` 点赞/点踩比 | 用户主观觉得有没有用 | 点踩率 > 30% → 定位是哪类内容（session_notes / detailed_note / passive_notes）质量差 |
| `ai_notes_revisited` 的 `hours_since_generated` | 用户把笔记当当场工具还是复习工具 | 集中在 < 1h → 当场工具；集中在 > 24h → 复习工具；两者都有 → 分群运营 |
| `recording_started` 的 `session_index >= 2` 比率 | 有多少用户回来第二次 | 这是北极星指标，所有其他决策都服务于提升这个数字 |

### 本 plan 的范围

覆盖 **NotesPage（课后上传）模块** + **LivePage 录音事件属性补充**。LivePage 的 `notes_generated` 和 `detailed_note_clicked` 属性补充不在本 plan 内，需单独处理。

---

**Goal:** 在 NotesPage（课后上传）模块实现 6 个核心埋点事件，支撑"AI 笔记消费深度驱动复用"假设的验证。

**Architecture:** 所有埋点通过已有的 `capture()` 函数（PostHog）上报。`session_index` 用 localStorage 持久化追踪用户第几次使用。点赞/点踩做成可复用的 `FeedbackButtons` 组件，供多处 AI 生成内容复用。

**Tech Stack:** React, TypeScript, PostHog (`frontend/src/lib/analytics.ts` 已有 `capture()`)

---

## 文件地图

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/lib/sessionIndex.ts` | 新建 | 读写 localStorage，追踪用户第几次使用 |
| `frontend/src/components/FeedbackButtons.tsx` | 新建 | 可复用点赞/点踩组件，触发 `ai_notes_rated` |
| `frontend/src/components/NewClassModal.tsx` | 修改 | 加 `upload_started`、`upload_completed` |
| `frontend/src/pages/NotesPage.tsx` | 修改 | 加 `pipeline_completed`、`ai_notes_consumed`、`ai_notes_revisited` |

---

## Task 1: session_index 工具函数

**Files:**
- Create: `frontend/src/lib/sessionIndex.ts`

- [ ] **Step 1: 新建文件，写两个函数**

```typescript
// frontend/src/lib/sessionIndex.ts
const KEY = 'liberstudy:session_count'

export function getSessionIndex(): number {
  return parseInt(localStorage.getItem(KEY) ?? '0', 10)
}

export function incrementSessionIndex(): number {
  const next = getSessionIndex() + 1
  localStorage.setItem(KEY, String(next))
  return next
}
```

- [ ] **Step 2: 手动验证**

在浏览器 console 执行：
```js
import('/src/lib/sessionIndex.ts').then(m => {
  console.log(m.getSessionIndex())   // 0
  console.log(m.incrementSessionIndex()) // 1
  console.log(m.getSessionIndex())   // 1
})
```
预期：依次输出 0、1、1。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/sessionIndex.ts
git commit -m "feat(analytics): add session_index tracker"
```

---

## Task 2: FeedbackButtons 组件

**Files:**
- Create: `frontend/src/components/FeedbackButtons.tsx`

- [ ] **Step 1: 新建组件文件**

```typescript
// frontend/src/components/FeedbackButtons.tsx
import { useState } from 'react'
import { capture } from '../lib/analytics'
import { getSessionIndex } from '../lib/sessionIndex'

type ContentType = 'session_notes' | 'detailed_note' | 'my_note_expand' | 'passive_notes'

interface FeedbackButtonsProps {
  contentType: ContentType
  pageNum?: number | null
  sessionId?: string | null
}

export default function FeedbackButtons({ contentType, pageNum, sessionId }: FeedbackButtonsProps) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null)

  function handleRate(value: 'up' | 'down') {
    if (rating === value) return
    setRating(value)
    capture('ai_notes_rated', {
      content_type: contentType,
      rating: value,
      session_index: getSessionIndex(),
      page_num: pageNum ?? null,
      session_id: sessionId ?? null,
    })
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => handleRate('up')}
        title="有帮助"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 4px',
          borderRadius: 4,
          fontSize: 14,
          opacity: rating === 'down' ? 0.3 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => handleRate('down')}
        title="没帮助"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 4px',
          borderRadius: 4,
          fontSize: 14,
          opacity: rating === 'up' ? 0.3 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        👎
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/FeedbackButtons.tsx
git commit -m "feat(analytics): add reusable FeedbackButtons component"
```

---

## Task 3: NewClassModal 埋点

**Files:**
- Modify: `frontend/src/components/NewClassModal.tsx`

注意：`import { capture }` 和 `modalOpenTimeRef` 已在之前的会话中加入，执行前先检查文件顶部是否已有这两行，避免重复添加。

- [ ] **Step 1: 检查文件顶部是否已有 capture import**

```bash
head -10 frontend/src/components/NewClassModal.tsx
```

如果已有 `import { capture } from '../lib/analytics'`，跳过 Step 2。

- [ ] **Step 2: 如果没有，在 import 区加入**

在 `import type { PptPage }` 那行之前加：
```typescript
import { capture } from '../lib/analytics'
```

- [ ] **Step 3: 检查 modalOpenTimeRef 是否已有**

```bash
grep -n "modalOpenTimeRef" frontend/src/components/NewClassModal.tsx
```

如果已有，跳过 Step 4。

- [ ] **Step 4: 如果没有，在 pptUploadReqIdRef 那行之前加**

```typescript
const modalOpenTimeRef = useRef(Date.now())
```

- [ ] **Step 5: 检查 upload_started 是否已有**

```bash
grep -n "upload_started" frontend/src/components/NewClassModal.tsx
```

如果已有，跳过 Step 6。

- [ ] **Step 6: 在 handleSubmit 里 `if (onUploadSuccess)` 之前加 upload_started**

找到这段：
```typescript
  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    if (onUploadSuccess) {
```

改为：
```typescript
  const handleSubmit = useCallback(async () => {
    if (!audioFile) return
    capture('upload_started', {
      has_ppt: !!pptFile,
      audio_size_mb: +(audioFile.size / 1024 / 1024).toFixed(2),
    })
    if (onUploadSuccess) {
```

- [ ] **Step 7: 检查 upload_completed 是否已有**

```bash
grep -n "upload_completed" frontend/src/components/NewClassModal.tsx
```

如果已有，跳过 Step 8。

- [ ] **Step 8: 在 uploadFiles.then 里加 upload_completed**

找到这段：
```typescript
          uploadFiles(undefined, audioFile, 'en', undefined, ensuredPptId)
            .then(result => onUploadSuccess(result.session_id, ensuredPptPages, localPdfUrl ?? undefined))
```

改为：
```typescript
          uploadFiles(undefined, audioFile, 'en', undefined, ensuredPptId)
            .then(result => {
              capture('upload_completed', {
                has_ppt: !!pptFile,
                slide_count: ensuredPptPages.length,
                time_to_submit_sec: Math.round((Date.now() - modalOpenTimeRef.current) / 1000),
              })
              onUploadSuccess(result.session_id, ensuredPptPages, localPdfUrl ?? undefined)
            })
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/NewClassModal.tsx
git commit -m "feat(analytics): add upload_started and upload_completed events"
```

---

## Task 4: NotesPage 埋点 — pipeline_completed 和 ai_notes_consumed

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: 检查 capture import 是否已有**

```bash
grep -n "capture" frontend/src/pages/NotesPage.tsx | head -5
```

如果已有 `import { capture }` 跳过 Step 2。

- [ ] **Step 2: 如果没有，加 import**

在文件顶部 import 区末尾加：
```typescript
import { capture } from '../lib/analytics'
```

- [ ] **Step 3: 加 sessionIndex import**

在 `import { capture }` 下方加：
```typescript
import { getSessionIndex } from '../lib/sessionIndex'
```

- [ ] **Step 4: 加 pipeline_completed 埋点**

找到 `all_done` SSE 事件处理：
```typescript
    if (event.event === 'all_done') {
      setPagePhase('ready')
      setLocalPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
      setAiNotesJustDone(true)
      setTimeout(() => setAiNotesJustDone(false), 1500)
    }
```

改为：
```typescript
    if (event.event === 'all_done') {
      setPagePhase('ready')
      setLocalPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
      setAiNotesJustDone(true)
      setTimeout(() => setAiNotesJustDone(false), 1500)
      capture('pipeline_completed', {
        session_index: getSessionIndex(),
        slide_count: pptPageCount,
      })
    }
```

- [ ] **Step 5: 加 ai_notes_consumed 埋点**

在 `NotesPage` 组件内，`const [retrying` 那行附近，加两个 ref：

```typescript
  const aiNotesConsumedRef = useRef(false)
  const aiNotesReadyTimeRef = useRef<number | null>(null)
```

- [ ] **Step 6: 加 useEffect 监听 ready 态，启动 60 秒计时**

在现有 useEffect 区块末尾（`session?.pages.length` 那个 effect 之后）加：

```typescript
  useEffect(() => {
    if (pagePhase !== 'ready' || aiNotesConsumedRef.current) return
    aiNotesReadyTimeRef.current = Date.now()
    const timer = window.setTimeout(() => {
      if (aiNotesConsumedRef.current) return
      aiNotesConsumedRef.current = true
      capture('ai_notes_consumed', {
        session_index: getSessionIndex(),
        delay_from_ready_sec: Math.round((Date.now() - (aiNotesReadyTimeRef.current ?? Date.now())) / 1000),
      })
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [pagePhase])
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(analytics): add pipeline_completed and ai_notes_consumed events"
```

---

## Task 5: NotesPage 埋点 — ai_notes_revisited

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

`ai_notes_revisited` 的逻辑：用户打开一个已经是 `ready` 状态的 session（不是刚处理完的），说明是回来复习。判断依据：`pagePhase` 初始值就是 `ready`（不经过 `processing`）。

- [ ] **Step 1: 加 revisited 埋点**

找到这段 useEffect（加载已有 session 的逻辑）：
```typescript
  useEffect(() => {
    if (!sessionId || sessionId === 'new') return
    getSession(sessionId)
      .then((data) => {
        setSession(data as SessionData)
        if ((data as SessionData).pages?.length) {
          setPptPageCount((data as SessionData).pages.length)
        }
        openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
        setLoading(false)
        if ((data as SessionData).status === 'processing') {
          setPagePhase('processing')
          setProcessingSessionId(sessionId)
        }
      })
```

改为：
```typescript
  useEffect(() => {
    if (!sessionId || sessionId === 'new') return
    getSession(sessionId)
      .then((data) => {
        setSession(data as SessionData)
        if ((data as SessionData).pages?.length) {
          setPptPageCount((data as SessionData).pages.length)
        }
        openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
        setLoading(false)
        if ((data as SessionData).status === 'processing') {
          setPagePhase('processing')
          setProcessingSessionId(sessionId)
        } else if ((data as SessionData).status === 'ready' || (data as SessionData).status === 'partial_ready') {
          capture('ai_notes_revisited', {
            session_index: getSessionIndex(),
            session_id: sessionId,
          })
        }
      })
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(analytics): add ai_notes_revisited event"
```

---

## Task 6: 把 FeedbackButtons 放到 NotesPage AI Notes 区域

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`
- Modify: `frontend/src/components/notes/NotesPanel.tsx`

先找到 NotesPanel 里 AI Notes tab 的渲染位置，再决定插入点。

- [ ] **Step 1: 找到 NotesPanel 里 AI Notes 内容的渲染位置**

```bash
grep -n "passive_notes\|ai.*notes\|AiNotes\|PassiveNotes" frontend/src/components/notes/NotesPanel.tsx | head -20
```

- [ ] **Step 2: 在 NotesPanel.tsx 顶部加 FeedbackButtons import**

```typescript
import FeedbackButtons from '../FeedbackButtons'
```

- [ ] **Step 3: 在 AI Notes 内容区底部加 FeedbackButtons**

找到 AI Notes tab 内容渲染的末尾（passive_notes bullets 渲染完之后），加：

```tsx
<div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(175,179,176,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
  <span style={{ fontSize: 11, color: '#AFB3B0' }}>这份笔记有帮助吗？</span>
  <FeedbackButtons
    contentType="session_notes"
    pageNum={currentPage}
    sessionId={sessionId}
  />
</div>
```

- [ ] **Step 4: 确认 NotesPanel 的 props 里有 sessionId 和 currentPage**

```bash
grep -n "sessionId\|currentPage" frontend/src/components/notes/NotesPanel.tsx | head -10
```

如果没有，需要从 NotesPage 传入。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/notes/NotesPanel.tsx frontend/src/pages/NotesPage.tsx
git commit -m "feat(analytics): add FeedbackButtons to AI Notes panel"
```

---

## Task 7: recording_started / recording_ended 补充 session_index 属性

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

注意：这是 LivePage 的改动，范围很小，只补属性，不加新事件。

- [ ] **Step 1: 加 sessionIndex import**

在 LivePage.tsx 顶部 import 区加：
```typescript
import { getSessionIndex, incrementSessionIndex } from '../lib/sessionIndex'
```

- [ ] **Step 2: 在 recording_started 触发时补属性并递增**

找到：
```typescript
        capture('recording_started', { has_ppt: !!pptId })
```

改为：
```typescript
        const sessionIdx = incrementSessionIndex()
        capture('recording_started', { has_ppt: !!pptId, session_index: sessionIdx })
```

- [ ] **Step 3: 在 recording_ended 触发时补属性**

找到：
```typescript
    capture('recording_ended', { duration_seconds: Math.round((Date.now() - recordingStartTimeRef.current) / 1000) })
```

改为：
```typescript
    capture('recording_ended', {
      duration_seconds: Math.round((Date.now() - recordingStartTimeRef.current) / 1000),
      has_ppt: !!pptId,
      session_index: getSessionIndex(),
      my_notes_page_count: Array.from(myNoteTexts.values()).filter(t => t.trim()).length,
    })
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LivePage.tsx frontend/src/lib/sessionIndex.ts
git commit -m "feat(analytics): add session_index to recording events"
```

---

## Self-Review

**Spec coverage 检查：**

| 设计文档事件 | 对应 Task |
|------------|----------|
| `recording_started` 补属性 | Task 7 ✅ |
| `recording_ended` 补属性 | Task 7 ✅ |
| `notes_generated`（LivePage） | ⚠️ 未包含 — LivePage 的 handleGenerateNotes 里需要加，但本 plan 范围是 NotesPage 模块，LivePage 单独处理 |
| `ai_notes_consumed` | Task 4 ✅ |
| `detailed_note_clicked` 补属性 | ⚠️ 未包含 — 已有事件，属性补充留给 LivePage plan |
| `ai_notes_revisited` | Task 5 ✅ |
| `upload_started` | Task 3 ✅ |
| `upload_completed` | Task 3 ✅ |
| `pipeline_completed` | Task 4 ✅ |
| `ai_notes_rated`（FeedbackButtons） | Task 2 + Task 6 ✅ |

**范围说明：** `notes_generated` 和 `detailed_note_clicked` 属性补充属于 LivePage 模块，不在本 plan 范围内。

**Placeholder 扫描：** 无 TBD / TODO。

**类型一致性：** `getSessionIndex()` 和 `incrementSessionIndex()` 在 Task 1 定义，Task 3/4/5/7 均使用相同名称。`FeedbackButtons` props 在 Task 2 定义，Task 6 使用相同 props 名称。
