# LiberStudy MVP 技术架构设计

> 日期: 2026-04-09 | 状态: 已确认 | 对应 PRD: v0.4

---

## 1. 背景与目标

**目标**：搭建一个可向他人演示的 LiberStudy MVP demo，跑通"上课实时录音 + PPT 上传 → 课后处理 → 查看结构化笔记 → 导出"完整闭环。

**核心约束**：
- 产品负责人不写代码，通过 AI coding 工具（Claude Code）驱动开发
- 优先展示效果，API key 安全性 MVP 阶段可接受妥协
- 先本地跑通，再云端部署
- MVP-0 核心验证目标（假设 B）：ASR 转录 + PPT 内容语义对齐 + LLM 生成的笔记质量是否足够好

---

## 2. 整体架构

### 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React + Vite + Tailwind CSS + shadcn/ui | 遵循 UI-Design-Guide.md 规范 |
| **后端** | FastAPI (Python) | 处理文件上传、ASR、LLM 调用 |
| **本地启动** | concurrently | 一条命令同时启动前后端 |
| **前端部署** | Vercel | git push 自动部署 |
| **后端部署** | Railway | 支持 FastAPI，环境变量管理 API key |
| **文件存储** | Railway 本地磁盘 | demo 阶段够用，V2 迁移 OSS |
| **数据埋点** | PostHog 云端版（Cloud） | 免费额度 100 万事件/月，前端 posthog-js + 后端 PostHog Python SDK |
| **本地持久化** | 前端 IndexedDB | 录音切片、会话草稿、生成完成的结构化笔记全部存于此；无需登录 |

### 架构图

```
用户浏览器（React + Vite）
        ↕ HTTP API
FastAPI 后端（Python）
        ↕
外部 API：阿里云 ASR / OpenAI Whisper / OpenAI text-embedding-3-small / Claude API
```

本地：前端 `localhost:5173`，后端 `localhost:8000`
云端：前端 Vercel URL，后端 Railway URL，通过环境变量 `VITE_API_BASE_URL` 配置

---

## 3. 两阶段开发策略

### 阶段 A：Mock 数据（先跑通界面）

后端 `/api/process-mock` 收到文件后，**不调用任何外部 API**，直接返回预置 JSON。前端基于该 JSON 渲染完整界面、实现所有交互（笔记切换、时间戳跳转、导出）。

**阶段 A 验证目标**：界面流程完整、交互体验符合预期。

### 阶段 B：真实 API（接入处理链路）

后端新增 `/api/process` 接口，实现真实处理链路：
1. LibreOffice 解析 PPTX → 每页 PNG 图片 + 提取文字
2. FFmpeg 转换音频格式（WebM/Opus → WAV）
3. 阿里云 ASR（中文）/ OpenAI Whisper（英文）转录 + 后处理
4. OpenAI text-embedding-3-small 做语义对齐，构建翻页时间轴
5. Claude API 生成结构化笔记（按页独立调用，流式逐页推送）

**关键约束**：阶段 B 的接口返回格式与阶段 A 完全一致，前端零改动。

---

## 4. 核心数据结构

前后端约定的 JSON 格式，前端完全基于此渲染：

```json
{
  "session_id": "abc123",
  "audio_url": "/audio/session.mp3",
  "status": "ready",
  "pages": [
    {
      "page_num": 1,
      "slide_image_url": "/slides/page1.png",
      "page_start_time": 120.5,
      "ppt_text": ["标题", "bullet 1", "bullet 2"],
      "transcript_segment": "老师在这页讲了...",
      "alignment_confidence": 0.87,
      "passive_notes": [
        {
          "bullet": "bullet 1",
          "annotation": "老师补充说明...",
          "timestamp": 125.3
        }
      ],
      "active_notes": "扩写后的用户笔记（有用户批注时）",
      "page_supplement": "老师脱离课件讲的内容",
      "user_annotations": [
        {
          "text": "用户批注文字",
          "timestamp": 130.0,
          "y_position": 0.45
        }
      ]
    }
  ]
}
```

