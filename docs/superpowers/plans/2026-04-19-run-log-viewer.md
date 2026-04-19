# Run Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 LobbyPage SettingsPanel 中加入「查看运行日志」入口，用户选择 session 后弹出 Modal 展示 5 个处理步骤的状态、耗时和关键数字，失败时展示错误信息。

**Architecture:** 后端新增一个只读路由 `GET /api/sessions/{id}/run-log`，直接返回已有的 `static/runs/{id}/run_data.json`。前端新建 `RunLogModal.tsx` 组件，`LobbyPage.tsx` 的 `SettingsPanel` 中追加 session 选择器触发 Modal。

**Tech Stack:** FastAPI (Python), React + TypeScript, Tailwind CSS (inline styles 风格，与现有 LobbyPage 保持一致)

---

## File Map

| 文件 | 改动 |
|------|------|
| `backend/routers/sessions.py` | 追加 1 个路由（约 10 行） |
| `frontend/src/lib/api.ts` | 追加 `getRunLog` 函数（约 3 行） |
| `frontend/src/components/RunLogModal.tsx` | 新建，~180 行 |
| `frontend/src/pages/LobbyPage.tsx` | SettingsPanel 函数内追加入口 + 2 个 state（约 60 行） |

---

## Task 1: 后端路由 — GET /api/sessions/{session_id}/run-log

**Files:**
- Modify: `backend/routers/sessions.py`（在文件末尾追加）

- [ ] **Step 1: 在 sessions.py 末尾追加路由**

打开 `backend/routers/sessions.py`，在文件最末尾追加：

```python
@router.get("/sessions/{session_id}/run-log")
async def get_run_log(session_id: str):
    run_log_path = Path("static") / "runs" / session_id / "run_data.json"
    if not run_log_path.exists():
        raise HTTPException(status_code=404, detail="run log not found")
    with open(run_log_path, encoding="utf-8") as f:
        return _json.load(f)
```

注意：`Path` 和 `HTTPException` 已在文件顶部 import（第 1、4 行），`json` 以别名 `_json` 存在……但实际看文件顶部导入的是 `import json`（无别名），需确认：

实际 sessions.py 顶部是 `import json`，所以路由里用 `json.load(f)`：

```python
@router.get("/sessions/{session_id}/run-log")
async def get_run_log(session_id: str):
    run_log_path = Path("static") / "runs" / session_id / "run_data.json"
    if not run_log_path.exists():
        raise HTTPException(status_code=404, detail="run log not found")
    with open(run_log_path, encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 2: 手动测试路由**

确保后端正在运行（`uvicorn main:app --reload` 在 `backend/` 目录）。

在浏览器或终端访问：
```
GET http://localhost:8000/api/sessions/27e70b5b-bc36-4353-9530-f8fef7abe7a4/run-log
```
（用 `backend/static/runs/` 下任意一个真实的 session_id）

预期：返回 JSON，包含 `session_id`、`started_at`、`steps` 字段。

访问不存在的 session_id：
```
GET http://localhost:8000/api/sessions/nonexistent-id/run-log
```
预期：HTTP 404，`{"detail": "run log not found"}`

- [ ] **Step 3: Commit**

```bash
cd backend
git add routers/sessions.py
git commit -m "feat: add GET /api/sessions/{id}/run-log endpoint"
```

---

## Task 2: 前端 API 函数

**Files:**
- Modify: `frontend/src/lib/api.ts`（在 `retryPage` 函数后追加）

- [ ] **Step 1: 追加 getRunLog 函数**

在 `frontend/src/lib/api.ts` 的 `retryPage` 函数后（约第 42 行后）追加：

```ts
export async function getRunLog(sessionId: string): Promise<unknown> {
  return apiGet(`/api/sessions/${sessionId}/run-log`)
}
```

注意：返回类型用 `unknown` 而非具体接口，因为 `run_data.json` 结构在后端定义，前端 RunLogModal 内部做字段访问时用 `as any` 或局部类型断言即可，不需要在 api.ts 里维护完整类型。

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add getRunLog API function"
```

---

## Task 3: RunLogModal 组件

**Files:**
- Create: `frontend/src/components/RunLogModal.tsx`

- [ ] **Step 1: 创建 RunLogModal.tsx**

创建 `frontend/src/components/RunLogModal.tsx`，完整内容如下：

