# LivePage Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 LivePage 的交互逻辑——唯一 sessionId、默认 My Notes、YouTube 风格字幕、自动保存兜底、结束课程完整流程（前后端）。

**Architecture:** 后端新增 `POST /api/live/finalize` 接口，接收前端累积的 transcript + 用户手写笔记，写入 SQLite 后复用现有 `_run_pipeline()` 执行对齐和笔记生成。前端 LivePage 在进入时生成唯一 sessionId，结束课程时 flush 数据 → 调用 finalize → navigate 到 `/notes/:sessionId`（phase=processing）。字幕改为覆盖在 PPT canvas 底部的浮层，静默超过 2.5s 自动 fade out。

**Tech Stack:** React + TypeScript（前端），FastAPI + SQLite（后端），现有 `_run_pipeline()` 复用。

---

## 文件变更地图

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/routers/live.py` | 修改 | 新增 `POST /api/live/finalize` 接口 |
| `backend/routers/process.py` | 参考（不改） | `_run_pipeline()` 直接调用 |
| `frontend/src/pages/LivePage.tsx` | 修改 | sessionId 唯一化、noteMode 默认值、字幕 UI、beforeunload、结束课程流程 |
| `frontend/src/lib/api.ts` | 修改 | 新增 `liveFinalize()` 函数 |

---

## Task 1：后端 `POST /api/live/finalize` 接口

**Files:**
- Modify: `backend/routers/live.py`（在文件末尾追加）
- Reference: `backend/routers/process.py:187-196`（session 创建模式）、`backend/routers/process.py:240`（`_run_pipeline` 签名）

- [ ] **Step 1: 在 `live.py` 顶部补充缺失的 import**

在 `live.py` 的 import 区块（当前到第 22 行），添加：

```python
from fastapi import BackgroundTasks
from backend import db as db_module
from backend.routers.process import _run_pipeline
import tempfile, os as _os, pathlib, json as _json
```

> 注意：`_run_pipeline` 是 `process.py` 里的模块级函数，直接 import 即可复用。

> ⚠️ **跳过（替代方案）**：livepage-phase1 分支改用 `uploadFiles`（上传真实音频 blob）代替 finalize 文本接口，Task 1-3 均跳过。

- [ ] **Step 2: 定义请求体 Pydantic 模型**

在 `live.py` 的 `ExplainRequest` 类（行 75）下方添加：

```python
class TranscriptSegment(BaseModel):
    page_num: int
    text: str           # 该页所有 final transcript 拼接后的完整文本
    timestamp: float    # 该页第一句话的时间戳（秒），用于对齐参考

class FinalizeRequest(BaseModel):
    session_id: str
    transcript_by_page: list[TranscriptSegment]   # 每页的 transcript
    my_notes_by_page: dict[str, str]              # key="pageNum"，value=用户手写文本
    ppt_id: Optional[str] = None                  # 如果用户上传了 PPT，传 PPT 的 id
    language: str = "zh"