**字段说明**：
- `status`：`ready`（全部完成）/ `partial_ready`（部分页失败）/ `error`（整体失败）
- `audio_url`：音频文件地址，前端播放器加载
- `page_start_time`：该页录音起始时间（秒），用于页面级跳转
- `passive_notes[].timestamp`：该 bullet 注释对应的录音时间（秒），用于 bullet 级精确跳转
- `active_notes`：仅在该页有用户批注时存在，否则为 null
- `page_supplement`：老师脱离 PPT 讲解的内容，可为空字符串
- `alignment_confidence`：0-1，对齐置信度；低于阈值（如 0.6）时前端显示 ⚠️ 标识

---

## 5. 后端 API 接口

| 接口 | 方法 | 阶段 | 说明 |
|------|------|------|------|
| `/api/process-mock` | POST | A | 收到文件，返回固定 mock JSON（3 页预置数据） |
| `/api/process` | POST | B | 真实处理链路：PPT 解析 → ASR → 语义对齐 → LLM |
| `/api/sessions/{id}` | GET | A+B | 获取已处理的笔记结果 |
| `/api/sessions/{id}/page/{page_num}/retry` | POST | B | 单页重试（partial_ready 状态） |
| `/slides/{filename}` | GET | A+B | 静态文件服务，返回 PPT 页面 PNG |
| `/audio/{filename}` | GET | A+B | 静态文件服务，返回音频文件 |

### Mock 数据内容（阶段 A）

固定 3 页，模拟一节真实的课：
- **第 1 页**：有用户批注 → 验证主动学习笔记（`active_notes` 有值）
- **第 2 页**：纯 PPT 讲解 → 验证被动学习笔记（`active_notes` 为 null）
- **第 3 页**：老师脱离课件 → 验证 `page_supplement`（bullet 注释少，supplement 有内容）

---

## 6. 后端核心处理逻辑（阶段 B）

### 6.1 ASR 转录 + 后处理

1. 接收音频文件（WAV，由 FFmpeg 从 WebM/Opus 转换）
2. 调用阿里云 ASR（中文）/ OpenAI Whisper（英文），得到带时间戳的原始逐字稿
3. **后处理**（关键步骤）：
   - 去口头语：过滤"嗯""那个""然后然后"等重复表述
   - 语义修复：修复断句不完整的片段
   - 标点重建：为无标点的 ASR 输出重新断句加标点
   - 输出：精校转录稿（高可读性），保留原始时间戳

### 6.2 翻页时间轴构建（音频-PPT 对齐）

三类锚点综合构建，优先级：**语义匹配 > 用户笔记 > 停留翻页**，均为参考，非硬边界，严禁均分时长。

**① 语义匹配锚点（最强信号）**：
- 使用 OpenAI text-embedding-3-small 对逐字稿按句子或段落切块
- 计算每个切块与每页 PPT 文本的余弦相似度
- 相似度最高的切块时间戳 → 该 PPT 页面的起始时间

**② 用户笔记锚点**：
- 用户在某页 PPT 上创建就地批注时，系统记录的时间戳作为该页的锚点
- 防抖处理：仅记录有效输入（非空、停顿后确认），过滤误触

**③ 停留翻页锚点**：
- 用户在某页停留超过阈值（如 30 秒）后翻到下一页，记录翻页时刻
- 防抖过滤快速翻页（< 5 秒翻页不记录）

**脱离课件检测**：若某时段的最高 PPT 页面相似度低于阈值（如 0.3），该时段内容归入最近一页的 `page_supplement`，不强行对齐任何页面。

**置信度**：每页输出对齐置信度 `alignment_confidence`（0-1），综合最高相似度分数和锚点数量计算。