```tsx
import { useState, useEffect } from 'react'
import { getRunLog } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface PageSummary {
  page_num: number
  status: string
  num_bullets?: number
}

interface GeneratedPage {
  page_num: number
  passive_notes?: { error?: string; bullets?: unknown[] }
  status?: string
}

interface StepData {
  status: string
  elapsed_s?: number
  duration_seconds?: number
  num_pages?: number
  num_sentences?: number
  pages_summary?: PageSummary[]
  generated_pages?: GeneratedPage[]
}

interface RunLog {
  session_id: string
  started_at: string
  finished_at?: string
  overall_status: string
  error?: string
  steps: {
    step1_audio?: StepData
    step2_ppt?: StepData
    step3_asr?: StepData
    step4_alignment?: StepData
    step5_notes?: StepData
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: string | undefined) {
  if (status === 'ok') return <span style={{ color: '#798C00' }}>✅</span>
  if (status === 'error') return <span style={{ color: '#D94F3D' }}>❌</span>
  if (status === 'partial_ready') return <span style={{ color: '#E8960C' }}>⚠️</span>
  return <span style={{ color: '#A8A8A0' }}>⏳</span>
}

function statusLabel(status: string | undefined) {
  if (status === 'ok') return '成功'
  if (status === 'error') return '失败'
  if (status === 'partial_ready') return '部分成功'
  return '未执行'
}

function elapsed(s: number | undefined) {
  if (s == null) return '—'
  return `${s.toFixed(2)}s`
}

function totalElapsed(log: RunLog): string {
  const steps = Object.values(log.steps)
  const total = steps.reduce((sum, s) => sum + (s?.elapsed_s ?? 0), 0)
  return `${total.toFixed(2)}s`
}

// ── Step Row ──────────────────────────────────────────────────────────────────

function StepRow({
  label,
  step,
  extra,
  failedPages,
}: {
  label: string
  step: StepData | undefined
  extra?: string
  failedPages?: { page_num: number; error: string }[]
}) {
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set())

  function togglePage(n: number) {
    setExpandedPages(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', borderRadius: '10px',
        backgroundColor: '#F2F2EC',
      }}>
        <span style={{ width: '20px', flexShrink: 0 }}>{statusIcon(step?.status)}</span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: '#292929' }}>{label}</span>
        {extra && (
          <span style={{ fontSize: '12px', color: '#72726E' }}>{extra}</span>
        )}
        <span style={{ fontSize: '12px', color: '#72726E', minWidth: '52px', textAlign: 'right' }}>
          {elapsed(step?.elapsed_s)}
        </span>
        <span style={{ fontSize: '12px', color: '#72726E', minWidth: '60px', textAlign: 'right' }}>
          {statusLabel(step?.status)}
        </span>
      </div>

      {failedPages && failedPages.length > 0 && (
        <div style={{ paddingLeft: '16px', marginTop: '4px' }}>
          {failedPages.map(fp => (
            <div key={fp.page_num} style={{ marginBottom: '4px' }}>
              <button
                onClick={() => togglePage(fp.page_num)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '12px', color: '#D94F3D', padding: '4px 0',
                }}
              >
                <span>❌ Page {fp.page_num}</span>
                <span style={{ color: '#A8A8A0' }}>{expandedPages.has(fp.page_num) ? '▾' : '▸'}</span>
              </button>
              {expandedPages.has(fp.page_num) && (
                <div style={{
                  fontFamily: 'monospace', fontSize: '11px', color: '#72726E',
                  backgroundColor: '#F9F9F6', borderRadius: '6px',
                  padding: '8px', maxHeight: '72px', overflowY: 'auto',
                  wordBreak: 'break-all', marginTop: '2px',
                }}>
                  {fp.error || '（无错误信息）'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function RunLogModal({
  sessionId,
  sessionName,
  onClose,
}: {
  sessionId: string
  sessionName: string
  onClose: () => void
}) {
  const [log, setLog] = useState<RunLog | null>(null)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await getRunLog(sessionId) as RunLog
      setLog(data)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      setError(msg.includes('404') ? 'not_found' : 'network')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [sessionId])

  // 计算 step5 失败页
  function getFailedPages(log: RunLog): { page_num: number; error: string }[] {
    const step5 = log.steps.step5_notes
    if (!step5) return []
    const failedSummary = (step5.pages_summary ?? []).filter(
      p => p.status === 'error' || p.status === 'partial_ready'
    )
    return failedSummary.map(ps => {
      const gen = (step5.generated_pages ?? []).find(g => g.page_num === ps.page_num)
      return {
        page_num: ps.page_num,
        error: gen?.passive_notes?.error ?? '',
      }
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '480px', maxHeight: '70vh', backgroundColor: '#FFFFFF',
          borderRadius: '16px', display: 'flex', flexDirection: 'column',
          fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden',
          boxShadow: '0px 24px 48px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #E3E3DA',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 900, color: '#292929' }}>运行日志</div>
            <div style={{ fontSize: '12px', color: '#72726E', marginTop: '2px' }}>{sessionName}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '18px', color: '#72726E', padding: '4px',
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#A8A8A0', padding: '32px 0', fontSize: '13px' }}>
              加载中…
            </div>
          )}

          {!loading && error === 'not_found' && (
            <div style={{ textAlign: 'center', color: '#A8A8A0', padding: '32px 0', fontSize: '13px' }}>
              该课程暂无运行日志
            </div>
          )}

          {!loading && error === 'network' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '13px', color: '#D94F3D', marginBottom: '12px' }}>加载失败，请重试</div>
              <button
                onClick={load}
                style={{
                  padding: '6px 16px', borderRadius: '9999px', border: 'none',
                  backgroundColor: '#F2F2EC', fontSize: '12px', cursor: 'pointer', color: '#292929',
                }}
              >重试</button>
            </div>
          )}

          {!loading && !error && log && (
            <>
              {/* Meta */}
              <div style={{
                display: 'flex', gap: '16px', marginBottom: '16px',
                fontSize: '12px', color: '#72726E',
              }}>
                <span>开始：{log.started_at}</span>
                <span>总耗时：{totalElapsed(log)}</span>
                <span>状态：{statusIcon(log.overall_status)} {statusLabel(log.overall_status)}</span>
              </div>

              {/* Steps */}
              <StepRow
                label="Step 1 · 音频转换"
                step={log.steps.step1_audio}
                extra={log.steps.step1_audio?.duration_seconds
                  ? `音频 ${(log.steps.step1_audio.duration_seconds / 60).toFixed(1)}min`
                  : undefined}
              />
              <StepRow
                label="Step 2 · PPT 解析"
                step={log.steps.step2_ppt}
                extra={log.steps.step2_ppt?.num_pages != null
                  ? `${log.steps.step2_ppt.num_pages} 页`
                  : undefined}
              />
              <StepRow
                label="Step 3 · ASR 转录"
                step={log.steps.step3_asr}
                extra={log.steps.step3_asr?.num_sentences != null
                  ? `${log.steps.step3_asr.num_sentences} 句`
                  : undefined}
              />
              <StepRow
                label="Step 4 · 语义对齐"
                step={log.steps.step4_alignment}
                extra={log.steps.step4_alignment?.num_pages != null
                  ? `${log.steps.step4_alignment.num_pages} 页`
                  : undefined}
              />
              <StepRow
                label="Step 5 · 笔记生成"
                step={log.steps.step5_notes}
                extra={log.steps.step5_notes?.num_pages != null
                  ? `${log.steps.step5_notes.num_pages} 页`
                  : undefined}
                failedPages={getFailedPages(log)}
              />

              {/* Top-level error */}
              {log.error && (
                <div style={{
                  marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
                  backgroundColor: '#FEF2F2', fontSize: '12px', color: '#D94F3D',
                  fontFamily: 'monospace', wordBreak: 'break-all',
                }}>
                  {log.error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/RunLogModal.tsx
git commit -m "feat: add RunLogModal component"
```