```

在文件顶部 import 区补充 `from typing import Optional`（如果没有的话）。

- [ ] **Step 3: 实现 `/api/live/finalize` 接口**

在 `live.py` 末尾（`/ws/live-asr` 路由之后）追加：

```python
@router.post("/live/finalize")
async def live_finalize(req: FinalizeRequest, background_tasks: BackgroundTasks):
    """
    课程结束时调用。
    前端把 transcript + 用户笔记 POST 过来，后端写入 SQLite 后在后台跑流水线。
    立即返回 session_id，前端轮询 /api/sessions/{session_id} 等处理完成。
    """
    import time

    session_id = req.session_id

    # 1. 把 transcript 拼成一个伪 WAV 文本文件（纯文本格式供对齐使用）
    #    实际上 finalize 路径不需要真实音频，transcript 已经是文本了。
    #    我们把 transcript 写成 JSON，供 _run_pipeline 读取（见 Step 4 的 pipeline 适配）。
    session_dir = tempfile.mkdtemp(prefix=f"live_{session_id}_")
    transcript_path = _os.path.join(session_dir, "transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as f:
        _json.dump(
            [{"page_num": s.page_num, "text": s.text, "timestamp": s.timestamp}
             for s in req.transcript_by_page],
            f, ensure_ascii=False
        )

    # 2. 写入 SQLite，状态设为 processing
    db_module.save_session(session_id, {
        "session_id": session_id,
        "status": "processing",
        "ppt_filename": "Live Class",
        "audio_url": None,
        "total_duration": max((s.timestamp for s in req.transcript_by_page), default=0),
        "pages": [],
        "progress": {"step": "aligning", "percent": 10},
        "error": None,
        "created_at": int(time.time()),
    })

    # 3. 后台跑流水线（复用 process.py 的 _run_pipeline）
    background_tasks.add_task(
        _run_pipeline_from_live,
        session_id=session_id,
        session_dir=session_dir,
        transcript_by_page=req.transcript_by_page,
        my_notes_by_page=req.my_notes_by_page,
        ppt_id=req.ppt_id,
        language=req.language,
    )

    return {"session_id": session_id, "status": "processing"}
```

- [ ] **Step 4: 实现 `_run_pipeline_from_live()` 辅助函数**

在 Step 3 的接口函数之前，插入辅助函数：

```python
async def _run_pipeline_from_live(
    session_id: str,
    session_dir: str,
    transcript_by_page: list[TranscriptSegment],
    my_notes_by_page: dict[str, str],
    ppt_id: Optional[str],
    language: str,
):
    """
    从 Live transcript 构造 user_anchors，然后调用 _run_pipeline。
    Live 模式没有真实音频文件，跳过 ASR 步骤，直接用前端 transcript 做对齐。
    """
    from backend.routers.process import _run_pipeline

    # 把每页手写笔记转成 user_anchors 格式（对齐锚点）
    user_anchors = []
    for seg in transcript_by_page:
        note_text = my_notes_by_page.get(str(seg.page_num), "")
        user_anchors.append({
            "page_num": seg.page_num,
            "timestamp": seg.timestamp,
            "note": note_text,
            "transcript": seg.text,
        })

    # 构造伪音频路径（None = 跳过 ASR，使用 transcript 直接对齐）
    # _run_pipeline 需要适配 audio_raw_path=None 的情况（见下方 Note）
    await _run_pipeline(
        session_id=session_id,
        session_dir=session_dir,
        audio_raw_path=None,          # Live 模式无音频文件
        ppt_path=None,                # PPT 通过 ppt_id 从缓存取
        language=language,
        user_anchors=user_anchors,
        ppt_id=ppt_id,
        live_transcript=transcript_by_page,   # 新增参数，见 Task 2
    )
```

- [ ] **Step 5: 手动测试接口可访问**

启动后端：
```bash
cd backend && uvicorn main:app --reload
```

用 curl 测试接口是否注册成功（不测试完整流水线，只测试路由）：
```bash
curl -X POST http://localhost:8000/api/live/finalize \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test_live_001","transcript_by_page":[],"my_notes_by_page":{},"language":"zh"}'
```

预期返回：`{"session_id":"test_live_001","status":"processing"}`

- [ ] **Step 6: Commit**

```bash
git add backend/routers/live.py
git commit -m "feat: add POST /api/live/finalize endpoint"
```

---

## Task 2：`_run_pipeline` 适配 Live 模式（跳过 ASR）

**Files:**
- Modify: `backend/routers/process.py`

Live 模式没有音频文件，`_run_pipeline` 当前在 `audio_raw_path=None` 时会崩溃。需要加一个旁路：有 `live_transcript` 时直接跳过 ASR，用传入的 transcript 构造对齐输入。

- [ ] **Step 1: 修改 `_run_pipeline` 签名，增加 `live_transcript` 可选参数**

找到 `process.py` 行 240，修改函数签名：

```python
async def _run_pipeline(
    session_id: str,
    session_dir: str,
    audio_raw_path: Optional[str],        # Live 模式传 None
    ppt_path: Optional[str],
    language: str,
    user_anchors: list[dict],
    ppt_id: Optional[str] = None,
    live_transcript: list = None,         # 新增：Live 模式的 transcript 列表
):
```

- [ ] **Step 2: 在 ASR 步骤处加旁路逻辑**

找到当前 ASR 转写步骤（`process.py` 行 366-376，`transcribe(wav_path, ...)`），在其前面加判断：

```python
    # ── Step 3: ASR ──────────────────────────────────────────────────────
    if live_transcript is not None:
        # Live 模式：直接用前端 transcript，跳过 ASR
        # 构造和 transcribe() 返回值兼容的格式
        asr_segments = [
            {
                "start": seg.timestamp,
                "end": seg.timestamp + 30.0,   # 估算，对齐算法会用 semantic 覆盖
                "text": seg.text,
            }
            for seg in live_transcript
            if seg.text.strip()
        ]
    else:
        # 正常模式：跑 ASR
        asr_segments = await transcribe(wav_path, language=language)
```

> `transcribe()` 返回的格式参考 `backend/services/asr.py`，确保字段名一致（start/end/text）。

- [ ] **Step 3: 手动验证 process.py 没有语法错误**

```bash
cd backend && python -c "from routers.process import _run_pipeline; print('OK')"
```

预期输出：`OK`

- [ ] **Step 4: Commit**

```bash
git add backend/routers/process.py
git commit -m "feat: _run_pipeline supports live_transcript bypass for ASR step"
```

---

## Task 3：前端 `liveFinalize()` API 函数

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: 在 `api.ts` 末尾追加 `liveFinalize` 函数**

```typescript
export interface LiveTranscriptSegment {
  page_num: number
  text: string
  timestamp: number
}

export async function liveFinalize(payload: {
  session_id: string
  transcript_by_page: LiveTranscriptSegment[]
  my_notes_by_page: Record<string, string>
  ppt_id?: string
  language?: string
}): Promise<{ session_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/live/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'zh', ...payload }),
  })
  if (!res.ok) throw new Error(`finalize failed: ${res.status}`)
  return res.json()
}
```

> `API_BASE` 已在 `api.ts` 顶部定义（`import.meta.env.VITE_API_BASE_URL || ''`）。

- [ ] **Step 2: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

预期：无输出（0 errors）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add liveFinalize() API helper"
```