**current_page 状态机（归属决策）**：纯 argmax 语义匹配会导致时间轴不连续（片段偶然匹配远处旧页），破坏溯回功能。实现时须维护 `current_page` 状态：
- 连续 K=3 个片段最高匹配页 > current_page → 切换（向前翻页）
- 连续 K=3 个片段最高匹配页 = current_page - 1 → 允许切换（老师补充上一页）
- 跨 2 页以上回跳 → 禁止，片段仍归 current_page（老师引用旧页内容时，内容服务于当前页）
- 详见 PRD §"current_page 状态机与对齐策略决策"

### 6.3 笔记生成策略

- **被动学习**（所有页面均生成）：PPT 每页 bullet + 对应精校转录片段 → Claude API 行级对齐，输出每个 bullet 的注释 + 引用时间戳
- **主动学习**（有用户笔记的页面额外叠加）：用户文本批注 + 对应精校转录片段 → Claude API 扩写
- 按页独立调用，最多重试 3 次；部分失败进入 `partial_ready` 状态
- 前端流式逐页渲染：每页生成完成后立即推送，不等待全部完成

### 6.4 使用限制

- 每用户每天最多处理 2 次
- 单次音频最长 120 分钟
- LLM 并发调用上限 ≤ 5

---

## 7. 前端页面规划

### 页面列表

| 页面 | 路由 | 优先级 | 说明 |
|------|------|--------|------|
| 大厅/上课采集界面 | `/session` | **P0（MVP-0 核心）** | 场景②：实时录音 + PPT + 就地批注 |
| 文件上传界面 | `/upload` | P1 | 场景①：上传 PPT + 音频文件 |
| 处理进度界面 | `/processing` | P0 | 线性进度条 + 阶段说明 + 流式逐页渲染 |
| 课后笔记查看界面 | `/notes/:session_id` | P0 | 三栏布局，核心查看体验 |

MVP demo 核心验证路径：`/session` → `/processing` → `/notes/:session_id`

### 上课采集界面（`/session`，P0 核心）

**有 PPT 时**：三栏布局
- **左栏**（可折叠 ~200px）：大纲导航，页码列表，hover 浮出缩略图
- **中栏**（弹性自适应）：PPT 画布（所有页面垂直滚动堆叠），视口占比最大的页面为"当前页"；点击任意位置弹出就地文字框
- **右栏**（固定 ~320px）：顶部录音控制条（开始/暂停/停止/计时），当前页专属笔记区（与中栏批注双向同步）

**无 PPT 时**：两栏布局
- 左侧：录音控制区
- 右侧：自由文本笔记输入区（按话题段落输出，不按 PPT 页面）

**就地文本批注交互**：
- 用户点击中栏 PPT 画面任意位置 → 就地弹出可输入文字框（类 Edge PDF 添加文本）
- 输入确认后以轻量标注样式留在画面对应位置
- 系统自动记录：当前页码 + 录音相对时间戳 + Y 轴位置（0-1 相对坐标）
- 批注内容实时同步到右栏当前页笔记区；右栏输入也反向同步到中栏

### 处理进度界面（`/processing`）

```
阶段一：语音转录中...            ████████░░░░  40%
阶段二：PPT 内容解析中...
阶段三：翻页时间轴构建中...
阶段四：笔记生成中（第 3/18 页）  ██░░░░░░░░░░  15%

预估剩余时间：约 6 分钟
```

- 笔记生成阶段流式逐页推送：每页生成完成后立即在 `/notes` 页面可查看（无需等全部完成）
- 处理失败显示原因 + 重试入口，不扣减使用额度

### 笔记查看界面（`/notes/:session_id`）

遵循 UI-Design-Guide.md §2.4，三栏布局：

| 栏位 | 宽度 | 内容 |
|------|------|------|
| **左栏** | 可折叠 ~200px | 大纲导航，页码列表，hover 浮出缩略图 |
| **中栏** | 弹性自适应 | PPT 画布（展示 slide_image_url + 用户就地批注标记），顶部工具栏，每页右上角"播放原录音"按钮 |
| **右栏** | 固定 ~320px | ① 药丸型笔记切换控件；② 音频播放器（紧凑横条）；③ 当前页笔记内容 |

