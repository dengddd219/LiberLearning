# Frontend De-mock 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消灭前端所有 mock/硬编码数据，让 LiberStudy 从上传文件到展示笔记的完整流程全部接入真实后端 API。

**Architecture:** 后端已完整实现（FastAPI，端口 8000），前端（React + Vite，端口 5173）通过 Vite proxy 转发 `/api`、`/slides`、`/audio` 到后端。修改只在前端进行，不改后端。按页面优先级从高到低修：P0 = 流程断点（SessionPage 提交逻辑），P1 = 进度 UI 假数据（UploadPage ProcessingState），P2 = 装饰性假数据（LobbyPage Insights）。

**Tech Stack:** React 18, TypeScript, Vite, `lib/api.ts`（已封装全部真实 API 调用），MediaRecorder API，Web Audio API（AnalyserNode）

---

## 文件改动清单

| 文件 | 动作 | 改动内容 |
|------|------|----------|
| `frontend/src/pages/SessionPage.tsx` | 修改 | 移除 MOCK_SLIDES、硬编码幻灯片内容、Demo笔记、假波形；用户选 PPT 后显示文件名而非假缩略图；提交后调真实 API；波形改用 AnalyserNode |
| `frontend/src/pages/UploadPage.tsx` | 修改 | 移除 ProcessingState 组件（上传中只显示 spinner），上传成功立即跳转 /processing |
| `frontend/src/pages/LobbyPage.tsx` | 修改 | 隐藏 Insight 卡片假数据；用户信息改为占位符而非假名字 |

**不需要改的文件（已完全真实）：**
- `lib/api.ts` ✅
- `ProcessingPage.tsx` ✅（核心轮询已真实）
- `NotesPage.tsx` ✅
- `DetailedNotePage.tsx` ✅
- `LiveSessionPage.tsx` — 已被 App.tsx 重定向废弃，忽略

---

## Task 1：SessionPage — 移除 MOCK_SLIDES，PPT 选择后显示真实文件名

**背景：** `SessionPage.tsx` 用 `MOCK_SLIDES` 常量（3张 placehold.co 图片）伪造幻灯片，左侧导航始终显示假缩略图，中间画布写死 "Advanced Cognitive Architectures" 和 "SLIDE 04 / 24"。

后端没有独立的 PPT 预览接口（PPT 必须和音频一起 POST /api/process 才会解析），所以本 Task 的目标是：**用户选 PPT 文件后，左侧显示文件名和页数占位符，而不是假缩略图；中间画布显示"录音中，完成后生成笔记"空状态，而不是硬编码内容。**

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1：读文件，确认当前 MOCK_SLIDES 的位置和用法**

```bash
# 在编辑器里打开，找以下关键词：
# - MOCK_SLIDES
# - Advanced Cognitive Architectures
# - SLIDE 04 / 24
# - placehold.co
```

读 `frontend/src/pages/SessionPage.tsx` 全文。

- [ ] **Step 2：移除 MOCK_SLIDES 常量，改为从 state 读取 PPT 文件名**

找到并删除：
```typescript
const MOCK_SLIDES: SlideInfo[] = [
  { pageNum: 1, slideImageUrl: 'https://placehold.co/175x96' },
  { pageNum: 2, slideImageUrl: 'https://placehold.co/175x96' },
  { pageNum: 3, slideImageUrl: 'https://placehold.co/175x96' },
]
```

找到 `SlideInfo` 类型定义，如果只被 MOCK_SLIDES 用，一并删除。

找到：
```typescript
const [slides] = useState<SlideInfo[]>(MOCK_SLIDES)
```
替换为：
```typescript
const [pptFileName, setPptFileName] = useState<string | null>(null)
```

- [ ] **Step 3：修改 PPT 文件选择 handler，记录文件名**

找到 PPT 文件选择的 input `onChange` 或 handler，修改为：
```typescript
const handlePptSelect = (file: File) => {
  setPptFile(file)
  setPptFileName(file.name)
}
```

确保 `pptFile` state 仍然存在（提交时要用）。