---

## Task 4：LivePage — sessionId 唯一化 + noteMode 默认值

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

- [x] **Step 1: 将 sessionId 改为进入时生成唯一 ID**

找到行 752-753：
```typescript
const sessionIdRef = useRef('live')
const sessionId = sessionIdRef.current
```

替换为：
```typescript
const sessionIdRef = useRef(`live_${Date.now()}`)
const sessionId = sessionIdRef.current
```

（实际用 `createLiveSession()` → `POST /api/sessions/live` → `live-{uuid8}` 实现，功能等价）

- [x] **Step 2: 将 noteMode 默认值改为 'my'**

找到行 783：
```typescript
const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('ai')
```

替换为：
```typescript
const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('my')
```

- [x] **Step 3: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 4: Commit**（与其他 Task 合并提交）

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "fix: unique sessionId per live session, default to My Notes mode"
```

---

## Task 5：LivePage — beforeunload 自动保存兜底

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

目标：用户关标签页时，把还在 debounce timer 里的 My Notes 全部同步写入 IndexedDB。

- [x] **Step 1: 在 LivePage 组件内添加 beforeunload 监听**

在 `handleMyNoteChange` 的 useCallback（行 841）之后，插入：

```typescript
// beforeunload 兜底：flush 所有未保存的 My Notes
useEffect(() => {
  const handleBeforeUnload = () => {
    const timers = myNoteSaveTimerRef.current
    timers.forEach((timerId, page) => {
      clearTimeout(timerId)
      const text = myNoteTexts.get(page) ?? ''
      // 同步写入（IndexedDB 的 put 是异步的，但在 beforeunload 里尽力而为）
      saveMyNote(sessionId, page, text)
    })
    timers.clear()
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [sessionId, myNoteTexts])
```

- [x] **Step 2: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 3: Commit**（与其他 Task 合并提交）

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "fix: beforeunload flush for My Notes in LivePage"
```

---

## Task 6：LivePage — YouTube 风格字幕（浮层替换黑色框）

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

目标：字幕浮在 PPT canvas 底部，有话时显示，静默 2.5s 后 fade out，不占布局空间。

- [x] **Step 1: 新增 `subtitleVisible` state 和静默计时器**

在行 1016（`wsStatus` state 声明）附近，添加：

```typescript
const [subtitleVisible, setSubtitleVisible] = useState(false)
const subtitleHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [x] **Step 2: 在收到 NLS 消息时显示字幕，并重置计时器**

找到行 1132-1135（`setTranscriptByPage` 的地方），在它之后插入：

```typescript
// 显示字幕，重置静默计时器
setSubtitleVisible(true)
if (subtitleHideTimerRef.current) clearTimeout(subtitleHideTimerRef.current)
subtitleHideTimerRef.current = setTimeout(() => {
  setSubtitleVisible(false)
}, 2500)
```

在 `useEffect` cleanup 里加：
```typescript
return () => {
  if (subtitleHideTimerRef.current) clearTimeout(subtitleHideTimerRef.current)
}
```

- [x] **Step 3: 替换原字幕区域 UI**

找到行 1771-1798（当前字幕条的 JSX），整块替换为：

```tsx
{/* 字幕浮层：说话时出现，静默 2.5s 后淡出 */}
<div
  style={{
    position: 'absolute',
    left: '24px',
    right: `${notesPanelWidth + 32}px`,
    bottom: '24px',
    pointerEvents: 'none',
    opacity: subtitleVisible ? 1 : 0,
    transition: 'opacity 0.4s ease',
    zIndex: 10,
  }}
>
  <div
    style={{
      display: 'inline-block',
      maxWidth: '100%',
      padding: '6px 14px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,0.62)',
      backdropFilter: 'blur(4px)',
      fontSize: '15px',
      lineHeight: '1.6',
      color: '#FFFFFF',
      fontWeight: 500,
    }}
  >
    {subtitleLines.slice(-2).join(' ')}
  </div>
</div>
```

> `subtitleLines` 是已有的 state（只取最后 2 行，避免文字太多）。`notesPanelWidth` 是已有变量，控制字幕不被右侧笔记面板遮挡。

- [x] **Step 4: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 5: Commit**（与其他 Task 合并提交）

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: YouTube-style subtitle overlay, auto-hides after 2.5s silence"
```

---

## Task 7：LivePage — 结束课程完整流程

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

目标：结束课程按钮 → flush My Notes → 调用 `liveFinalize` → navigate 到 `/notes/:sessionId`（phase=processing）。

> ⚠️ **跳过（替代方案）**：livepage-phase1 已有 `stopRecording` → `flushPendingMyNotes` → `uploadFiles`（音频 blob）→ `pollProcessedSession` 的完整流程，navigate 留待手动测试后决策。Task 7 步骤未按 plan 执行。

- [ ] **Step 1: 在 LivePage import 区追加 `liveFinalize`**

找到行 6（`import { getSession, retryPage, generateMyNote, askBullet } from '../lib/api'`），替换为：

```typescript
import { getSession, retryPage, generateMyNote, askBullet, liveFinalize } from '../lib/api'
```

- [ ] **Step 2: 新增结束中状态**

在 `wsStatus` state 附近添加：

```typescript
const [finishing, setFinishing] = useState(false)
```

- [ ] **Step 3: 重写 `stopRecording` 函数**

找到行 1151-1170（当前 `stopRecording`），整块替换为：

```typescript
const stopRecording = useCallback(async () => {
  // 1. 停止录音和 WebSocket
  mediaRecorderRef.current?.stop()
  wsRef.current?.close()
  setWsStatus('stopped')
  setFinishing(true)

  // 2. Flush 所有未保存的 My Notes（清 debounce timer，立即写 IndexedDB）
  const timers = myNoteSaveTimerRef.current
  const flushPromises: Promise<void>[] = []
  timers.forEach((timerId, page) => {
    clearTimeout(timerId)
    const text = myNoteTexts.get(page) ?? ''
    flushPromises.push(saveMyNote(sessionId, page, text))
  })
  timers.clear()
  await Promise.all(flushPromises)

  // 3. 构造 transcript_by_page（从 transcriptByPage state 聚合）
  const transcriptByPage_payload = Object.entries(transcriptByPage).map(([pageStr, lines]) => ({
    page_num: Number(pageStr),
    text: lines.join(''),
    timestamp: 0,   // Live 模式时间戳由后端对齐时忽略
  }))

  // 4. 构造 my_notes_by_page
  const myNotesByPage_payload: Record<string, string> = {}
  myNoteTexts.forEach((text, page) => {
    if (text.trim()) myNotesByPage_payload[String(page)] = text
  })

  // 5. 调用 finalize 接口
  try {
    await liveFinalize({
      session_id: sessionId,
      transcript_by_page: transcriptByPage_payload,
      my_notes_by_page: myNotesByPage_payload,
      language: 'zh',
    })
    // 6. 跳转到 NotesPage，phase=processing（和上传流程一致）
    navigate(`/notes/${sessionId}`, {
      replace: true,
      state: { phase: 'processing' },
    })
  } catch (err) {
    console.error('finalize failed:', err)
    setFinishing(false)
    // 失败时留在页面，显示错误提示（不跳走）
    alert('结束课程失败，请重试')
  }
}, [transcriptByPage, myNoteTexts, sessionId, navigate])
```

- [ ] **Step 4: 更新结束按钮 UI，显示 finishing 状态**

找到行 1550-1557（结束按钮 JSX），替换为：

```tsx
{(wsStatus === 'live' || wsStatus === 'stopped') && (
  <button
    onClick={stopRecording}
    disabled={finishing}
    style={{
      backgroundColor: finishing ? '#E3E3DA' : '#D0CFC5',
      color: finishing ? '#72726E' : '#2F3331',
      border: 'none',
      borderRadius: '9999px',
      padding: '6px 16px',
      fontSize: '12px',
      fontWeight: 600,
      cursor: finishing ? 'not-allowed' : 'pointer',
      opacity: finishing ? 0.7 : 1,
      transition: 'all 0.15s',
    }}
  >
    {finishing ? '正在生成笔记...' : `■ ${t('live_stopped_label')}`}
  </button>
)}
```

- [ ] **Step 5: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: end-of-class flow — flush notes, call finalize, navigate to NotesPage"
```

---

## Task 8：LivePage — 录音状态视觉指示器（Tab 波形动画）

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

目标：用户能一眼看出当前是否在录音。Tab 上的波形图标录音中动起来，停止时静止；顶部也显示一个小红点指示器。

- [x] **Step 1: 确认 TopBar 的 Tab 标题更新机制**

LivePage 在行 758 注册 Tab：
```typescript
openTab({ sessionId, label: 'New Living', path: '/live' })
```

TopBar 用 label 渲染 Tab 文字。录音状态指示靠 label 前缀实现（加 `⏺` 前缀）或靠 CSS 动画。选择**在 label 里加前缀**（最简单，不改 TopBar）：

- [x] **Step 2: 录音开始时更新 Tab label**

找到 `startRecording()` 里 `setWsStatus('live')` 的位置（行 1114），在之后插入：

```typescript
openTab({ sessionId, label: '⏺ 录音中', path: '/live' })
```

- [ ] **Step 3: 录音停止时恢复 Tab label**

找到 `stopRecording()` 里 `setWsStatus('stopped')` 的位置（Task 7 Step 3 重写后的函数开头），在之后插入：

```typescript
openTab({ sessionId, label: 'New Living', path: '/live' })
```

- [x] **Step 4: 在 LivePage 顶部操作栏加录音状态小红点**

找到结束按钮 JSX 附近（Task 7 Step 4 修改后的区域），在按钮左侧加：

```tsx
{wsStatus === 'live' && (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '12px',
    color: '#E05C40',
    fontWeight: 600,
  }}>
    <span style={{
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      backgroundColor: '#E05C40',
      animation: 'pulse 1.5s ease-in-out infinite',
      display: 'inline-block',
    }} />
    录音中
  </span>
)}
```

在全局 CSS（`index.css` 或 `App.css`）里确认已有 `@keyframes pulse` 动画，若没有则添加：

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

- [x] **Step 5: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 6: Commit**（与其他 Task 合并提交）

```bash
git add frontend/src/pages/LivePage.tsx frontend/src/index.css
git commit -m "feat: recording status indicator — pulsing dot + Tab label"
```

---

## Task 9：LivePage — 无 PPT 时仅显示右侧笔记本

**Files:**
- Modify: `frontend/src/pages/LivePage.tsx`

目标：用户没有上传 PPT 时，隐藏左侧 PPT canvas 区域，右侧笔记本撑满全宽。

- [x] **Step 1: 确认当前 PPT 有无的判断条件**

`localPdfUrl`（行 770）为 `null` 时表示没有上传 PPT。这是布局分支的判断依据。
（实际用 `pageSource.length > 0` 作为判断条件，等价）

- [x] **Step 2: 找到主布局 JSX，加条件分支**

找到 LivePage 的主内容区域 JSX（PPT canvas 容器 + 笔记面板并排的 flex 容器），在 PPT canvas 的外层 div 加条件：

```tsx
{/* PPT 区域：有 PDF 时显示，无 PDF 时隐藏 */}
{localPdfUrl && (
  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
    {/* 原有 PPT canvas 内容保持不变 */}
    ...
  </div>
)}

