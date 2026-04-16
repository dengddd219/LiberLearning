# AI Frontpage Ask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在笔记页面每条 bullet 卡片上添加内联问答入口，用户 hover 时显示「针对此条提问」按钮，点击展开问答区，支持多模型流式问答，对话历史存 IndexedDB。

**Architecture:** 后端新增 `POST /api/sessions/:id/ask` 流式 SSE 端点（复用 sessions.py 中已有的 stream_anthropic / stream_openai_compat 辅助函数模式）；前端在 NotesPage.tsx 内新增 `InlineQA` 子组件，嵌入 `AiBulletRow` 的 hover 区域；IndexedDB 存储对话历史，key 为 `[session_id, page_num, bullet_index]`。

**Tech Stack:** FastAPI SSE (后端) · React hooks + IndexedDB (前端) · 已有 PROVIDERS 常量 (`中转站/通义千问/DeepSeek/豆包`)

---

## 文件地图

| 操作 | 路径 | 职责 |
|------|------|------|
| Modify | `backend/routers/sessions.py` | 新增 `POST /sessions/{session_id}/ask` 端点 |
| Create | `backend/prompts/ai_frontpage_ask/prompt.md` | 课助教 system prompt |
| Modify | `frontend/src/lib/api.ts` | 新增 `askBullet()` 流式调用函数 |
| Modify | `frontend/src/pages/NotesPage.tsx` | 新增 `InlineQA` 组件 + hook；改造 `AiBulletRow` |

---

## Task 1：后端 — 创建 prompt 文件

**Files:**
- Create: `backend/prompts/ai_frontpage_ask/prompt.md`

- [ ] **Step 1: 创建目录和 prompt 文件**

```markdown
你是高校课程助教，基于课件原文回答学生问题。

## 课件内容

"""
{{ppt_text}}
"""

---

补充注释：

"""
{{ai_comment}}
"""

---

回答要求：
- 简洁，用中文
- 如涉及公式，用 $...$ 或 $$...$$ 包裹 LaTeX
- 如果原课件没有足够信息回答，诚实说"这页内容没有涉及..."
- 直接回答，不要重复问题
```

路径：`backend/prompts/ai_frontpage_ask/prompt.md`

- [ ] **Step 2: 验证文件存在**

```bash
cat backend/prompts/ai_frontpage_ask/prompt.md
```

Expected: 输出上面 prompt 内容，没有报错。

- [ ] **Step 3: Commit**

```bash
git add backend/prompts/ai_frontpage_ask/prompt.md
git commit -m "feat: add ai_frontpage_ask system prompt"
```

---

## Task 2：后端 — 新增 `/ask` SSE 端点

**Files:**
- Modify: `backend/routers/sessions.py`（在文件末尾追加）

- [ ] **Step 1: 阅读 sessions.py 中已有的 stream_anthropic / stream_openai_compat 模式**

参考 `generate_my_note()` 函数（L220-304），新端点完全复用同样的流式调用模式，只是 system prompt 和 user_msg 构造不同。

- [ ] **Step 2: 在 sessions.py 末尾追加 AskRequest 模型和端点**

在 `sessions.py` 最后一个函数（`get_slide_png`）之后追加：

```python
class AskRequest(BaseModel):
    question: str
    page_num: int
    bullet_index: int
    bullet_text: str
    bullet_ai_comment: str = ""
    model: str = "中转站"


@router.post("/sessions/{session_id}/ask")
async def ask_bullet(session_id: str, req: AskRequest):
    """针对单条 bullet 的流式问答。返回 text/event-stream (SSE)。"""
    from services.note_generator import (
        PROVIDER_ZHONGZHUAN, PROVIDER_ZHIZENGZENG,
        PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_DOUBAO,
        PROVIDERS,
    )

    if req.model not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")

    # 读取 prompt 模板
    prompt_path = Path("prompts/ai_frontpage_ask/prompt.md")
    system_prompt = prompt_path.read_text(encoding="utf-8")
    system_prompt = (
        system_prompt
        .replace("{{ppt_text}}", req.bullet_text.strip())
        .replace("{{ai_comment}}", req.bullet_ai_comment.strip() or "（无）")
    )

    user_msg = req.question.strip()

    import os

    async def stream_anthropic():
        import anthropic as _anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        kwargs = {"base_url": base_url} if base_url else {}
        client = _anthropic.AsyncAnthropic(api_key=api_key, **kwargs)
        model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        async with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'chunk', 'content': text})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    async def stream_openai_compat(base_url: str, api_key: str, model: str):
        import openai as _openai
        client = _openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    if req.model == PROVIDER_ZHONGZHUAN:
        gen = stream_anthropic()
    elif req.model == PROVIDER_QWEN:
        gen = stream_openai_compat(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
            model=os.environ.get("QWEN_MODEL", "qwen-plus"),
        )
    elif req.model == PROVIDER_DEEPSEEK:
        gen = stream_openai_compat(
            base_url="https://api.deepseek.com",
            api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        )
    elif req.model == PROVIDER_DOUBAO:
        gen = stream_openai_compat(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=os.environ.get("VOLC_API_KEY", ""),
            model=os.environ.get("DOUBAO_MODEL", "doubao-pro-4k"),
        )
    elif req.model == PROVIDER_ZHIZENGZENG:
        gen = stream_openai_compat(
            base_url=os.environ.get("OPENAI_BASE_URL", "").strip() or "https://api.openai.com/v1",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
            model=os.environ.get("ANTHROPIC_MODEL", "gpt-4o-mini"),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")

    return StreamingResponse(gen, media_type="text/event-stream")
```