- [ ] **Step 4：替换左侧幻灯片导航区域的渲染逻辑**

找到渲染 `slides.map(...)` 的 JSX，替换为：

```tsx
{/* 左侧 PPT 导航 */}
{pptFileName ? (
  <div style={{ padding: '16px', color: '#5F5E5E', fontSize: '13px' }}>
    <div style={{ fontWeight: 600, marginBottom: '8px', wordBreak: 'break-all' }}>
      {pptFileName}
    </div>
    <div style={{ color: '#AFB3B0', fontSize: '11px' }}>
      上传后解析页数
    </div>
  </div>
) : (
  <div style={{ padding: '16px', color: '#AFB3B0', fontSize: '13px', textAlign: 'center' }}>
    未上传 PPT
  </div>
)}
```

- [ ] **Step 5：替换中间画布硬编码内容**

找到以下 JSX 片段（包含 "Advanced Cognitive Architectures" 或 "SLIDE 04 / 24" 的部分），整段替换为：

```tsx
{/* 中间画布：录音状态提示 */}
<div
  style={{
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#AFB3B0',
    fontSize: '14px',
    gap: '8px',
  }}
>
  {isRecording ? (
    <>
      <div style={{ fontSize: '32px' }}>🎙</div>
      <div>录音中...</div>
      <div style={{ fontSize: '12px' }}>完成录音后点击生成笔记</div>
    </>
  ) : (
    <>
      <div style={{ fontSize: '32px' }}>📄</div>
      <div>点击开始录音</div>
      {pptFileName && <div style={{ fontSize: '12px' }}>{pptFileName}</div>}
    </>
  )}
</div>
```

- [ ] **Step 6：浏览器验证**

打开 http://localhost:5173/session，确认：
- 左侧不再显示 placehold.co 假图片
- 中间画布不再显示 "Advanced Cognitive Architectures"
- 选择 PPT 文件后，左侧显示文件名

- [ ] **Step 7：Commit**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat: remove MOCK_SLIDES and hardcoded slide content from SessionPage"
```

---

## Task 2：SessionPage — 移除硬编码 Demo 笔记

**背景：** JSX 里直接写死了 2 条笔记（时间戳 "00:45" / "03:52"，标题 "Contextual Anchors" / "Latency vs Throughput"），始终出现在 My Notes 列表，与用户真实输入无关。

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1：找到硬编码笔记的 JSX 位置**

搜索关键词 `Contextual Anchors` 或 `00:45`，找到对应的 JSX 片段。

- [ ] **Step 2：确认 annotations/notes 的真实 state 结构**

找到 `annotations` 或 `notes` 的 useState，记录其类型和初始值。如果初始值里有硬编码数据，清空为 `[]`。

- [ ] **Step 3：删除 JSX 里的硬编码笔记片段**

找到类似这样的 JSX（可能有 2 个 div，分别对应 2 条硬编码笔记）：

```tsx
<div>
  <span>00:45</span>
  <span>Contextual Anchors</span>
  ...
</div>
<div>
  <span>03:52</span>
  <span>Latency vs Throughput</span>
  ...
