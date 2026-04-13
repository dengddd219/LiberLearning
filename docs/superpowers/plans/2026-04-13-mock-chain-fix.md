# Mock 链路修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复前后端 mock 链路的 4 个已知 bug，让用户能完整地访问 `/notes/mock-session-001` 并看到正确渲染的 mock 数据。

**Architecture:** 纯 mock 链路——不修改后端处理逻辑，只修复前端字段映射、轮询逻辑和 API 调用路径。所有修改限定在 3 个前端文件内。

**Tech Stack:** React + TypeScript（frontend/src/）

---

## 问题清单（诊断结论）

| # | 文件 | 问题 | 影响 |
|---|------|------|------|
| 1 | `frontend/src/pages/NotesPage.tsx:8,172,381` | `slide_image_url` 字段不存在，应为 `pdf_url`+`pdf_page_num` | 幻灯片图片全部显示为空 |
| 2 | `frontend/src/pages/NotesPage.tsx:576` | `bullet.timestamp` 不存在，应为 `bullet.timestamp_start` | 时间戳点击无效 |
| 3 | `frontend/src/pages/ProcessingPage.tsx:34-54` | 纯假计时，不轮询 `/api/sessions/{id}` | 无法感知真实处理完成 |
| 4 | `frontend/src/lib/api.ts:24` | 写死调用 `/api/process-mock`，应为可配置 | 无法接入真实 pipeline |

---

## 文件结构（修改范围）

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/pages/NotesPage.tsx` | 修复 `PageData` interface + `slide_image_url` → PDF iframe 渲染 + `bullet.timestamp` → `bullet.timestamp_start` |
| `frontend/src/pages/ProcessingPage.tsx` | 替换假计时为真实轮询 `GET /api/sessions/{id}`，ready 后跳转 |
| `frontend/src/lib/api.ts` | `uploadFiles` 改为调用 `/api/process-mock`（保持现状，但加注释说明后续接入真实接口的改法） |

---

## Task 1：修复 NotesPage — PageData interface + 图片渲染

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx:5-16`（interface 定义）
- Modify: `frontend/src/pages/NotesPage.tsx:169-173`（sidebar slides 构建）
- Modify: `frontend/src/pages/NotesPage.tsx:379-385`（中栏 canvas 图片渲染）

### 背景

后端 mock 返回的 page 对象字段为：
```json
{
  "pdf_url": "/slides/slides.pdf",
  "pdf_page_num": 1
}
```

前端 interface 写的是 `slide_image_url: string`，实际不存在，导致 `img src` 为 `undefined`，图片空白。

**修复策略**：幻灯片用 PDF 嵌入渲染（`<iframe>` 或 `<embed>`）。由于浏览器内置 PDF 查看器支持 `file.pdf#page=N`，可以直接用这种方式展示对应页。Sidebar 缩略图无法用 PDF 截图，改为显示页码占位符（因为没有 PNG 输出）。

- [ ] **Step 1：更新 `PageData` interface，移除 `slide_image_url`，添加 `pdf_url` 和 `pdf_page_num`**

在 [frontend/src/pages/NotesPage.tsx](frontend/src/pages/NotesPage.tsx) 第 5-16 行，将：

```typescript
interface Bullet { text: string; ai_comment: string; timestamp: number }
interface PageData {
  page_num: number
  slide_image_url: string
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[] } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
}
```

改为：

```typescript
interface Bullet { text: string; ai_comment: string; timestamp_start: number; timestamp_end: number }
interface PageData {
  page_num: number
  pdf_url: string
  pdf_page_num: number
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[] } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
}
```

- [ ] **Step 2：修复 sidebar slides 构建（第 169-173 行）**

将：
```typescript
const slides = session.pages.map((p) => ({
  pageNum: p.page_num,
  imageUrl: `${API_BASE}${p.slide_image_url}`,
}))
```

改为：
```typescript
const slides = session.pages.map((p) => ({
  pageNum: p.page_num,
  pdfUrl: `${API_BASE}${p.pdf_url}`,
  pdfPageNum: p.pdf_page_num,
}))
```

- [ ] **Step 3：修复 sidebar 缩略图渲染（第 253-294 行）**

将 `slides.map((slide) => ...)` 内的 `<img src={slide.imageUrl} .../>` 替换为页码占位符（因为没有 PNG 缩略图）：

