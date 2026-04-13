# LiberStudy API Specification

> 版本：v0.1 | 日期：2026-04-13  
> 基础 URL：`http://localhost:8000`（开发环境）

---

## 通用约定

- 请求体编码：`multipart/form-data`（上传接口）或无 body
- 响应体编码：`application/json`
- 时间单位：**秒（s）**，全部相对于音频开始的绝对时间点，除非特别注明
- `pdf_url`：以 `/slides/` 开头的**相对路径**，前端需拼接基础 URL（如 `http://localhost:8000/slides/xxx.pdf`）
- `audio_url`：以 `/audio/` 开头的**相对路径**，同上

---

## Endpoints

### `GET /health`

全局健康检查。

**Response**

```json
{ "status": "ok" }
```

---

### `GET /api/process/health`

process router 健康检查。

**Response**

```json
{ "status": "ok", "router": "process" }
```

---

### `GET /api/sessions/health`

sessions router 健康检查。

**Response**

```json
{ "status": "ok", "router": "sessions" }
```

---

### `POST /api/process-mock`

Phase A mock：忽略上传文件，直接返回固定 `session_id`，用于前端联调。

**Request** (`multipart/form-data`)

| 字段    | 类型       | 必填 | 说明           |
|---------|------------|------|----------------|
| `ppt`   | file       | 否   | PPT 文件（被忽略） |
| `audio` | file       | 否   | 音频文件（被忽略） |

**Response**

```json
{ "session_id": "mock-session-001" }
```

---

### `POST /api/process`

Phase B 真实处理：接收音频和 PPT，立即返回 `session_id`，后台异步运行完整 pipeline（ASR → 对齐 → LLM 笔记生成）。

**Request** (`multipart/form-data`)

| 字段           | 类型   | 必填 | 说明                                           |
|----------------|--------|------|------------------------------------------------|
| `audio`        | file   | 是   | 音频文件（WebM/Opus/MP3/WAV/M4A 均支持）       |
| `ppt`          | file   | 否   | PPT 或 PDF 文件（缺省则进入"无 PPT 模式"）     |
| `language`     | string | 否   | 音频语言，`"en"`（默认）或 `"zh"`              |
| `user_anchors` | string | 否   | JSON 字符串，手动锚点数组，默认 `"[]"`         |

`user_anchors` 结构（每个元素）：

```json
{
  "page_num": 3,
  "timestamp": 180.5
}
```

**Response（立即返回）**

