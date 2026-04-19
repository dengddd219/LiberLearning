# Run Log Viewer — Design Spec

**Date:** 2026-04-19  
**Status:** Approved

---

## 1. 问题与目标

每次 New Class 上传录音 + PPT 后，后台会经历 5 个处理步骤（音频转换、PPT 解析、ASR 转录、语义对齐、笔记生成）。目前出错时用户只能看到前端 toast 提示，无法知道具体哪一步失败、失败原因是什么。

目标：在 LobbyPage 的 SettingsPanel 中提供一个入口，打开 Modal 查看任意 session 的运行日志，看每一步的状态、耗时和关键数字，失败时展示错误信息。

---

## 2. 架构概览

改动分三个独立模块：

```
SettingsPanel (LobbyPage.tsx)
  └─ 「查看运行日志」按钮
       └─ Session 选择列表（inline，复用已有 sessions state）
            └─ RunLogModal.tsx（新建组件）
                  └─ GET /api/sessions/{id}/run-log（新建路由）
                        └─ static/runs/{id}/run_data.json（已有文件）
```

---

## 3. 后端：新路由

**位置：** `backend/routers/sessions.py`（追加，不新建文件）

**端点：** `GET /api/sessions/{session_id}/run-log`

**逻辑：**
1. 拼接路径 `settings.STATIC_DIR / "runs" / session_id / "run_data.json"`
2. 文件存在 → 读取并原样返回 JSON（`Content-Type: application/json`）
3. 文件不存在 → `HTTP 404`，body `{"detail": "run log not found"}`

不做数据转换，前端直接消费 run_data.json 的原始结构。

---

## 4. 前端 API

**位置：** `frontend/src/lib/api.ts`（追加一个函数）

```ts
export async function getRunLog(sessionId: string) {
  return apiGet(`/api/sessions/${sessionId}/run-log`)
}
```

---

## 5. UI：SettingsPanel 入口

**位置：** `LobbyPage.tsx` 的 `SettingsPanel()` 函数（当前约 L996–L1030）

在现有语言设置项下方追加一个新 section：

```
─── 开发工具 ───────────────────────────

查看运行日志                    [选择课程 ▾]

  ▾ 展开后显示 session 列表：
    • 计算机网络第三章（2026-04-17）
    • 数据结构第五讲（2026-04-15）
    • ...
```

交互：
- 点击「选择课程」下拉按钮，展开 session 列表（按 `created_at` 倒序，过滤掉 status=processing 的）
- 点击某条 session → 关闭列表，打开 `RunLogModal`
- Session 列表复用 `LobbyPage` 已有的 `sessions` state，不额外请求

---

## 6. UI：RunLogModal 组件

**位置：** `frontend/src/components/RunLogModal.tsx`（新建）

**触发方式：** SettingsPanel 选中 session 后，Modal 通过 `sessionId` prop 打开，内部自行 fetch `/api/sessions/{id}/run-log`

### 6.1 Modal 结构

```
┌─────────────────────────────────────────────┐
│  运行日志 · {session名称}              [✕]  │
├─────────────────────────────────────────────┤
│  开始时间：2026-04-17 15:12:56              │
│  总耗时：50.18s   整体状态：⚠️ 部分成功     │
│                                             │
│  [Step 1] 音频转换    1.85s    ✅ 成功      │
│  [Step 2] PPT 解析    0.45s    ✅ 成功  4页 │
│  [Step 3] ASR 转录   22.13s   ✅ 成功  31句 │
│  [Step 4] 语义对齐   10.55s   ✅ 成功  4页  │
│  [Step 5] 笔记生成   15.2s    ⚠️ 部分成功  │
│    └─ Page 1 失败 ▸（点击展开错误信息）     │
│         Error code: 401 - ...               │
└─────────────────────────────────────────────┘
```

### 6.2 Step 卡片数据映射

| Step | 显示名 | 关键数字来源 |
|------|--------|-------------|
| step1_audio | 音频转换 | `duration_seconds`（音频时长）|
| step2_ppt | PPT 解析 | `num_pages` |
| step3_asr | ASR 转录 | `num_sentences`（句数）|
| step4_alignment | 语义对齐 | `num_pages` |
| step5_notes | 笔记生成 | `num_pages`，失败页列表来自 `pages_summary[].status === 'error' \| 'partial_ready'` |

### 6.3 状态图标

| status 值 | 图标 | 含义 |
|-----------|------|------|
| `ok` | ✅ | 成功 |
| `error` | ❌ | 失败 |
| `partial_ready` | ⚠️ | 部分成功 |
| `undefined` / step 不存在 | ⏳ | 未执行 |

### 6.4 Step 5 失败页展示

`step5_notes.pages_summary` 中 `status` 为 `error` 或 `partial_ready` 的页，在 Step 5 卡片下方显示折叠列表：

```
  └─ Page 1  ❌  [展开 ▸]
       Error code: 401 - {'type': 'error', 'error': {'type': 'authentication_error'...}}
```

错误文本来自 `step5_notes.generated_pages[n].passive_notes.error`（字段已存在）。

默认折叠，点击展开/收起。错误文本用等宽字体 `font-mono` 显示，最多 3 行，超出可滚动。

### 6.5 加载与错误状态

- 打开 Modal 时立即 fetch，期间显示 spinner
- 404（该 session 没有运行日志，如 mock session）→ 显示「该课程暂无运行日志」
- 其他网络错误 → 显示「加载失败，请重试」+ 重试按钮

---

## 7. 样式规范

沿用 LobbyPage 现有设计语言：
- 背景色：`#FFFFFF`，border-radius `16px`
- 标题字重 900，`#292929`
- 次要文字 `#72726E`
- 成功色（✅）：`#798C00`，错误色（❌）：`#D94F3D`，警告色（⚠️）：`#E8960C`
- Modal overlay：`rgba(0,0,0,0.3)` backdrop
- Modal 宽度：`480px`，最大高度 `70vh`，内容区可滚动

---

## 8. 不改动的部分

- `CardMenu`（卡片三点菜单）不做任何修改
- `DiagnosticsPage` 不做修改
- `run_data.json` 写入逻辑不做修改
- 不增加实时轮询

---

## 9. 文件改动清单

| 文件 | 改动类型 |
|------|---------|
| `backend/routers/sessions.py` | 追加 1 个路由 |
| `frontend/src/lib/api.ts` | 追加 1 个函数 |
| `frontend/src/components/RunLogModal.tsx` | 新建 |
| `frontend/src/pages/LobbyPage.tsx` | SettingsPanel 追加入口 + state |