```tsx
{slides.map((slide) => {
  const isActive = slide.pageNum === currentPage
  return (
    <div
      key={slide.pageNum}
      onClick={() => setScrollToPage(slide.pageNum)}
      className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{
        height: '96px',
        borderRadius: '6px',
        background: '#EDEEEB',
        boxShadow: isActive
          ? '0px 0px 0px 2px rgba(95,94,94,1)'
          : '0 1px 3px rgba(0,0,0,0.08)',
        opacity: isActive ? 1 : 0.7,
      }}
    >
      <span style={{ fontSize: '22px', fontWeight: '700', color: '#AFB3B0' }}>
        {slide.pageNum}
      </span>
      {/* Page badge */}
      <span
        className="absolute top-1.5 left-1.5 flex items-center justify-center"
        style={{
          background: '#2F3331',
          color: '#FFFFFF',
          fontSize: '9px',
          fontWeight: '700',
          borderRadius: '3px',
          padding: '1px 5px',
          minWidth: '18px',
        }}
      >
        {slide.pageNum}
      </span>
    </div>
  )
})}
```

- [ ] **Step 4：修复中栏 Canvas 的幻灯片渲染（第 379-384 行）**

将：
```tsx
<img
  src={`${API_BASE}${page.slide_image_url}`}
  alt={`第${page.page_num}页`}
  className="w-full block"
/>
```

改为（embed PDF 指定页面）：
```tsx
<embed
  src={`${API_BASE}${page.pdf_url}#page=${page.pdf_page_num}`}
  type="application/pdf"
  style={{ width: '100%', minHeight: '500px', display: 'block' }}
  title={`第${page.page_num}页`}
/>
```

- [ ] **Step 5：修复 bullet.timestamp → bullet.timestamp_start（第 576 行）**

将：
```tsx
onClick={() => handleTimestampClick(bullet.timestamp)}
```

改为：
```tsx
onClick={() => handleTimestampClick(bullet.timestamp_start)}
```

- [ ] **Step 6：TypeScript 类型检查**

运行：
```bash
cd frontend && npx tsc --noEmit
```

期望：无 TS 错误（或仅有与本次修改无关的旧错误）

- [ ] **Step 7：Commit**

```bash
cd frontend && git add src/pages/NotesPage.tsx
git commit -m "fix: align NotesPage with backend field names (pdf_url/pdf_page_num/timestamp_start)"
```

---

## Task 2：修复 ProcessingPage — 替换假计时为真实轮询

**Files:**
- Modify: `frontend/src/pages/ProcessingPage.tsx`（整个 useEffect 轮询逻辑）

### 背景

当前 ProcessingPage 在组件挂载时启动一段假计时（setTimeout），6 秒后直接跳转 `/notes/{sessionId}`，完全不看后端状态。

对于 mock 链路：`/api/sessions/mock-session-001` 立即返回 `status: "ready"`，所以轮询第一次就会跳转，行为正确。

对于真实 pipeline：需要轮询等待 status 变为 `"ready"` 或 `"partial_ready"`。

**修复策略**：轮询 `GET /api/sessions/{sessionId}`，每 2 秒一次，收到 `status === "ready"` 或 `"partial_ready"` 时跳转，收到 `"error"` 时展示失败 UI。同时保留阶段进度动画（stage 文案根据后端 status 无法精确获取，所以仍然用时间推进，但跳转逻辑改为等轮询结果）。

- [ ] **Step 1：替换 useEffect 轮询逻辑**

将 [frontend/src/pages/ProcessingPage.tsx](frontend/src/pages/ProcessingPage.tsx) 第 29-60 行的 useEffect 整体替换为：

```tsx
useEffect(() => {
  if (failed) return

  const timer = setInterval(() => setElapsed((t) => t + 1), 1000)

  // Animate stages locally (cosmetic only, not tied to real backend progress)
  const timings = [1500, 2500, 4000, 6000]
  const timeouts: ReturnType<typeof setTimeout>[] = []
  STAGES.forEach((_, i) => {
    timeouts.push(setTimeout(() => setCurrentStage(i + 1), timings[i]))
  })

  // Poll backend for real status
  let done = false
  const poll = setInterval(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (!res.ok) return
      const data = await res.json()
      if ((data.status === 'ready' || data.status === 'partial_ready') && !done) {
        done = true
        clearInterval(poll)
        setCurrentStage(STAGES.length)
        setTimeout(() => navigate(`/notes/${sessionId}`), 400)
      } else if (data.status === 'error' && !done) {
        done = true
        clearInterval(poll)
        setFailed(true)
      }
    } catch {
      // network error — keep polling
    }
  }, 2000)

  return () => {
    clearInterval(timer)
    clearInterval(poll)
    timeouts.forEach(clearTimeout)
  }
}, [failed, navigate, sessionId])
```

- [ ] **Step 2：TypeScript 检查**

```bash
cd frontend && npx tsc --noEmit
```

期望：无新增 TS 错误

- [ ] **Step 3：手动验证 mock 链路**

1. 启动后端：`cd backend && uvicorn main:app --reload`
2. 启动前端：`cd frontend && npm run dev`
3. 访问 `http://localhost:5173/processing?session_id=mock-session-001`
4. 应在 2 秒内（第一次轮询）自动跳转到 `/notes/mock-session-001`