```json
{ "session_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**错误响应**

| HTTP 状态码 | 场景                               |
|-------------|-----------------------------------|
| `429`       | 同一 IP 每天超过 2 次调用限制       |

---

### `GET /api/sessions/{session_id}`

轮询 session 状态和结果。

> **前端轮询约定**：建议每 **3 秒**轮询一次。当 `status` 变为 `"ready"` / `"partial_ready"` / `"error"` 时停止轮询。

**Path 参数**

| 参数         | 类型   | 说明      |
|--------------|--------|-----------|
| `session_id` | string | session ID |

**Response**

```json
{
  "session_id":      "550e8400-e29b-41d4-a716-446655440000",
  "status":          "ready",
  "ppt_filename":    "计算机网络第三章.pptx",
  "audio_url":       "/audio/550e8400.../audio.wav",
  "total_duration":  5400,
  "error":           null,
  "pages":           [ /* PageResult[] */ ]
}
```

#### Session 顶层字段

| 字段             | 类型          | Nullable | 说明                                                            |
|------------------|---------------|----------|-----------------------------------------------------------------|
| `session_id`     | string        | 否       | session 唯一 ID（UUID 或 `"mock-session-001"`）                 |
| `status`         | string (enum) | 否       | 见下方状态枚举                                                   |
| `ppt_filename`   | string        | 是       | 用户上传的 PPT 原始文件名；无 PPT 时为 `null`                    |
| `audio_url`      | string        | 是       | 音频相对路径（`/audio/<session_id>/audio.wav`）；处理中为 `null` |
| `total_duration` | number (int)  | 否       | 音频总时长，单位：秒                                             |
| `progress`       | object        | 是       | 仅当 `status = "processing"` 时存在；结构为 `{"step": string, "percent": number}` |
| `error`          | string        | 是       | 仅当 `status = "error"` 时存在；其他状态为 `null` 或字段缺失    |
| `pages`          | PageResult[]  | 否       | 笔记页面列表；处理中为 `[]`                                      |

#### `status` 枚举

| 值              | 含义                                              | 前端行为                           |
|-----------------|---------------------------------------------------|------------------------------------|
| `"processing"`  | 后台 pipeline 仍在运行                            | 继续轮询                           |
| `"ready"`       | 所有页面 LLM 生成成功                             | 停止轮询，渲染笔记                  |
| `"partial_ready"` | 至少一页 LLM 生成失败，其余页面正常             | 停止轮询，渲染成功页面 + 失败页单页重试按钮 |
| `"error"`       | pipeline 抛出未捕获异常 或 音频超过 120 分钟限制  | 停止轮询，显示全局错误提示          |

---

#### `PageResult` 结构

```json
{
  "page_num":             1,
  "status":               "ready",
  "pdf_url":              "/slides/550e8400.../slides_550e8400....pdf",
  "pdf_page_num":         1,
  "ppt_text":             "第三章 数据链路层\n• 功能与服务\n...",
  "page_start_time":      0,
  "page_end_time":        1200,
  "alignment_confidence": 0.92,
  "active_notes": {
    "user_note":    "老师说这章是重点，期末必考",
    "ai_expansion": "数据链路层是OSI七层模型第二层..."
  },
  "passive_notes": {
    "bullets": [
      {
        "text":       "帧的结构包含首部、数据和尾部三部分",
        "ai_comment": "此处老师重点强调了帧边界的定界作用",
        "timestamp":  45
      }
    ]
  },
  "page_supplement": null,
  "error":           null
}
```

#### `PageResult` 字段说明

| 字段                   | 类型          | Nullable | 说明                                                                                     |
|------------------------|---------------|----------|------------------------------------------------------------------------------------------|
| `page_num`             | number (int)  | 否       | 页码，从 1 开始                                                                          |
| `status`               | string (enum) | 否       | `"ready"` 或 `"partial_ready"`（该页 LLM 全部重试失败）                                  |
| `pdf_url`              | string        | 是       | PDF 文件相对路径（`/slides/<session_id>/slides_<session_id>.pdf`）；无 PPT 时为 `null`   |
| `pdf_page_num`         | number (int)  | 是       | 该 slide 对应 PDF 的页码（1-based）；无 PPT 时为 `null`                                  |
| `ppt_text`             | string        | 否       | 从 PPT 提取的纯文本内容；无 PPT 时为 `""`                                                |
| `page_start_time`      | number        | 否       | 该页讲解起始时间，单位：秒，相对于音频开始的绝对时间                                      |
| `page_end_time`        | number        | 否       | 该页讲解结束时间，单位：秒，相对于音频开始的绝对时间                                      |
| `alignment_confidence` | number        | 否       | 对齐置信度，范围 [0, 1]，为该页 aligned_segments 的平均 cosine 相似度                    |
| `active_notes`         | object        | 是       | 主动学习笔记；用户没有手写笔记时为 `null`                                                 |
| `passive_notes`        | object        | 是       | 被动学习笔记（AI 全程讲解提炼）；LLM 失败时为 `null` 或空                                |
| `page_supplement`      | string        | 是       | 老师离开 PPT 期间（如开 VSCode）的内容补充；通常为 `null`                                 |
| `error`                | string        | 是       | 仅当该页 `status = "partial_ready"` 时存在，包含失败原因                                 |

#### `active_notes` 结构

| 字段          | 类型   | Nullable | 说明                                  |
|---------------|--------|----------|---------------------------------------|
| `user_note`   | string | 否       | 用户手写的课堂批注原文                |
| `ai_expansion`| string | 否       | AI 基于用户批注展开的解释             |

#### `passive_notes` 结构

| 字段      | 类型     | Nullable | 说明              |
|-----------|----------|----------|-------------------|
| `bullets` | Bullet[] | 否       | 按时间顺序排列的笔记条目 |

#### `Bullet` 结构

| 字段              | 类型          | Nullable | 说明                                                                                       |
|-------------------|---------------|----------|--------------------------------------------------------------------------------------------|
| `text`            | string        | 否       | AI 提炼的笔记正文                                                                           |
| `ai_comment`      | string        | 是       | AI 对该条目的补充说明（可空）                                                               |
| `timestamp_start` | number (int)  | 否       | 对应音频起始时间点，单位：秒，相对于整段音频开始的绝对时间                                  |
| `timestamp_end`   | number (int)  | 否       | 对应音频结束时间点，单位：秒，相对于整段音频开始的绝对时间                                  |

---

### `GET /api/rate-limit/status`

返回当前 IP 在滚动 24 小时窗口内的调用次数状态。

**Response**

```json
{ "used": 1, "limit": 2, "remaining": 1 }
```

---

### `POST /api/sessions/{session_id}/page/{page_num}/retry`

对单个生成失败的页面重新运行 LLM 笔记生成。

**Path 参数**

| 参数         | 类型   | 说明      |
|--------------|--------|-----------|
| `session_id` | string | session ID |
| `page_num`   | int    | 页码（1-based） |

**Response（成功）**

```json
{
  "status": "ok",
  "page":   { /* PageResult */ }
}
```

**错误响应**

| HTTP 状态码 | 场景                        |
|-------------|-----------------------------|
| `404`       | session 不存在或页码不存在  |

---

## 静态资源

静态资源通过 FastAPI 的 `StaticFiles` 挂载，**不经过 API 路由**，直接返回文件内容。

| 路径前缀  | 物理目录           | 示例 URL                                          |
|-----------|--------------------|---------------------------------------------------|
| `/slides` | `static/slides/`   | `http://localhost:8000/slides/<session_id>/slides_<session_id>.pdf` |
| `/audio`  | `static/audio/`    | `http://localhost:8000/audio/<session_id>/audio.wav` |