{/* 笔记面板：无 PDF 时撑满全宽 */}
<div style={{
  width: localPdfUrl ? `${notesPanelWidth}px` : '100%',
  flexShrink: 0,
  ...
}}>
  {/* 原有笔记面板内容保持不变 */}
</div>
```

- [x] **Step 3: 无 PPT 时隐藏字幕浮层**

字幕浮层（Task 6 Step 3）是 `position: absolute` 挂在 PPT canvas 容器上的，PPT canvas 隐藏后字幕自然消失，无需额外处理。✓

- [x] **Step 4: 检查 TypeScript 无错误**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 5: Commit**（与其他 Task 合并提交）

```bash
git add frontend/src/pages/LivePage.tsx
git commit -m "feat: hide PPT canvas when no PDF uploaded, notes panel goes full width"
```

---

## Task 10：Lobby 进行中状态修复（原 Task 8）

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`（仅排序逻辑）

当前问题：`live` 状态的 session 永远显示"进行中"。有了唯一 sessionId 后，结束流程会把 session 写入 DB 并状态设为 `processing`/`ready`，Lobby 轮询到正确状态后自动更新。

无需修改 LobbyPage 代码，只需验证：

- [ ] **Step 1: 验证 Lobby 轮询逻辑**

`LobbyPage.tsx` 行 1162-1166 已有 `visibilitychange` 监听：用户切回 Lobby 时自动调用 `refreshSessions()`，它会从后端重新拉取所有 session 的最新状态。