- [ ] **Step 3: 手动验证端点注册（启动后端检查路由列表）**

```bash
cd backend && python -c "from main import app; [print(r.path) for r in app.routes]" | grep ask
```

Expected: 输出包含 `/api/sessions/{session_id}/ask`

- [ ] **Step 4: Commit**

```bash
git add backend/routers/sessions.py
git commit -m "feat: add POST /sessions/:id/ask SSE endpoint"
```

---

## Task 3：前端 — api.ts 新增 `askBullet()`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: 在 api.ts 末尾追加 askBullet 函数**

```typescript
/**
 * 针对单条 bullet 的流式问答。
 * onChunk 每次收到一段文本时回调；resolve 时返回完整文本。
 */
export async function askBullet(
  sessionId: string,
  pageNum: number,
  bulletIndex: number,
  bulletText: string,
  bulletAiComment: string,
  question: string,
  model: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      page_num: pageNum,
      bullet_index: bulletIndex,
      bullet_text: bulletText,
      bullet_ai_comment: bulletAiComment,
      model,
    }),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const parsed = JSON.parse(line.slice(6))
        if (parsed.type === 'chunk' && parsed.content) {
          full += parsed.content
          onChunk(parsed.content)
        }
      } catch { /* ignore malformed */ }
    }
  }
  return full
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add askBullet() SSE helper in api.ts"
```

---

## Task 4：前端 — IndexedDB 工具函数

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`（在文件顶部，AiBulletRow 之前插入）

这些函数直接内联在 NotesPage.tsx 中（不单独抽文件，因为只有这一处用到）。

- [ ] **Step 1: 在 NotesPage.tsx 的 import 区块之后，`const API_BASE = ...` 之前插入 IndexedDB 工具函数**

在 `pdfjs.GlobalWorkerOptions.workerSrc = ...` 之后、`interface Bullet {` 之前插入：

```typescript
// ─── IndexedDB：ask_history 持久化 ───
const DB_NAME = 'liberstudy_ask'
const STORE_NAME = 'ask_history'

function openAskDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME) // key = [session_id, page_num, bullet_index].join(':')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function askKey(sessionId: string, pageNum: number, bulletIndex: number) {
  return `${sessionId}:${pageNum}:${bulletIndex}`
}

async function loadAskHistory(sessionId: string, pageNum: number, bulletIndex: number): Promise<AskMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(askKey(sessionId, pageNum, bulletIndex))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