**注意：** 真实 pipeline 生成的 PDF 存储在 `static/slides/<session_id>/`，前端构造 URL 时需在相对路径前拼接 `http://localhost:8000`（或生产环境的域名）。

---

## 前端轮询流程示意

```
POST /api/process → { session_id }
        ↓
每 3 秒 GET /api/sessions/{session_id}
        ↓
status = "processing"  → 继续轮询
status = "ready"       → 渲染全部页面，停止
status = "partial_ready" → 渲染成功页面，失败页面显示重试按钮，停止
status = "error"       → 显示全局错误提示，停止
```

---

## 前端对接前后端问题清单

> 以下问题需在开始前端开发前由人工决策优先级。  
> 标记 **[阻塞]** 表示不解决会导致功能完全不可用；**[影响体验]** 表示存在降级风险；**[建议]** 表示非必要但建议修复。

---

### P0：字段不一致导致运行时出错

**问题 1 [阻塞] `passive_notes.bullets` 字段名 mock vs 真实不一致**

- **是什么**：mock 数据（`sessions.py`）中 bullet 结构为 `{text, ai_comment, timestamp}`；而真实 pipeline（`note_generator.py` 的 LLM 输出）用的是 `{timestamp_start, timestamp_end}` 两个字段，单个 `timestamp` 不存在于真实数据中。
- **为什么前端需要它**：前端需要用时间戳跳转音频播放位置。如果用 mock 开发完，对接真实 API 时数据取不到，逻辑全挂。
- **建议解决方向**：统一字段名。推荐把真实结构（`timestamp_start` + `timestamp_end`）定为规范，同步更新 mock 数据和 api-spec.md。也可在 api-spec.md 中明确注明两字段并要求后端保持一致。

---

**问题 2 [阻塞] mock 数据 page 缺少 `status` 字段，真实 page 有**

- **是什么**：真实 pipeline 每个 page dict 都有 `status: "ready" | "partial_ready"`；mock 数据的 page 没有这个字段，只有 session 顶层有 `status`。
- **为什么前端需要它**：前端判断"该页是否需要显示重试按钮"依赖 `page.status === "partial_ready"`，如果 mock 里没有，联调时会误认为一切正常。
- **建议解决方向**：在 `sessions.py` 的 MOCK_SESSION 每个 page 加上 `"status": "ready"`，以及至少一页加 `"status": "partial_ready"` 用于测试重试 UI。

---

### P1：数据可用性问题

**问题 3 [阻塞] session 存纯内存，重启即失**

- **是什么**：`_SESSIONS` 是 `process.py` 顶层的 `dict[str, dict]`，服务重启后所有 session 丢失。
- **为什么前端需要它**：开发和测试期间频繁重启后端，前端会拿到 404，需要重新跑完整流水线（ASR + LLM），很耗时。生产环境用户刷新页面后笔记也会消失。
- **建议解决方向（开发阶段）**：将 session 序列化到 JSON 文件（如 `static/sessions/<session_id>.json`），启动时从磁盘恢复。生产阶段再替换成真正的 DB。

---

**问题 4 [影响体验] `pdf_url` 是相对路径，前端需要自己拼接 base URL**

- **是什么**：`pdf_url` 形如 `/slides/<session_id>/xxx.pdf`，不含域名。前端需要知道后端的 base URL 才能构造完整 URL 供 PDF.js 加载。
- **为什么前端需要它**：PDF.js 和 `<iframe>` 都需要完整 URL，直接用相对路径在 React 中不会自动解析到后端域名（前端跑在 5173 端口，后端在 8000 端口）。
- **建议解决方向**：两选一：  
  ① 后端返回完整 URL（最清晰，但耦合了 host 配置）；  
  ② 前端统一维护 `VITE_API_BASE_URL` 环境变量，所有相对路径前拼接该值（推荐，前后端独立）。

