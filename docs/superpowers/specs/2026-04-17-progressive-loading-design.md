# 渐进式加载与沉浸式工作流设计规格

**日期**: 2026-04-17  
**状态**: Draft  
**范围**: 前端 NotesPage 入口重构 + 后端 pipeline 并行化 + SSE 进度推送

---

## 1. 概述

### 1.1 目标

摒弃"上传 → ProcessingPage 等待 → 跳转 NotesPage"的三页面串行流程，改为"上传弹窗 → 同一 NotesPage 内渐进式加载"的沉浸式工作流。用户完成上传后立刻进入工作区，各 UI 模块根据后端任务完成情况逐步"点亮"。

### 1.2 核心原则

- **尊重 NotesPage 现有代码**：不改动任何现有 UI 渲染逻辑（bullet 组件、transcript 列表、canvas 渲染、IndexedDB 持久化、InlineQA、PageChat 等）。只在 NotesPage 外层增加"入口状态机"和"SSE 订阅 → 增量 setSession"逻辑。
- **最小改动**：现有 API 端点全部保留，新增 1 个 SSE 端点。
- **渐进增强**：从 LobbyPage 打开已完成的 session（`/notes/{id}`）走现有逻辑，无任何变化；只有 `/notes/new` 路径触发新流程。

### 1.3 改动范围总览

| 层级 | 改什么 | 不改什么 |
|------|--------|----------|
| 路由 (App.tsx) | `/notes/new` 映射到 NotesPage | 其他路由不变 |
| NotesPage | `useEffect` 数据加载区域增加状态机：`upload → processing → ready`；新增 SSE 订阅 hook；新增 UploadModal 组件渲染 | 全部 UI 渲染代码、bullet/transcript/canvas 组件、IndexedDB、SSE 流式扩写等 |
| UploadModal | 从 UploadPage 提取上传表单逻辑为独立 Modal 组件 | UploadPage 保留（向后兼容） |
| 后端 process.py | `_run_pipeline` 拆分为并行任务 + 逐步写 DB + 发布 SSE 事件 | 各 service 内部（audio.py, ppt_parser.py, asr.py, alignment.py, note_generator.py）不变 |
| 后端 sessions.py | 新增 `GET /api/sessions/{id}/events` SSE 端点 | 现有 API 全部保留 |
| DB (db.py) | 新增 `append_page` 辅助函数（read-modify-write 单页追加） | schema 不变 |

---

## 2. 用户流程（6 阶段）

### 阶段 0：LobbyPage

用户点击"+ 新建录音"按钮 → `navigate('/notes/new')`。

**LobbyPage 改动**：仅将 `navigate('/upload')` 改为 `navigate('/notes/new')`。

### 阶段 1：网关弹窗（Gateway Modal）

- URL: `/notes/new`
- NotesPage 检测 `sessionId === 'new'`，进入 `upload` 状态
- 渲染完整的三栏空态布局作为背景（复用现有 `NotesBgShell` 组件）
- 在空态布局上覆盖半透明 scrim（`rgba(20, 24, 22, 0.6)`，与当前 UploadPage 一致）
- scrim 之上居中显示 UploadModal（从 UploadPage 提取的上传表单）
- 背景不可交互（`pointerEvents: 'none'`）

**UploadModal 内容**：
- PPT/PDF 拖拽上传区（可选）
- 音频文件拖拽上传区（必需）
- "开始处理"按钮
- 关闭按钮 → `navigate('/')`（回到 Lobby）
- Escape 键 → 同上

### 阶段 2：弹窗消失 → 全骨架屏

用户点击"开始处理"：
1. 调用 `POST /api/process`，获得 `session_id`
2. `window.history.replaceState` 将 URL 从 `/notes/new` 替换为 `/notes/{session_id}`（无页面刷新）
3. 弹窗和 scrim 消失（`pagePhase` 从 `'upload'` 变为 `'processing'`）
4. NotesPage 建立 SSE 连接 `GET /api/sessions/{session_id}/events`
5. 三栏显示骨架屏/loading 动画：
   - 左栏（缩略图区）：骨架屏矩形 + "正在解析 PPT..."
   - 中栏（canvas 区）：居中 spinner + "正在提取幻灯片..."
   - 右栏（笔记面板）：骨架屏线条 + 标签栏中 AI Notes 和 Transcript 旁各有一个小 spinner