async function saveAskHistory(sessionId: string, pageNum: number, bulletIndex: number, messages: AskMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ messages }, askKey(sessionId, pageNum, bulletIndex))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}
```

同时在 `interface Bullet { ... }` 之前插入 AskMessage 接口：

```typescript
interface AskMessage {
  role: 'user' | 'ai'
  content: string
  model: string
  timestamp: number
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: add IndexedDB ask_history helpers in NotesPage"
```

---

## Task 5：前端 — InlineQA 组件

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`（在 `AiBulletRow` 函数定义之前插入 `InlineQA` 函数）

- [ ] **Step 1: 在 `function AiBulletRow` 之前插入 InlineQA 组件**

```typescript
// ─── InlineQA：bullet 内联问答区 ───
function InlineQA({
  sessionId,
  pageNum,
  bulletIndex,
  bulletText,
  bulletAiComment,
}: {
  sessionId: string
  pageNum: number
  bulletIndex: number
  bulletText: string
  bulletAiComment: string
}) {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('中转站')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 加载历史记录
  useEffect(() => {
    loadAskHistory(sessionId, pageNum, bulletIndex).then(setMessages)
  }, [sessionId, pageNum, bulletIndex])

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  async function handleSend() {
    const q = input.trim()
    if (!q || streaming) return

    const userMsg: AskMessage = { role: 'user', content: q, model, timestamp: Date.now() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)
    setStreamingText('')

    try {
      let full = ''
      await askBullet(sessionId, pageNum, bulletIndex, bulletText, bulletAiComment, q, model, (chunk) => {
        full += chunk
        setStreamingText(full)
      })
      const aiMsg: AskMessage = { role: 'ai', content: full, model, timestamp: Date.now() }
      const finalMessages = [...newMessages, aiMsg]
      setMessages(finalMessages)
      await saveAskHistory(sessionId, pageNum, bulletIndex, finalMessages)
    } catch (err) {
      const errMsg: AskMessage = { role: 'ai', content: `出错了：${err instanceof Error ? err.message : '未知错误'}`, model, timestamp: Date.now() }
      const finalMessages = [...newMessages, errMsg]
      setMessages(finalMessages)
      await saveAskHistory(sessionId, pageNum, bulletIndex, finalMessages)
    } finally {
      setStreaming(false)
      setStreamingText('')
    }
  }

  return (
    <div style={{
      marginTop: '8px',
      borderRadius: '8px',
      border: `1px solid ${C.divider}`,
      background: C.bg,
      overflow: 'hidden',
    }}>
      {/* 模型选择 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderBottom: `1px solid ${C.divider}` }}>
        <span style={{ fontSize: '9px', color: C.muted, fontWeight: '600', letterSpacing: '0.06em' }}>模型</span>
        {(['中转站', '通义千问', 'DeepSeek', '豆包'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setModel(m)}
            style={{
              padding: '1px 6px', borderRadius: '4px', fontSize: '10px',
              border: `1px solid ${model === m ? C.secondary : C.divider}`,
              background: model === m ? C.sidebar : 'transparent',
              color: model === m ? C.fg : C.muted,
              cursor: 'pointer',
            }}
          >{m}</button>
        ))}
      </div>

      {/* 对话历史 */}
      {(messages.length > 0 || streaming) && (
        <div style={{ maxHeight: '240px', overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.role === 'user' ? C.fg : C.white,
                color: msg.role === 'user' ? C.white : C.fg,
                fontSize: '13px',
                lineHeight: '1.55',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {streaming && streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: '12px 12px 12px 2px',
                background: C.white,
                color: C.fg,
                fontSize: '13px',
                lineHeight: '1.55',
                whiteSpace: 'pre-wrap',
              }}>
                {streamingText}
                <span style={{ opacity: 0.5 }}>▋</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* 输入框 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '6px 10px' }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="针对此条提问… (Enter 发送)"
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', fontSize: '13px', lineHeight: '1.5',
            color: C.fg, fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{
            flexShrink: 0, width: '24px', height: '24px',
            borderRadius: '50%', border: 'none',
            background: streaming || !input.trim() ? C.divider : C.fg,
            color: C.white, cursor: streaming || !input.trim() ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: add InlineQA component for bullet-level Q&A"
```

---

## Task 6：前端 — 改造 AiBulletRow（加 AskButton + InlineQA）

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`，改造 `AiBulletRow` 函数

- [ ] **Step 1: 为 AiBulletRow 新增 props**

找到 `function AiBulletRow({` 的参数定义（L253-272），在 props interface 中追加：

```typescript
  sessionId: string
  pageNum: number
  bulletIndex: number
```

同时在解构列表中追加这三个 prop：

```typescript
function AiBulletRow({
  bullet,
  expanded,
  animationDone,
  onToggle,
  onAnimationDone,
  onTimestampClick,
  translationEnabled,
  translatedPptText,
  translatedAiComment,
  sessionId,         // 新增
  pageNum,           // 新增
  bulletIndex,       // 新增
}: {
  bullet: Bullet
  expanded: boolean
  animationDone: boolean
  onToggle: () => void
  onAnimationDone: () => void
  onTimestampClick: (t: number) => void
  translationEnabled?: boolean
  translatedPptText?: string
  translatedAiComment?: string | null
  sessionId: string            // 新增
  pageNum: number              // 新增
  bulletIndex: number          // 新增
})
```

- [ ] **Step 2: 在 AiBulletRow 中添加 hover 状态和 InlineQA 展开状态**

在函数体开头（`const hasComment = !!bullet.ai_comment` 之前）添加：

```typescript
  const [hovered, setHovered] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
```

- [ ] **Step 3: 在最外层 div 加 hover 事件，并在 AI 解释区域之后插入 AskButton + InlineQA**

找到 `AiBulletRow` return 的最外层 `<div style={{ display: 'flex', flexDirection: 'column', ...`，加上鼠标事件：

```typescript
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: indent }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
```

然后在 AI 解释区域（`{hasComment && ...`）的闭合 `)}` 之后、整个 return 的闭合 `</div>` 之前，插入：

```typescript
      {/* AskButton — hover 时浮现 */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        opacity: hovered || askOpen ? 1 : 0,
        transition: 'opacity 0.15s',
        transform: hovered || askOpen ? 'translateY(0)' : 'translateY(2px)',
      }}>
        <button
          type="button"
          onClick={() => setAskOpen(v => !v)}
          style={{
            padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
            border: `1px solid ${askOpen ? C.secondary : C.divider}`,
            background: askOpen ? C.sidebar : 'transparent',
            color: askOpen ? C.fg : C.muted,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {askOpen ? '收起' : '针对此条提问'}
        </button>
      </div>

      {/* InlineQA 展开区 */}
      {askOpen && (
        <InlineQA
          sessionId={sessionId}
          pageNum={pageNum}
          bulletIndex={bulletIndex}
          bulletText={bullet.ppt_text}
          bulletAiComment={bullet.ai_comment ?? ''}
        />
      )}
```

- [ ] **Step 4: 更新 NotesPage 中 AiBulletRow 的调用处，传入新 props**

找到 NotesPage 内调用 `<AiBulletRow` 的地方（约 L1373），补充三个新 prop：

```tsx
<AiBulletRow
  key={`${currentPage}-${i}`}
  bullet={bullet}
  expanded={expandedBullets.get(currentPage)?.has(i) ?? false}
  animationDone={animatedBullets.get(currentPage)?.has(i) ?? false}
  onToggle={() => { ... }}
  onAnimationDone={() => { ... }}
  onTimestampClick={handleTimestampClick}
  translationEnabled={translationEnabled}
  translatedPptText={translatedTexts.get(currentPage)?.bullets[i]}
  translatedAiComment={translatedTexts.get(currentPage)?.aiComments[i]}
  sessionId={sessionId ?? ''}
  pageNum={currentPage}
  bulletIndex={i}
/>
```

- [ ] **Step 5: 在 api.ts import 区确认 askBullet 已经可以 import（NotesPage 中加 import）**

在 NotesPage.tsx 顶部的 import 行：

```typescript
import { getSession, retryPage, generateMyNote, askBullet } from '../lib/api'
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: wire AskButton + InlineQA into AiBulletRow"
```

---

## Task 7：集成验证

**Files:** 无新文件，验证前面的全部改动

- [ ] **Step 1: 启动后端**

```bash
cd backend && uvicorn main:app --reload --port 8000
```

Expected: 启动成功，没有 import 错误。

- [ ] **Step 2: 验证 /ask 端点可以流式响应**

```bash
curl -N -X POST http://localhost:8000/api/sessions/mock-session-001/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"这个概念的核心是什么？","page_num":1,"bullet_index":0,"bullet_text":"数据链路层是OSI七层模型的第二层","bullet_ai_comment":"负责相邻节点间的帧传输","model":"中转站"}'
```

Expected: 返回一系列 `data: {"type":"chunk","content":"..."}` 行，最后 `data: {"type":"done"}`

- [ ] **Step 3: 启动前端**

```bash
cd frontend && npm run dev
```

Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 4: 浏览器验证 — Golden path**

1. 打开 `http://localhost:5173/notes/mock-session-001`
2. 切换到 AI Notes 面板
3. 鼠标 hover 任意一条 bullet 卡片
4. 右下角出现「针对此条提问」按钮（opacity 从 0→1）
5. 点击按钮，展开 InlineQA 区域，input 自动可输入
6. 输入问题，按 Enter 发送
7. AI 流式回答显示（streaming indicator ▋ 跳动）
8. 回答完成后持久显示；切换 page 再切回，点击「针对此条提问」，历史记录恢复

- [ ] **Step 5: 验证多 bullet 独立对话**

对第1条和第3条 bullet 各打开问答区，确认对话互不干扰（各自独立的 IndexedDB key）。

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete AI frontpage ask feature - inline Q&A per bullet"
```

---

## 自检：规格覆盖

| 规格条目 | 实现位置 |
|---------|---------|
| hover bullet 浮现 AskButton（opacity + 微动） | Task 6 Step 3：transition + translateY |
| 点击展开 InlineQA，input 聚焦 | Task 5：inputRef（因 autoFocus 在 textarea 出现时自动聚焦） |
| 收起按钮 | Task 6 Step 3：按钮文字切换「针对此条提问」/「收起」 |
| 多 bullet 同时展开独立对话 | 每个 AiBulletRow 自持 askOpen state |
| 模型选择（中转站/通义/DeepSeek/豆包） | Task 5：InlineQA 模型选择按钮 |
| Enter 发送，Shift+Enter 换行 | Task 5：onKeyDown 逻辑 |
| 流式 SSE 响应 | Task 2：stream_anthropic / stream_openai_compat |
| IndexedDB 对话历史持久化 | Task 4：loadAskHistory / saveAskHistory |
| system prompt（课助教角色） | Task 1：prompt.md |
| `POST /api/sessions/:id/ask` API | Task 2：sessions.py 端点 |
| ppt_text + ai_comment 组装 prompt | Task 2：system_prompt 变量替换 |
| 前端 askBullet() 辅助函数 | Task 3：api.ts |