---

**问题 5 [影响体验] `audio_url` 同样是相对路径，音频播放依赖完整 URL**

- **是什么**：`audio_url` 形如 `/audio/<session_id>/audio.wav`，与 `pdf_url` 问题相同。
- **为什么前端需要它**：HTML `<audio>` 元素 `src` 需要完整 URL；点击时间戳跳转音频功能也依赖这个。
- **建议解决方向**：与问题 4 同方案，统一在前端用 `VITE_API_BASE_URL` 拼接。

---

**问题 6 [影响体验] `pages` 数组在 `processing` 期间为 `[]`，前端无法提前渲染骨架**

- **是什么**：后端在 pipeline 全部完成后才一次性写入 `pages`，中间状态始终是空数组。
- **为什么前端需要它**：如果能拿到 PPT 总页数（或 page 骨架），前端可以在 processing 状态下渲染"N 页正在生成中"的占位骨架，体验更好。
- **建议解决方向**：pipeline 完成 PPT 解析（Step 2）后，立即把 page 骨架（只含 `page_num`, `pdf_url`, `ppt_text`, `status: "processing"`）写入 session，等 LLM 生成完再补充 `passive_notes`/`active_notes`。这需要后端改动，可以作为 P2。

---

### P2：接口设计改进

**问题 7 [建议] 没有 `POST /api/process` 的请求参数校验，错误信息不友好**

- **是什么**：`audio` 为必填项，但当前代码没有类型/格式校验；`language` 接受任意字符串；`user_anchors` JSON 解析失败时静默降级为 `[]`。
- **为什么前端需要它**：前端上传错误文件格式时需要明确的错误提示（非 500），否则用户不知道是什么问题。
- **建议解决方向**：添加 Pydantic 请求体校验或在函数入口明确校验 `language in ("zh", "en")`，不合法时返回 HTTP 422 + 明确错误字段。

---

**问题 8 [建议] 没有进度信息，前端轮询只能"盲等"**

- **是什么**：`status: "processing"` 期间没有进度百分比或当前步骤（ASR 中/对齐中/LLM 生成中），用户只能看着 loading spinner 等。
- **为什么前端需要它**：ASR + LLM 全程可能 2-5 分钟，缺乏反馈容易让用户以为卡死。
- **建议解决方向**：在 session 上增加 `progress` 字段（如 `{step: "asr", percent: 40}`），pipeline 每完成一步就更新。前端轮询时展示"正在转录语音 40%"这样的文案。

---

**问题 9 [建议] Rate limiter 存内存，重启清零，且 IP 可绕过**

- **是什么**：`_rate_store` 每次重启清零，导致限流完全无效；用 IP 限制可被 VPN/代理绕过；两个数据结构（`_SESSIONS` 和 `_rate_store`）都在同一进程内，无法多实例扩展。
- **为什么前端需要它**：前端在显示"今天已用完次数"提示时，需要可靠的后端数据；如果后端限流不可信，前端无法做状态管理。
- **建议解决方向**：MVP 阶段可以接受现状（内存限流 + 重启清零），但需要在前端展示剩余次数时由后端返回（在 session 创建响应或独立 endpoint 中返回 `{used: 1, limit: 2}`）。

---

### 汇总

| # | 问题 | 优先级 | 影响 | 建议操作方 |
|---|------|--------|------|-----------|
| 1 | bullet 字段名 mock vs 真实不一致 | ✅ 已修复 | — | 已统一为 `timestamp_start`/`timestamp_end` |
| 2 | mock page 缺 `status` 字段 | P0 阻塞 | 重试 UI 无法联调 | 后端更新 mock |
| 3 | session 存内存，重启即失 | P1 阻塞 | 开发效率极低 | 后端加文件持久化 |
| 4 | `pdf_url` 相对路径，PDF 渲染挂 | P1 阻塞 | PDF 画布无法加载 | 前端加 base URL 拼接 |
| 5 | `audio_url` 相对路径，音频挂 | P1 阻塞 | 音频播放 + 时间戳跳转挂 | 前端加 base URL 拼接 |
| 6 | processing 期间 pages 为空 | P2 体验 | 无法渲染骨架 | 后端分步写入（可推迟）|
| 7 | 没有请求参数校验 | P2 建议 | 错误提示不友好 | 后端加 422 校验 |
| 8 | 没有 pipeline 进度信息 | P2 体验 | 盲等体验差 | 后端加 progress 字段 |
| 9 | Rate limiter 不可信 | P3 建议 | 次数显示不准 | 后端加次数 endpoint |