---

## Task 4: LobbyPage SettingsPanel 入口

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`

改动点有两处：
1. `SettingsPanel` 函数签名：需要接收 `sessions` 和设置 `runLogSessionId` 的回调
2. `LobbyPage` 主函数：加 2 个 state，传 props 给 SettingsPanel，渲染 RunLogModal

- [ ] **Step 1: 修改 SettingsPanel 函数签名和内容**

找到 `function SettingsPanel()` （约 L996），将其改为接收 props：

```tsx
function SettingsPanel({
  sessions,
  onOpenRunLog,
}: {
  sessions: CourseCard[]
  onOpenRunLog: (sessionId: string) => void
}) {
  const { uiLang, setUiLang, t } = useTranslation()
  const [logPickerOpen, setLogPickerOpen] = useState(false)
  const availableSessions = sessions
    .filter(s => s.status !== 'processing')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return (
    <div style={{ padding: '48px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ fontSize: '24px', fontWeight: 900, color: '#292929', marginBottom: '40px' }}>
        {t('settings_title')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '480px' }}>
        {/* 语言设置（原有，保持不变） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#292929' }}>
            {t('settings_language_label')}
          </span>
          <div style={{ display: 'inline-flex', backgroundColor: '#F2F2EC', borderRadius: '9999px', padding: '4px', gap: '4px' }}>
            {(['en', 'zh'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setUiLang(lang)}
                style={{
                  padding: '6px 20px', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
                  backgroundColor: uiLang === lang ? '#FFFFFF' : 'transparent',
                  color: uiLang === lang ? '#292929' : '#72726E',
                  boxShadow: uiLang === lang ? '0px 1px 2px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {lang === 'en' ? t('settings_lang_en') : t('settings_lang_zh')}
              </button>
            ))}
          </div>
        </div>

        {/* 开发工具分区 */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#A8A8A0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
            开发工具
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#292929' }}>查看运行日志</span>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setLogPickerOpen(v => !v)}
                style={{
                  padding: '6px 14px', borderRadius: '9999px', border: '1px solid #E3E3DA',
                  fontSize: '13px', fontWeight: 500, color: '#292929', cursor: 'pointer',
                  backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                选择课程 <span style={{ fontSize: '10px', color: '#72726E' }}>{logPickerOpen ? '▲' : '▼'}</span>
              </button>
              {logPickerOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                  backgroundColor: '#FFFFFF', borderRadius: '12px', zIndex: 100,
                  boxShadow: '0px 8px 24px rgba(0,0,0,0.10)', minWidth: '240px',
                  maxHeight: '280px', overflowY: 'auto', padding: '4px',
                }}>
                  {availableSessions.length === 0 && (
                    <div style={{ padding: '12px 16px', fontSize: '13px', color: '#A8A8A0' }}>
                      暂无课程
                    </div>
                  )}
                  {availableSessions.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setLogPickerOpen(false)
                        onOpenRunLog(s.id)
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: '8px', border: 'none',
                        fontSize: '13px', color: '#292929', cursor: 'pointer',
                        backgroundColor: 'transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(47,51,49,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div style={{ fontWeight: 500 }}>{s.course}</div>
                      {s.lecture && (
                        <div style={{ fontSize: '11px', color: '#A8A8A0', marginTop: '1px' }}>{s.lecture}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 LobbyPage 主函数里加 state 和 RunLogModal 渲染**

找到 `export default function LobbyPage()` 内的 state 区（约 L1128-L1134），在现有 state 后追加：

```tsx
const [runLogSessionId, setRunLogSessionId] = useState<string | null>(null)
const runLogSession = sessions.find(s => s.id === runLogSessionId)
```

找到渲染 `<SettingsPanel />` 的地方（约 L1522），改为传 props：

```tsx
<SettingsPanel sessions={sessions} onOpenRunLog={setRunLogSessionId} />
```

在 LobbyPage 的 JSX return 最末尾（`</div>` 闭合前），追加 Modal 渲染：

```tsx
{runLogSessionId && runLogSession && (
  <RunLogModal
    sessionId={runLogSessionId}
    sessionName={runLogSession.course}
    onClose={() => setRunLogSessionId(null)}
  />
)}
```

在文件顶部 import 区追加：

```tsx
import RunLogModal from '../components/RunLogModal'
```

- [ ] **Step 3: 确认 CourseCard 里有 createdAt 字段**

检查文件里 `CourseCard` 类型定义（Grep `interface CourseCard` 或 `type CourseCard`），确认 `createdAt` 字段名。如果字段名不是 `createdAt`，将 Step 1 里的 `.sort()` 改为正确字段名。

查看 `listSessions` 返回类型（api.ts L58-L68），API 返回 `created_at`；再看 `CourseCard` 定义里对应的映射字段名，用实际字段名替换 `createdAt`。

- [ ] **Step 4: 在浏览器里测试**

1. 启动前后端（`npm run dev` 在根目录，或分别启动）
2. 打开 LobbyPage，点左侧导航「设置」
3. 找到「开发工具 · 查看运行日志」，点「选择课程」下拉
4. 选择一个已处理完成的 session
5. 确认 Modal 弹出，展示 5 个 Step 卡片，耗时和状态正确
6. 点 Modal 背景或 ✕ 关闭
7. 选择 mock session（若有），确认显示「该课程暂无运行日志」

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx frontend/src/components/RunLogModal.tsx
git commit -m "feat: add run log viewer to SettingsPanel"
```

---

## Self-Review

**Spec coverage:**
- ✅ 后端路由 GET /api/sessions/{id}/run-log（Task 1）
- ✅ 前端 getRunLog API（Task 2）
- ✅ RunLogModal 5个Step卡片 + 状态图标 + 耗时 + 关键数字（Task 3）
- ✅ Step 5 失败页折叠展示（Task 3 StepRow）
- ✅ 加载/404/网络错误状态（Task 3）
- ✅ SettingsPanel 入口 + session 选择列表（Task 4）
- ✅ 样式沿用 LobbyPage 设计语言（Task 3、4）

**Placeholder scan:** 无 TBD/TODO，所有代码均完整。

**Type consistency:**
- `getRunLog` 返回 `unknown`，RunLogModal 内 cast 为 `RunLog` ✅
- `StepData`、`RunLog`、`PageSummary`、`GeneratedPage` 接口在 RunLogModal.tsx 内定义，未跨文件引用 ✅
- `onOpenRunLog: (sessionId: string) => void` 与 `setRunLogSessionId` 签名兼容 ✅

**边界情况：**
- Task 4 Step 3 提醒检查 `createdAt` 字段名，避免排序静默失效 ✅