### 阶段 3：PPT 解析完成 → 左栏 + AI Notes 灰色文本填充

SSE 事件：`{"event": "ppt_parsed", "data": {...}}`

前端收到后调用 `getSession(sessionId)` 获取最新数据，更新 `session` state：
- 左栏：缩略图列表渲染，可以点击切换页面
- 中栏：PDF slide 渲染（react-pdf）
- 右栏 AI Notes 标签：显示每个 bullet 的 `ppt_text`，但 `ai_comment` 为 null → 现有代码自然以 `opacity: 0.5` 灰色呈现（[NotesPage.tsx:662-663](frontend/src/pages/NotesPage.tsx#L662-L663)）
- 右栏 AI Notes 标签旁的 spinner 继续转动
- My Notes 标签页可用（写笔记到 IndexedDB）

### 阶段 4：ASR + 语义对齐完成 → Transcript 点亮

SSE 事件：`{"event": "asr_done", "data": {...}}`

前端再次 `getSession(sessionId)` 刷新 `session`：
- Transcript 标签页：`aligned_segments` 填充，可点击播放
- 音频播放器可用（`session.audio_url` 已就绪）
- Transcript 标签旁的 spinner 消失，短暂显示 ✓（1.5 秒后 ✓ 也消失）

### 阶段 5：AI 笔记逐页点亮

SSE 事件序列：`{"event": "page_ready", "data": {"page_num": 1}}`, `{"event": "page_ready", "data": {"page_num": 2}}`, ...

每收到一个 `page_ready`：
- 前端 `getSession(sessionId)` 获取最新 pages 数组
- 对应页面的 bullet `ai_comment` 从 null 变为有内容 → 现有代码 `hasComment` 变为 true → `opacity: 0.5` → `opacity: 1`，带 `transition: 'opacity 0.2s'` 动画
- 如果用户当前正在看这一页，会看到 bullet 文本从灰色平滑过渡到黑色

AI Notes 标签旁的 spinner 持续转动，直到所有页面完成。

### 阶段 6：全部完成

SSE 事件：`{"event": "all_done", "data": {"status": "ready"}}`

- 前端关闭 SSE 连接
- AI Notes 标签旁的 spinner 消失，短暂显示 ✓ 后恢复正常
- 此后 NotesPage 行为与当前版本完全一致

---

## 3. 前端设计

### 3.1 NotesPage 状态机

在现有 NotesPage 组件顶部新增一个 `pagePhase` state：

```typescript
type PagePhase = 'upload' | 'processing' | 'ready'

// sessionId 为 undefined 时（匹配 /notes/new）进入 upload 阶段
// sessionId 存在时，先走现有 loading 逻辑（getSession），
// 如果返回 status==='processing' 则进入 processing 阶段，否则进入 ready 阶段
const [pagePhase, setPagePhase] = useState<PagePhase>(
  sessionId ? 'ready' : 'upload'
)
```

**状态转换**：
- `'upload'` → 用户点击"开始处理"，获得 session_id → `'processing'`
- `'processing'` → SSE 收到 `all_done` 或 `getSession` 返回 `status === 'ready'` → `'ready'`
- `'ready'` → 等价于现有 NotesPage 的正常状态
- 页面刷新恢复：`sessionId` 存在 + `getSession` 返回 `status === 'processing'` → 进入 `'processing'`（建立 SSE 连接）

### 3.2 条件渲染（不改现有代码）

```
if (pagePhase === 'upload'):
  return <NotesBgShell /> + <Scrim /> + <UploadModal />

if (pagePhase === 'processing'):
  // session 数据可能部分就绪
  // 复用现有渲染逻辑，session.pages 有多少渲染多少
  // 没有 pages 时显示骨架屏
  return 现有 NotesPage JSX（session 可能为部分数据）

if (pagePhase === 'ready'):
  return 现有 NotesPage JSX（完整数据，与当前行为一致）
```

关键点：`processing` 和 `ready` 阶段复用同一套 JSX 渲染。区别仅在于：
- `processing` 阶段 session 数据可能不完整（pages 数组可能为空或部分填充）
- 标签栏显示 loading spinner

### 3.3 SSE 订阅 Hook

新增 `useSessionEvents` hook，仅在 `pagePhase === 'processing'` 时激活：

```typescript
function useSessionEvents(sessionId: string | undefined, enabled: boolean, onEvent: (event: SSEEvent) => void) {
  useEffect(() => {
    if (!enabled || !sessionId) return
    const es = new EventSource(`${API_BASE}/api/sessions/${sessionId}/events`)
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      onEvent(data)
    }
    // SSE 断开时降级为轮询（见 Section 5.3）
    es.onerror = () => {
      es.close()
      // 启动 fallback 轮询
      const poll = setInterval(async () => {
        const data = await getSession(sessionId)
        onEvent({ event: '_poll', ...data })
        if (data.status === 'ready' || data.status === 'partial_ready') {
          clearInterval(poll)
          onEvent({ event: 'all_done', status: data.status })
        }
      }, 3000)
      return () => clearInterval(poll)
    }
    return () => es.close()
  }, [sessionId, enabled])
}
```

**onEvent 处理逻辑**：
- 收到任何事件 → `getSession(sessionId)` → `setSession(data)` 更新 UI
- 收到 `all_done` → `setPagePhase('ready')`，关闭 SSE

### 3.4 标签栏 Loading 状态

在现有标签栏渲染代码中，为 AI Notes 和 Transcript 标签旁增加条件渲染的小 spinner：

```typescript
// 派生状态（不新增 state，从 session 数据推导）
const transcriptLoading = pagePhase === 'processing' && !session?.pages?.some(p => p.aligned_segments?.length)
const aiNotesLoading = pagePhase === 'processing' && session?.pages?.some(p => !p.passive_notes?.bullets?.length)
```

标签 JSX 中追加：
```tsx
{transcriptLoading && <Spinner size={10} color="#EC4899" />}
{aiNotesLoading && <Spinner size={10} color="#8B5CF6" />}
```

完成时短暂显示 ✓（1.5 秒后消失），用 `setTimeout` + state 控制。

### 3.5 骨架屏

`processing` 阶段 `session` 为 null 或 pages 为空时的兜底渲染：
- 左栏：3-5 个灰色矩形占位符
- 中栏：居中 spinner
- 右栏：灰色线条占位符

可以复用 `NotesBgShell` 的设计语言，或内联在 NotesPage 的 loading guard 中。

### 3.6 UploadModal 组件

从 UploadPage 提取上传表单逻辑（文件拖拽、验证、提交）为独立组件：

```typescript
interface UploadModalProps {
  onSuccess: (sessionId: string) => void
  onClose: () => void
}
```

- 复用 UploadPage 现有的 UI 设计（弹窗样式、拖拽区域、验证逻辑）
- 调用 `POST /api/process` 上传文件
- 成功后调用 `onSuccess(session_id)`

### 3.7 路由变更

App.tsx：
```tsx
// 新增路由（/notes/new 映射到 NotesPage）
<Route path="/notes/new" element={<NotesPage />} />
// 保留现有路由
<Route path="/notes/:sessionId" element={<NotesPage />} />
```

NotesPage 内部用 `useParams` 获取 `sessionId`。当 `sessionId` 为 `undefined`（匹配 `/notes/new`）时进入 upload 阶段。

注意：需要让 `/notes/new` 路由在 `/notes/:sessionId` 之前匹配。React Router v6 会自动处理这个优先级（静态路径优先于动态参数）。

---

## 4. 后端设计

### 4.1 Pipeline 并行化

将 `_run_pipeline` 中的 Step 1-2（音频转换 + PPT 解析）改为并行执行：

```python
async def _run_pipeline(...):
    # 并行：线程 A (PPT 解析) + 线程 B (音频转换)
    ppt_task = asyncio.create_task(_task_ppt(session_id, ppt_path, session_dir))
    audio_task = asyncio.create_task(_task_audio(session_id, audio_raw_path, session_dir))

    ppt_pages, (wav_path, duration) = await asyncio.gather(ppt_task, audio_task)

    # PPT 完成后立即通知前端（不等 ASR）
    _publish_event(session_id, "ppt_parsed", {"num_pages": len(ppt_pages)})
    # 保存 PPT 页面数据到 session（前端可以 getSession 获取缩略图和 ppt_text）
    db.update_session(session_id, {"pages": _build_initial_pages(ppt_pages)})

    # 串行：ASR → 对齐（依赖音频和 PPT 都完成）
    segments = await _task_asr(session_id, wav_path, language)
    aligned_pages = await _task_alignment(session_id, ppt_pages, segments, user_anchors, duration)

    _publish_event(session_id, "asr_done", {"num_segments": len(segments)})
    db.update_session(session_id, {"pages": aligned_pages, "audio_url": f"/audio/{session_id}/audio.wav"})

    # 逐页生成笔记
    for page in aligned_pages:
        noted_page = await _generate_single_page_note(page)
        db.append_page(session_id, noted_page)
        _publish_event(session_id, "page_ready", {"page_num": page["page_num"]})

    _publish_event(session_id, "all_done", {"status": overall_status})
```

注意：上面是伪代码，说明结构和事件顺序。实际实现需要处理 `run_data` 记录、异常处理、`_save_run_data()` 调用等。

**关键细节**：
- `_task_ppt` 和 `_task_audio` 内部逻辑不变，只是包装为 async task
- PPT 完成后第一次 `update_session` 写入初始 pages 数据（有 ppt_text、pdf_url、thumbnail_url，但无 aligned_segments、无 passive_notes）
- ASR+对齐完成后第二次 `update_session` 补充 aligned_segments
- 笔记逐页生成，每完成一页调用 `append_page` 追加到 pages 数组

### 4.2 初始 Pages 数据结构

PPT 解析完成后，构造初始 pages 数据写入 DB：

```python
def _build_initial_pages(ppt_pages: list[dict]) -> list[dict]:
    return [
        {
            "page_num": p["page_num"],
            "status": "processing",
            "pdf_url": p.get("pdf_url"),
            "pdf_page_num": p.get("pdf_page_num", p["page_num"]),
            "thumbnail_url": p.get("thumbnail_url"),
            "ppt_text": p.get("ppt_text", ""),
            "page_start_time": 0,
            "page_end_time": 0,
            "alignment_confidence": 0,
            "active_notes": None,
            "passive_notes": None,
            "page_supplement": None,
            "aligned_segments": [],
        }
        for p in ppt_pages
    ]
```

前端 NotesPage 收到这个数据时：
- 左栏缩略图可渲染（有 `thumbnail_url`）
- 中栏 PDF 可渲染（有 `pdf_url` + `pdf_page_num`）
- AI Notes 标签可渲染 ppt_text（`passive_notes` 为 null → 现有代码用 `ppt_text` 生成灰色 bullet）
- Transcript 标签 `aligned_segments` 为空 → 显示空态

**注意**：现有 NotesPage AI Notes 的 bullet 数据来自 `passive_notes.bullets`，不是直接从 `ppt_text` 渲染。当 `passive_notes` 为 null 时，现有代码显示"暂无 AI 笔记"空态消息（[NotesPage.tsx:1804-1808](frontend/src/pages/NotesPage.tsx#L1804-L1808)）。

初始 pages 中 `passive_notes` 设为 `null`。前端需要在 NotesPage 的 AI Notes 渲染区增加一小段占位逻辑：

```tsx
// 在现有 AI Notes 空态判断处增加分支
if (!currentPageData.passive_notes && pagePhase === 'processing' && currentPageData.ppt_text) {
  // 渲染 ppt_text 按行分割的灰色占位文本
  return currentPageData.ppt_text.split('\n').filter(Boolean).map((line, i) => (
    <div key={i} style={{ opacity: 0.5, color: C.fg, fontSize: '13px', lineHeight: '1.6' }}>
      • {line}
    </div>
  ))
}
```

当 AI 笔记生成完成后，`passive_notes` 变为有数据 → 现有 bullet 渲染逻辑接管，占位文本被替换为结构化的 AiBulletRow 组件。此时 `ai_comment` 有内容 → `hasComment` 为 true → `opacity: 1`（黑色），带 `transition: 'opacity 0.2s'` 动画。

### 4.3 SSE 事件端点

新增 `GET /api/sessions/{session_id}/events`：

```python
@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str):
    """SSE 端点：推送 session 处理进度事件。"""
    async def event_stream():
        while True:
            event = await _wait_for_event(session_id)
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("event") == "all_done":
                break
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

### 4.4 事件发布/订阅机制

使用 `asyncio.Queue` 实现进程内的 pub/sub：

```python
# 全局事件注册表
_event_queues: dict[str, list[asyncio.Queue]] = {}

def _publish_event(session_id: str, event_type: str, data: dict):
    event = {"event": event_type, **data}
    for q in _event_queues.get(session_id, []):
        q.put_nowait(event)

async def _wait_for_event(session_id: str) -> dict | None:
    q = asyncio.Queue()
    _event_queues.setdefault(session_id, []).append(q)
    try:
        return await asyncio.wait_for(q.get(), timeout=300)  # 5min 超时
    except asyncio.TimeoutError:
        return None
    finally:
        _event_queues[session_id].remove(q)
        if not _event_queues[session_id]:
            del _event_queues[session_id]
```

注意：这是进程内方案，适合单进程部署。如果后续需要多进程，可以替换为 Redis Pub/Sub。

### 4.5 DB 辅助函数

新增 `append_page` 用于逐页追加笔记结果：

```python
def append_page(session_id: str, updated_page: dict):
    """将一个已生成笔记的 page 替换到 session.pages 数组中。"""
    session = get_session(session_id)
    if not session:
        return
    pages = session.get("pages", [])
    page_num = updated_page["page_num"]
    for i, p in enumerate(pages):
        if p["page_num"] == page_num:
            pages[i] = updated_page
            break
    update_session(session_id, {"pages": pages})
```

### 4.6 笔记逐页生成

当前 `generate_notes_for_all_pages` 使用 `asyncio.gather` 并发所有页面。改为逐页串行生成 + 逐页写 DB + 逐页推送 SSE：

```python
for page in aligned_pages:
    noted_page = await generate_notes_for_single_page(page, provider=provider)
    db.append_page(session_id, noted_page)
    _publish_event(session_id, "page_ready", {"page_num": page["page_num"]})
```

注：逐页串行而非并发是有意为之——这样前端能看到清晰的逐页点亮效果。如果并发，所有页面几乎同时完成，失去了渐进感。

### 4.7 SSE 事件类型总览

| 事件 | 触发时机 | data 字段 | 前端动作 |
|------|----------|-----------|----------|
| `ppt_parsed` | PPT 解析完成 | `{num_pages}` | getSession → 渲染缩略图 + PDF + 灰色 bullet |
| `asr_done` | ASR + 语义对齐完成 | `{num_segments}` | getSession → 渲染 transcript + 音频播放器 |
| `page_ready` | 单页笔记生成完成 | `{page_num}` | getSession → 该页 bullet 灰→黑 |
| `all_done` | 全部完成 | `{status}` | 关闭 SSE，移除标签 spinner |
| `error` | 任何步骤失败 | `{message}` | 显示错误提示 |

---

## 5. 错误处理

### 5.1 上传失败
- UploadModal 内显示错误提示，用户可重试
- 不退出弹窗

### 5.2 Pipeline 步骤失败
- 后端发布 `error` 事件
- 前端收到后在当前 UI 中显示错误提示栏（不跳转到 ProcessingPage）
- 提供"重试"按钮

### 5.3 SSE 连接断开
- `EventSource.onerror` 触发时，降级为轮询模式（每 3 秒 `getSession`）
- 当 `session.status` 变为 `ready` 时停止轮询

### 5.4 页面刷新恢复
- 用户在 processing 阶段刷新页面
- URL 已经是 `/notes/{session_id}`
- NotesPage 加载时 `getSession` 获取当前数据
- 检测 `session.status === 'processing'` → 重新建立 SSE 连接，继续渐进加载
- 已完成的部分正常渲染，未完成的部分显示 loading

---

## 6. 向后兼容

| 场景 | 行为 |
|------|------|
| 从 LobbyPage 点击已完成的 session | `navigate('/notes/{id}')` → 现有逻辑，无变化 |
| 直接访问 `/upload` | UploadPage 保留，行为不变（仍跳转到 ProcessingPage） |
| 直接访问 `/processing?session_id=xxx` | ProcessingPage 保留，行为不变 |
| LobbyPage toast 轮询 | 保留，行为不变（检测 ready 后导航到 `/notes/{id}`） |

---

## 7. 不做的事

- 不修改 NotesPage 现有的 UI 组件代码（AiBulletRow、InlineQA、PageChat、SlideCanvas 等）
- 不修改后端各 service 的内部逻辑（audio.py、ppt_parser.py、asr.py、alignment.py、note_generator.py）
- 不修改数据库 schema
- 不删除 UploadPage 或 ProcessingPage（保留向后兼容）
- 不引入 WebSocket（SSE 足够）
- 不引入 Redis 或外部消息队列（asyncio.Queue 进程内方案足够 MVP）