**partial_ready 状态处理**：失败页面在右栏显示"该页笔记生成失败，点击重试"按钮，支持单页重试（调用 `/api/sessions/{id}/page/{page_num}/retry`）。

**对齐警告**：`alignment_confidence` 低于 0.6 的页面，在页面标题处显示 ⚠️ 标识。

**讲解内容不足提示**：某页对应讲解内容不足 10 秒时，标注"讲解内容较少，建议参考上下页"。

### 音频播放器（右栏，药丸控件下方）

```
[ ◀10s ] [ ▶ 播放 ] [ 10s▶ ]  00:12:34 / 01:28:00  ━━━●━━━━
```

- 点击笔记中的时间戳标签 `[12:34]` → 播放器跳转到对应秒数并播放
- 点击中栏"播放原录音"按钮 → 跳转到 `page_start_time`
- 直接读取 `audio_url`，不依赖后端实时处理

### AI 笔记模板（遵循 UI-Design-Guide.md §4.4）

右栏顶部药丸型分段控件切换"我的笔记 / AI 笔记"：
- **我的笔记**：仅展示用户原始文本批注
- **AI 笔记**：展示 AI 生成内容，雪佛龙下拉提供 4 种模板

| 模板 | 数据来源 | 降级规则 |
|------|---------|---------|
| ① 基于我的笔记扩写 | `active_notes` | 当前页无用户笔记时自动降级为模板② |
| ② 全 PPT 讲解笔记 | `passive_notes` 列表 | — |
| ③ 完整综合笔记 | `passive_notes` + `active_notes` + `page_supplement` | — |
| ④ 大纲摘要 | 所有页面 `passive_notes` 提取核心要点 | — |

所有模板均支持**简单 / 详细**粒度切换（顶部提供切换控件）。

**颜色区分**：用户原始笔记文字 `#000000`（`text-gray-950`）；AI 生成内容 `#374151`（`text-gray-700`）。

---

## 8. 会话中断恢复

前端通过 IndexedDB 持久化录音切片（Blob）和用户笔记：

1. 录音进行中关闭页面 → 自动持久化已录音频切片 + 笔记文字
2. 用户下次打开页面 → 检测 IndexedDB 是否存在未完成会话
3. 若存在 → 显示恢复对话框（显示已录时长 + 已有笔记数量）：
   - **继续录音**：重新开启麦克风，新录音内容拼接到原会话
   - **用现有录音生成笔记**：直接触发课后处理流程
   - **放弃这次录音**：清除 IndexedDB 数据，返回大厅
4. 若不存在 → 直接进入大厅，不显示弹窗

---

## 9. 导出功能

遵循 UI-Design-Guide.md §8，前端实现：

- **Markdown 导出**：
  - 格式：`## 第 N 页：{页面标题}` → bullet 行级注释（`<!-- AI -->` 注释标记）→ 用户笔记以 `> 💡 **[我的笔记]**` 块引用 → page_supplement 补充说明
  - 每条注释附带时间戳引用
  - 文件名：`LiberStudy_{PPT文件名}_{日期}.md`
- **PDF 导出**：jsPDF + html2canvas，与 Markdown 结构一致，不含 PPT 截图；60 页以内 30 秒内完成
- **单页复制**：右栏顶部复制按钮，复制当前页完整笔记 Markdown，1.5 秒 Toast 提示

---

## 10. 数据埋点（PostHog）

接入 PostHog 云端版，前端 `posthog-js` + 后端 PostHog Python SDK。

### 前端埋点事件