确认 `refreshSessions()` 读取的是真实后端数据（行 1132-1156），不是 localStorage 缓存。✓

- [ ] **Step 2: 确认后端 listSessions 返回 status 字段**

```bash
curl http://localhost:8000/api/sessions | python -m json.tool | head -30
```

确认每条 session 有 `status` 字段（`processing`/`ready`/`live`）。

- [ ] **Step 3: Commit（如有改动）**

如果 Step 1-2 验证无问题，无需代码改动，直接跳过。

---

## Self-Review

### Spec Coverage

| 需求 | Task |
|------|------|
| 默认 My Notes | Task 4 Step 2 |
| 唯一 sessionId | Task 4 Step 1 |
| YouTube 字幕浮层 | Task 6 |
| 静默后字幕消失 | Task 6 Step 1-2 |
| beforeunload 兜底 | Task 5 |
| 结束课程流程 | Task 7 |
| `/api/live/finalize` 接口 | Task 1 |
| Live 跳过 ASR | Task 2 |
| `liveFinalize()` 前端 API | Task 3 |
| Lobby 进行中修复 | Task 8 |

### 类型一致性检查

- `LiveTranscriptSegment`（Task 3）的字段 `page_num/text/timestamp` 与后端 `TranscriptSegment`（Task 1）一一对应 ✓
- `stopRecording` 里构造的 `transcriptByPage_payload` 直接匹配 `LiveTranscriptSegment[]` 类型 ✓
- `_run_pipeline` 新增的 `live_transcript` 参数默认值为 `None`，不影响现有上传流程 ✓

### 风险点

- Task 2 中 `asr_segments` 的 `end` 字段使用估算值（timestamp + 30s），对齐算法依赖 semantic similarity 为主信号，这个估算值是软先验，可接受
- `saveMyNote` 在 `beforeunload` 里是异步调用，浏览器不保证等它完成，但这是已知限制，IndexedDB 的 `put` 通常在几毫秒内提交