</div>
```

删除这些 hardcoded 片段，改为渲染真实的 annotations state：

```tsx
{annotations.length === 0 ? (
  <div style={{ color: '#AFB3B0', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
    暂无笔记，点击 + 添加标注
  </div>
) : (
  annotations.map((note, i) => (
    <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(175,179,176,0.15)' }}>
      <span style={{ color: '#AFB3B0', fontSize: '11px', marginRight: '8px' }}>
        {note.timestamp ?? ''}
      </span>
      <span style={{ fontSize: '13px', color: '#2F3331' }}>
        {note.text ?? note.content ?? ''}
      </span>
    </div>
  ))
)}
```

（根据实际 annotation 的字段名调整 `note.timestamp` 和 `note.text`）

- [ ] **Step 4：浏览器验证**

打开 http://localhost:5173/session，确认 My Notes 列表为空（或只有用户真实输入的内容），不再默认显示 "Contextual Anchors" / "Latency vs Throughput"。

- [ ] **Step 5：Commit**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat: remove hardcoded demo notes from SessionPage, render real annotations"
```

---

## Task 3：SessionPage — 修复提交逻辑，真实调用 /api/process

**背景：** 当前 `handleGenerateNotes` 的实现需要确认是否真实调用了 `uploadFiles()`。`LiveSessionPage`（已废弃）里有 `navigate('/notes/mock-session-001')` 写死假 session id，但活跃的 `SessionPage` 可能也有类似问题。

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1：读 handleGenerateNotes 函数**

找到 `handleGenerateNotes`（或"生成笔记"按钮的 onClick handler），完整读出其代码。

- [ ] **Step 2：检查是否有 mock-session 跳转**

搜索 `mock-session`、`mock_session`、`navigate('/notes/mock`，如果存在，标记需要修复。

- [ ] **Step 3：确保提交逻辑如下**

`handleGenerateNotes` 必须是：
```typescript
const handleGenerateNotes = async () => {
  if (!audioBlob && recordedChunks.length === 0) return
  setIsSubmitting(true)
  try {
    // 1. 把录制的 audio chunks 合并成 Blob
    const blob = audioBlob ?? new Blob(recordedChunks, { type: 'audio/webm' })
    const audioFile = new File([blob], 'recording.webm', { type: 'audio/webm' })

    // 2. 真实调用 API
    const result = await uploadFiles(
      pptFile ?? undefined,
      audioFile,
      'zh',                // 语言
      userAnchors,         // 用户标注的页码时间戳（如有）
    )

    // 3. 跳转到真实处理页
    navigate(`/processing?session_id=${result.session_id}`)
  } catch (err) {
    console.error('Submit failed:', err)
    setSubmitError('提交失败，请检查网络后重试')
  } finally {
    setIsSubmitting(false)
  }
}
```

根据 SessionPage 中实际的 state 变量名（`recordedChunks`、`audioBlob`、`pptFile` 等）调整字段名，保持逻辑结构一致。

如果 `uploadFiles` 未导入，在文件顶部加：
```typescript
import { uploadFiles } from '../lib/api'
```

- [ ] **Step 4：添加 submitError 展示**

在"生成笔记"按钮附近加错误展示：
```tsx
{submitError && (
  <p role="alert" style={{ color: '#E05C40', fontSize: '13px', margin: '8px 0 0' }}>
    {submitError}
  </p>
)}
```

如果 `submitError` state 不存在，添加：
```typescript
const [submitError, setSubmitError] = useState<string | null>(null)
```

- [ ] **Step 5：端到端验证**

1. 打开 http://localhost:5173/session
2. 点击开始录音，说几句话，停止录音
3. 点击生成笔记
4. 确认跳转到 `/processing?session_id=xxxx`（session_id 是真实 UUID，不是 mock-session-001）
5. 等待处理完成后跳转 `/notes/:sessionId`

- [ ] **Step 6：Commit**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat: SessionPage submit calls real /api/process, navigate with real session_id"
```

---

## Task 4：SessionPage — 用 AnalyserNode 驱动真实录音波形

**背景：** `WAVEFORM_BARS = [24, 40, 20, 48, ...]` 是12个硬编码高度值，录音时波形不动，是纯装饰。

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1：找到 WAVEFORM_BARS 常量和渲染波形的 JSX**

搜索 `WAVEFORM_BARS`，找到其定义和使用位置。

- [ ] **Step 2：添加 waveform state 和 analyser ref**

在 SessionPage 函数内，已有 state 的附近添加：
```typescript
const [waveformBars, setWaveformBars] = useState<number[]>(Array(12).fill(4))
const analyserRef = useRef<AnalyserNode | null>(null)
const animFrameRef = useRef<number>(0)
```

- [ ] **Step 3：在开始录音后，接入 AnalyserNode**

找到 `navigator.mediaDevices.getUserMedia` 的调用，在拿到 `stream` 后加：

```typescript
// 接入音量分析
const audioCtx = new AudioContext()
const source = audioCtx.createMediaStreamSource(stream)
const analyser = audioCtx.createAnalyser()
analyser.fftSize = 32
source.connect(analyser)
analyserRef.current = analyser

// 动画循环
const dataArray = new Uint8Array(analyser.frequencyBinCount) // 16个点
const draw = () => {
  analyser.getByteFrequencyData(dataArray)
  // 取12个点，映射到 4-48px 高度
  const bars = Array.from({ length: 12 }, (_, i) => {
    const val = dataArray[Math.floor(i * dataArray.length / 12)]
    return Math.max(4, Math.round((val / 255) * 48))
  })
  setWaveformBars(bars)
  animFrameRef.current = requestAnimationFrame(draw)
}
draw()
```

- [ ] **Step 4：停止录音时清理**

找到停止录音的逻辑，加上清理：
```typescript
// 停止波形动画
cancelAnimationFrame(animFrameRef.current)
analyserRef.current = null
setWaveformBars(Array(12).fill(4))
```

- [ ] **Step 5：把渲染波形的 JSX 改用 waveformBars**

找到：
```tsx
{WAVEFORM_BARS.map((h, i) => (
  <div key={i} style={{ height: `${h}px`, ... }} />
))}
```

改为：
```tsx
{waveformBars.map((h, i) => (
  <div key={i} style={{ height: `${h}px`, ... }} />
))}
```

- [ ] **Step 6：浏览器验证**

打开 http://localhost:5173/session，开始录音，对着麦克风说话，确认波形柱高度随音量实时变化（不再是静态的）。

- [ ] **Step 7：Commit**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat: replace hardcoded waveform with real AnalyserNode audio visualization"
```

---

## Task 5：UploadPage — 移除 ProcessingState，上传成功立即跳转

**背景：** `UploadPage.tsx` 在 `uploading=true` 时展示 `ProcessingState` 组件，但该组件的进度是完全假的（`useState(68)` 硬编码，PAGE 3/18 写死）。实际上 UploadPage 成功后跳转 `/processing`，`ProcessingPage` 才是真实轮询进度的地方。两个进度 UI 并存且 UploadPage 那个是假的。

**Files:**
- Modify: `frontend/src/pages/UploadPage.tsx`

- [ ] **Step 1：读 UploadPage.tsx，找 ProcessingState 组件和 progress state**

确认以下内容的位置：
- `const [progress] = useState(68)`
- `<ProcessingState progress={progress} />`
- `ProcessingState` 组件定义（在同文件还是单独文件？）

- [ ] **Step 2：删除 ProcessingState 组件定义**

找到 `function ProcessingState(...)` 的整个函数定义（约 L191–L365），完整删除。

- [ ] **Step 3：删除 progress state**

删除：
```typescript
const [progress] = useState(68)
```

- [ ] **Step 4：把 uploading 时的 JSX 替换为简单 spinner**

找到：
```tsx
{!uploading ? (
  <div>...上传区域...</div>
) : (
  <ProcessingState progress={progress} />
)}
```

替换为：
```tsx
{!uploading ? (
  <div>...上传区域...</div>
) : (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      padding: '48px 0',
      color: '#5F5E5E',
      fontSize: '14px',
    }}
  >
    <svg
      width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
    <span>上传中，请稍候...</span>
  </div>
)}
```

在同文件或全局 CSS 里确认有 `@keyframes spin`，如无则在 JSX 的 `<style>` 标签或 tailwind 类里加（UploadPage 使用 inline style，加一个 `<style>` 在 JSX 根部）：
```tsx
<style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
```

- [ ] **Step 5：浏览器验证**

1. 打开 http://localhost:5173/upload
2. 选择音频文件，点击 Save Workspace
3. 确认显示 spinner + "上传中，请稍候..."（而不是假的 68% 进度条）
4. 等待跳转到 /processing 页面（真实进度条）

- [ ] **Step 6：Commit**

```bash
git add frontend/src/pages/UploadPage.tsx
git commit -m "feat: replace fake ProcessingState with simple spinner in UploadPage"
```

---

## Task 6：LobbyPage — 清理 Insight 卡片假数据，用户信息改占位符

**背景：** 侧边栏显示 "Alex Chen" / "Graduate Student"，Insight 区域有 2 条完全硬编码的假文字，用户看到这些会误以为是真实数据。

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`

- [ ] **Step 1：找到硬编码用户信息**

搜索 `Alex Chen`，找到对应 JSX，替换为：
```tsx
<span style={{ fontWeight: 600 }}>同学</span>
<span style={{ color: '#AFB3B0', fontSize: '12px' }}>学生</span>
```

（后续接用户系统时再改回真实值，现在改成中性占位符即可）

- [ ] **Step 2：找到 Insight 卡片**

搜索 `You've averaged` 或 `4.2 hours`，找到 Insight 卡片的整个 JSX 块。

- [ ] **Step 3：隐藏或清空 Insight 卡片**

方案A（推荐）：直接删除 Insight 卡片的 JSX，等有真实数据接口时再加回来。

方案B：保留容器，但内容改为"功能即将上线"：
```tsx
<div style={{ color: '#AFB3B0', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
  学习洞察即将上线
</div>
```

选方案A，删除 Insight 区域 JSX。

- [ ] **Step 4：浏览器验证**

打开 http://localhost:5173，确认：
- 侧边栏不再显示 "Alex Chen"
- 不再有 "4.2 hours" 等假数据文字

- [ ] **Step 5：Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx
git commit -m "feat: replace hardcoded user info and Insight cards with neutral placeholders in LobbyPage"
```

---

## Task 7：端到端全流程验证

**目标：** 确认两条主流程都能跑通，从界面操作到笔记展示，全程无 mock。

**前置条件：**
- 后端已启动：`cd backend && uvicorn main:app --reload --port 8000`
- 前端已启动：`cd frontend && npm run dev`
- 后端 `.env` 里有 `OPENAI_API_KEY` 和 `ANTHROPIC_API_KEY`

- [ ] **流程A：Post-class 上传流程（UploadPage）**

1. 打开 http://localhost:5173，点击"新建课程"或导航到 `/upload`
2. 上传一个 .pptx 文件 + 一个 .mp3/.wav 音频文件
3. 点击提交，确认跳转到 `/processing?session_id=<真实UUID>`（UUID 格式如 `ed88b52d-f653-48ac-9ed3-7023c270eea2`，不是 `mock-session-001`）
4. 等待进度条走完（步骤：uploading→converting→parsing_ppt→transcribing→aligning→generating）
5. 自动跳转到 `/notes/<sessionId>`
6. 确认：左侧 slide 导航显示真实 PPT 页数，中间画布渲染真实 PDF 页面，右侧笔记是 AI 生成的真实内容

- [ ] **流程B：In-class 录音流程（SessionPage）**

1. 打开 http://localhost:5173/session
2. 可选：上传 PPT 文件
3. 点击开始录音，说 10–20 秒内容，停止录音
4. 点击生成笔记，确认跳转到 `/processing?session_id=<真实UUID>`
5. 等待处理完成，跳转到 `/notes/<sessionId>`
6. 确认笔记内容是真实 AI 生成的

- [ ] **验证无 mock 的关键检查点**

打开浏览器 DevTools → Network 标签，过滤 `/api`，检查：
- `/api/process` 返回 `200` 且 body 是 `{"session_id": "真实UUID"}`（不是 `mock-session-001`）
- `/api/sessions/<sessionId>` 轮询返回真实 progress（step 字段变化，percent 从 5 涨到 100）
- 最终 `/api/sessions/<sessionId>` 返回 `status: "ready"` 且 `pages` 数组有真实笔记内容

---

## 自查清单（写完 plan 后对照）

- [x] MOCK_SLIDES 移除 → Task 1
- [x] 硬编码幻灯片内容移除 → Task 1
- [x] Demo 笔记移除 → Task 2
- [x] 提交逻辑接真实 API → Task 3
- [x] 假波形替换 → Task 4
- [x] UploadPage 假进度条移除 → Task 5
- [x] LobbyPage 假用户信息 → Task 6
- [x] 端到端验证 → Task 7
- [x] LiveSessionPage 不修改（已被 App.tsx redirect 废弃）