| 事件名 | 触发时机 | 关键属性 |
|--------|---------|---------|
| `page_viewed` | 进入大厅页面 | — |
| `session_started` | 用户点击"开始录音" | `has_ppt`, `scene`（①/②） |
| `annotation_added` | 完成一条就地批注 | `page_index`, `annotation_type` |
| `generate_triggered` | 点击"生成笔记" | `recording_duration_seconds`, `annotation_count` |
| `notes_viewed` | 进入笔记查看页 | `session_id` |
| `notes_closed` | 离开笔记查看页 | `time_spent_seconds`, `pages_viewed`, `had_scroll` |
| `template_switched` | 切换 AI 笔记模板 | `from_template`, `to_template` |
| `export_clicked` | 点击导出按钮 | `format`（md/pdf） |
| `rating_submitted` | 提交满意度评分 | `score`（1-5）, `trigger`（scroll/export） |
| `page_retry_clicked` | 点击单页重试 | `page_index` |
| `session_recovery_shown` | 显示中断恢复弹窗 | — |
| `session_recovery_action` | 用户选择恢复操作 | `action`（continue/generate/discard） |

### 后端埋点事件

| 事件名 | 触发时机 | 关键属性 |
|--------|---------|---------|
| `notes_ready` | 全部页面生成成功 | `session_id`, `processing_duration_seconds`, `total_pages` |
| `notes_partial_ready` | 部分页面失败 | `session_id`, `failed_pages`, `total_pages` |
| `notes_error` | 整体处理失败 | `session_id`, `error_stage`（asr/align/llm） |
| `asr_completed` | ASR 转录完成 | `session_id`, `duration_seconds` |
| `cost_per_session` | 处理完成后记录 | `session_id`, `asr_cost_cny`, `llm_cost_usd` |

**满意度弹窗触发时机**：用户在笔记页面停留超过 60 秒且发生过滚动，或点击了"导出"按钮时，弹出轻量 Toast「这份笔记对您有帮助吗？[1-5星]」。

---

## 11. 部署步骤

### 本地开发

```bash
# 安装依赖后，一条命令启动前后端
npm run dev  # concurrently 同时启动前端(:5173) 和后端(:8000)
```

### 云端部署

1. **前端 → Vercel**：连接 GitHub 仓库，设置环境变量 `VITE_API_BASE_URL=<Railway后端URL>`，自动部署
2. **后端 → Railway**：连接 GitHub 仓库，设置 `ANTHROPIC_API_KEY`、`ALICLOUD_ASR_KEY`、`OPENAI_API_KEY`、`POSTHOG_API_KEY` 等环境变量，部署 FastAPI 服务

---

## 12. 目录结构规划

```
LiberLearning/
├── frontend/              # React + Vite 前端
│   ├── src/
│   │   ├── pages/         # Session, Upload, Processing, Notes
│   │   ├── components/    # 三栏布局、播放器、药丸控件、就地批注、恢复弹窗
│   │   └── lib/           # API 调用、导出工具、IndexedDB 操作、PostHog
│   └── package.json
├── backend/               # FastAPI 后端
│   ├── main.py            # 入口，路由注册
│   ├── routers/
│   │   ├── process.py     # /api/process 和 /api/process-mock
│   │   └── sessions.py    # /api/sessions/{id} 和单页重试
│   ├── services/
│   │   ├── asr.py         # ASR 转录 + 后处理服务
│   │   ├── ppt_parser.py  # LibreOffice PPT 解析
│   │   ├── alignment.py   # 音频-PPT 语义对齐（embedding）
│   │   └── note_gen.py    # Claude API 笔记生成
│   ├── mock_data.py       # 阶段 A 预置 mock JSON
│   └── requirements.txt
├── docs/
│   └── superpowers/specs/ # 本文件所在目录
├── package.json           # 根目录，concurrently 配置
└── CLAUDE.md
```

---

## 13. 未在此 Spec 范围内的内容

- **Quick Ask 悬浮球**：P1，AssistiveTouch 风格，V2 用 Electron 实现系统级置顶；MVP 阶段在页面内实现可拖拽悬浮球（不在本次实施计划内，单独 spec）
- **无 PPT 纯笔记模式**：P1，采集界面已规划两栏布局，但按话题段落输出的后端逻辑单独实现
- **用户登录 / 跨设备同步**：V2（届时引入 Google OAuth）
- **跨 session RAG 知识回溯**：V2
- **笔记手动编辑**：V2（MVP 笔记内容只读）
- **混合语言 ASR**：V2