- [ ] **Step 4：Commit**

```bash
git add frontend/src/pages/ProcessingPage.tsx
git commit -m "fix: replace fake timer in ProcessingPage with real backend polling"
```

---

## Task 3：（可选）api.ts 加注释说明接入真实 pipeline 的改法

**Files:**
- Modify: `frontend/src/lib/api.ts:20-25`

### 背景

`uploadFiles` 当前写死调用 `/api/process-mock`，这对 mock 链路是对的（mock 接口会立即返回 `mock-session-001`）。
真实接入时改为 `/api/process` 即可。加个注释避免后续混淆。

- [ ] **Step 1：添加注释**

将：
```typescript
export async function uploadFiles(pptFile?: File, audioFile?: File): Promise<{ session_id: string }> {
  const form = new FormData()
  if (pptFile) form.append('ppt', pptFile)
  if (audioFile) form.append('audio', audioFile)
  return apiPost('/api/process-mock', form)
}
```

改为：
```typescript
export async function uploadFiles(pptFile?: File, audioFile?: File): Promise<{ session_id: string }> {
  const form = new FormData()
  if (pptFile) form.append('ppt', pptFile)
  if (audioFile) form.append('audio', audioFile)
  // TODO: change to '/api/process' when connecting to real pipeline
  return apiPost('/api/process-mock', form)
}
```

- [ ] **Step 2：Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "chore: add comment in uploadFiles for real pipeline endpoint"
```

---

## 验证：完整 mock 链路 E2E 测试

完成 Task 1+2 后，按以下步骤验证：

```
1. 启动后端：cd backend && uvicorn main:app --reload --port 8000
2. 启动前端：cd frontend && npm run dev
3. 访问：http://localhost:5173/notes/mock-session-001
4. ✓ 检查：3 页内容都有 PDF 嵌入（embed 元素，显示对应页）
5. ✓ 检查：笔记面板显示 bullets（AI Notes 模式）
6. ✓ 检查：点击 bullet 不报错
7. ✓ 检查：My Notes / AI Notes 切换正常
8. ✓ 检查：第 1 页有 Active Annotation（user_note + ai_expansion）
9. ✓ 检查：第 3 页有"对齐置信度低"警告标签

5. 访问：http://localhost:5173/upload → 上传任意音频文件 → 点击 Save Workspace
6. ✓ 跳转到 /processing?session_id=mock-session-001
7. ✓ 2 秒内自动跳转到 /notes/mock-session-001
```

---

## 自检

### Spec 覆盖

- [x] 问题 1：字段不匹配（`slide_image_url` → `pdf_url`/`pdf_page_num`）→ Task 1 Step 1-4
- [x] 问题 2（额外 bug）：`bullet.timestamp` → `bullet.timestamp_start` → Task 1 Step 5
- [x] 问题 3：ProcessingPage 不轮询 → Task 2
- [x] 问题 4：api.ts 写死注释 → Task 3

### 潜在风险

- **PDF embed 兼容性**：`<embed>` + `#page=N` 在 Chrome 可用，Firefox 可用，Safari 不稳定。当前 MVP 接受此限制，后续若要换成 PNG 渲染需要后端出图接口。
- **轮询并发**：Task 2 中用 `done` flag 防止重复跳转，已处理。
- **mock 链路 session_id 写死**：UploadPage 的 catch 分支写死跳 `mock-session-001`，这是有意为之的 fallback，不在本次修改范围内。
