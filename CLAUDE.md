# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## language
You must use Chinese to communicate with the user!

## Project Overview

**LiberStudy** is a multimodal lecture knowledge structuring tool. It aligns instructor speech (ASR transcription) with PPT slides on a per-page basis, producing structured study notes anchored to individual PPT pages.

Core flow: User uploads PPT + records audio in-browser (or uploads audio file) → ASR transcription with timestamps → user note anchors + semantic alignment builds per-page timeline → LLM generates structured notes per PPT page → outputs in a tri-pane view (slide nav + PPT canvas + notes panel).

## Current State

The product requirements document is in `LiberStudy-PRD.md` (v0.4). Backend code is under `backend/` (FastAPI). Frontend is not yet started.

## MVP-0 Scope

MVP-0 focuses on **Scene ② (real-time in-class recording)** as the core, with **Scene ① (post-class audio upload)** as P1. Scenes ③④ (video/screen capture) are deferred to V2.

## Planned Tech Stack (decided)

- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Backend**: FastAPI (Python)
- **PPT Parsing & Rendering**: LibreOffice (headless, converts .ppt/.pptx to PDF) + PyMuPDF (text extraction + PNG rendering)
- **Audio Format Conversion**: FFmpeg (WebM/Opus → WAV for ASR APIs)
- **Chinese ASR**: Alibaba Cloud ASR API
- **English ASR**: Alibaba Cloud ASR API (same as Chinese, supports `language_id: en-us`; OpenAI Whisper is the fallback only)
- **Semantic Alignment**: OpenAI text-embedding-3-small
- **Note Generation**: Claude API (claude-sonnet)
- **Deployment**: Cloud deployment (frontend + backend separated), API keys in server-side environment variables

## Target Users

- **Primary — 小林 (STEM university student)**: 985/211 undergrad, PPT-heavy technical courses (formulas, code, architecture diagrams), high AI tool adoption, goal: get structured notes per PPT page without replaying recordings.
- **Secondary — 小陈 (humanities university student)**: economics/law/journalism, PPT-light (concepts, cases), medium tech savviness, goal: capture teacher's oral elaboration (cases, opinions) not shown on PPT.
- **Tertiary — Alex (professional, post-MVP)**: 3-5 years in internet/consulting, attends PPT-driven meetings, needs structured meeting minutes with action items.

The product language is Chinese.

## Key MVP-0 Features (P0)

1. In-class real-time recording (browser microphone) with inline text annotation on PPT (click to create text label in-place, no pin/connector line)
2. PPT file upload and parsing (.ppt/.pptx/.pdf via LibreOffice + PyMuPDF)
3. ASR transcription with timestamps + post-processing (filler word removal, semantic repair, punctuation reconstruction)
4. User note anchors + semantic alignment for per-page timeline (debounced anchor + semantic similarity calibration; supports non-linear lecture flow)
5. Structured note generation via LLM (passive learning: all pages; active learning: additive on pages with user notes)
6. Tri-pane viewing interface (slide nav + PPT canvas + notes panel) with pill-style "My Notes | AI Notes" toggle; AI Notes side provides 4 template options + simple/detailed granularity switch

## Key MVP-0 Features (P1)

- **Post-class audio file upload** (Scene ①): MP3/WAV/M4A upload + optional manual page-timestamp anchoring
- **Quick Ask (课中实时辅助)**: AssistiveTouch-style floating ball, draggable, semi-transparent, snaps to screen edge; click to open chat, ask "what did the teacher just say?" — AI answers from streaming ASR cache without triggering batch processing. V2: Electron desktop client for system-level overlay. Trigger shortcut: input "？" to auto-summarize recent N minutes.
- **No-PPT mode**: recording + free-text notes only; output structured by topic paragraphs instead of PPT pages
- **Note export**: Markdown (primary) + PDF (secondary)

## Key Design Decisions

- **PPT is optional**: Without PPT → active learning only (user notes + transcript). With PPT → passive learning added (AI aligns transcript to slides)
- **PPT browsing**: Vertical scroll (all pages stacked, like a webpage), not left/right pagination
- **Data persistence**: IndexedDB (frontend for audio chunks and session drafts); cloud DB for processed structured notes and session metadata
- **Export**: Markdown (primary) + PDF (secondary, jsPDF + html2canvas, frontend-only)
- **Passive learning is the base layer**: all pages always get notes; active learning (user-note-based expansion) is additive on top
- **Teacher off-slide detection**: periods where teacher leaves the PPT (e.g., opens VSCode) are not force-aligned; content goes into `page_supplement` of the most recent page
- **Alignment signal priority**: ASR transcript × PPT text semantic similarity is the strongest signal; time-axis ordering is a soft prior, not a hard constraint

## Classroom Behavior Observations (Field Research)

These observations directly inform product design decisions:

| ID | Observation | Product Implication |
|----|-------------|---------------------|
| **S1** | Students rarely stay focused on PPT full-time; they drift to phone/other tabs but need to know where the teacher is | Quick Ask floating ball must persist without requiring user to stay on LiberStudy page; MVP: in-page draggable AssistiveTouch ball; V2: Electron system-level overlay |
| **S2** | When a student zones out and returns, the most urgent need is "what did I miss just now" — a single "？" is enough | Quick Ask "？" shortcut for auto-summarizing recent N minutes is a high-frequency critical need; prioritize response speed and context quality |
| **T1** | Teachers often read from PPT text, and largely follow PPT page order | ASR × PPT semantic similarity is the strongest alignment signal; time-axis ordering is a useful soft prior |
| **T2** | Teachers frequently leave the PPT for minutes (e.g., live coding in VSCode) before returning | System must detect "off-slide mode"; those segments go to `page_supplement`, not force-aligned to any page |
| **T3** | Teachers reference prior lecture content ("as we covered last class..."), creating context gaps for students | Cross-session knowledge recall is a V2 feature (Agent + RAG over historical sessions) |

## Constraints

- MVP: single language only (Chinese or English), no mixed-language support
- One PPT per audio (no multi-PPT support)
- Per-user limits: max 2 sessions/day, max 120 minutes per audio
- Cloud deployment; audio/PPT files cleaned after processing, structured notes stored in cloud DB
- Session interruption recovery: audio chunks persisted to IndexedDB; on next page open, if an incomplete session exists, show recovery modal (continue / generate with existing / discard)
- Partial failure strategy: LLM note generation is per-page with up to 3 retries; partial success enters `partial_ready` state with per-page retry buttons; ASR/alignment failure enters `error` state

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. LiberStudy Codebase Map

快速导航文档。告别每次都要重新翻代码找文件。

---

### 核心流水线：Step 1–5

| Step | 功能 | 生产代码 | Streamlit 测试入口 |
|------|------|----------|--------------------|
| Step 1 | 音频格式转换（any → 16kHz WAV） | `backend/services/audio.py` | test_ui/pipeline.py Step 0 |
| Step 2 | PPT 解析（PPTX→PDF→文本提取） | `backend/services/ppt_parser.py` | test_ui/pipeline.py Step 1 |
| Step 3 | ASR 转录（Whisper / 阿里云） | `backend/services/asr.py` | test_ui/pipeline.py Step 2 |
| Step 4 | 语义对齐（ASR 段落 → PPT 页面） | `backend/services/alignment.py` | test_ui/pipeline.py Step 3 |
| Step 5 | LLM 笔记生成（Claude） | `backend/services/note_generator.py` | test_ui/pipeline.py Step 4–5 |

流水线串联调用入口：`backend/routers/process.py` → `_run_pipeline()`

---

## 6.  完整文件地图

### 入口 & 路由

| 文件 | 作用 |
|------|------|
| `backend/main.py` | FastAPI app 工厂，挂载路由、静态目录、CORS |
| `backend/routers/process.py` | `POST /api/process`（真实流水线）+ `POST /api/process-mock` + 单页重试 |
| `backend/routers/sessions.py` | `GET /api/sessions/{id}`，mock 数据也在这里硬编码 |
| `backend/routers/live.py` | WebSocket `/ws/live-asr`（流式 ASR）+ `POST /api/live/explain`（SSE Claude 解释）+ live session CRUD（start/stop/finalize/state）+ detailed-note |
| `backend/routers/diagnostics.py` | `GET /api/diagnostics`：全流程健康检查，逐步测试每个关键节点 |

### Services（核心逻辑）

| 文件 | 作用 |
|------|------|
| `backend/services/audio.py` | FFmpeg 封装：格式转换、chunk 合并、时长获取 |
| `backend/services/ppt_parser.py` | LibreOffice→PDF + PyMuPDF 文本提取 + 术语抽取 |
| `backend/services/asr.py` | Whisper API（支持 >25MB 分段）+ 阿里云 stub |
| `backend/services/alignment.py` | **当前生产对齐算法**：embedding cosine + K=3 debounce + 锚点约束 |
| `backend/services/events.py` | SSE 事件 pub/sub（asyncio.Queue，单进程；多 worker 需换 Redis Pub/Sub） |
| `backend/services/step3_alignment_test/` | 对齐算法实验版本集合（10个版本 + utils），测试平台 strategy dropdown 用 |
| `backend/services/step3_alignment_test/alignment_utils.py` | 共享工具函数：`apply_time_mask` |
| `backend/services/step3_alignment_test/alignment_v1.py` | V1 — 单遍扫描（argmax，无 debounce） |
| `backend/services/step3_alignment_test/alignment_v1_1.py` | V1.1 — 单遍扫描 + 时间约束 |
| `backend/services/step3_alignment_test/alignment_v1_2.py` | V1.2 — 单遍扫描 + 后处理平滑 |
| `backend/services/step3_alignment_test/alignment_v2.py` | V2 — K=3去抖 + 升级（D-004 快照） |
| `backend/services/step3_alignment_test/alignment_v2_1.py` | V2.1 — K=3去抖 + 时间约束 |
| `backend/services/step3_alignment_test/alignment_v3a.py` | V3a — 三分类（逻辑词规则） |
| `backend/services/step3_alignment_test/alignment_v3a_1.py` | V3a.1 — 三分类（逻辑词规则）+ 时间约束 |
| `backend/services/step3_alignment_test/alignment_v3b.py` | V3b — 三分类（滑窗 embedding） |
| `backend/services/step3_alignment_test/alignment_v3b_1.py` | V3b.1 — 三分类（滑窗 embedding）+ 时间约束 |
| `backend/services/step3_alignment_test/alignment_v4.py` | V4 — 两阶段状态机 + 防抖 |
| `backend/services/bullet_alignment.py` | 实验性 bullet 级对齐（Method A/B/C） |
| `backend/services/note_generator.py` | Claude 笔记生成：4模板×2粒度 + 批注扩写 `generate_annotations()` |
| `backend/services/judge.py` | LLM-as-a-Judge 评分（完整性/准确性/可读性 1–5 分） |
| `backend/services/live_store.py` | Live session SQLite 持久化（`live_data.db`）：sessions/segments/annotations/page_states 四表 CRUD |
| `backend/services/live_note_builder.py` | Live 课堂 AI 笔记生成：`stream_notes()`（SSE 流式）+ `generate_detailed_note()`（逐行详解）|

### Prompts

| 文件 | 对应模板 |
|------|----------|
| `backend/prompts/passive_ppt_notes/prompt.md` | Template 2：全PPT讲解笔记（按 bullet 加时间戳） |
| `backend/prompts/passive_outline_summary/prompt.md` | Template 4：大纲摘要 |
| `backend/prompts/active_expand/prompt.md` | Template 1：基于我的笔记扩写 |
| `backend/prompts/active_comprehensive/prompt.md` | Template 3：完整综合笔记 |

每个 prompt 目录同级还有 `v1_baseline.py`（测试平台 prompt A/B 用）。

### 测试平台（Streamlit）

| 文件 | 作用 |
|------|------|
| `backend/test_app.py` | Streamlit 入口，侧边栏 + 4个 Tab |
| `backend/test_ui/pipeline/` | **Pipeline Tab（已拆包）** — 先读 `pipeline/MAP.md`，再按 Step 查对应文件 |
| `backend/test_ui/pipeline/MAP.md` | Pipeline package 地图：各文件职责、依赖关系、数据流 |
| `backend/test_ui/pipeline/__init__.py` | 入口：`render_pipeline()` — 组装 Step 0–6 + Issues |
| `backend/test_ui/pipeline/step0_audio.py` | Step 0：音频上传 & WAV 转换 |
| `backend/test_ui/pipeline/step1_ppt.py` | Step 1：PPT 解析 + 缩略图 |
| `backend/test_ui/pipeline/step2_asr.py` | Step 2：ASR 转录 |
| `backend/test_ui/pipeline/step3_alignment.py` | Step 3：语义对齐 A/B 策略对比 + Transcript Timeline |
| `backend/test_ui/pipeline/step4_notes.py` | Step 4：笔记生成（模板/粒度/策略锁定） |
| `backend/test_ui/pipeline/step5_active.py` | Step 5：主动学习测试（PPT 画面 + 标注 + AI 扩写） |
| `backend/test_ui/pipeline/step6_export.py` | Step 6：导出（Markdown + PDF） |
| `backend/test_ui/pipeline/issues.py` | Issues & Findings：流水线诊断面板 |
| `backend/test_ui/helpers.py` | 共享常量（成本价格、路径工具、策略注册表、UI 工具函数） |
| `backend/test_ui/align_compare.py` | Step 3 内嵌的对齐版本 diff 组件 |
| `backend/test_ui/dashboard.py` | Dashboard Tab（成本/延迟汇总、按运行对比） |
| `backend/test_ui/ground_truth.py` | Ground Truth Tab（人工标注工具） |
| `backend/test_ui/batch.py` | Batch Tab（stub，让用户直接跑 test_batch.py） |

启动命令：`launch_test_platform.bat` 或 `streamlit run backend/test_app.py`

### 独立测试脚本

| 文件 | 类型 | 用途 |
|------|------|------|
| `backend/test_note_generator_off_slide.py` | pytest | 验证 off-slide 虚拟页面注入逻辑（mock Claude API） |
| `backend/test_ppt_parser_pdf.py` | 手动集成测试 | 验证 parse_ppt() 输出 pdf_url + pdf_page_num（不是旧 PNG 字段） |
| `backend/test_batch.py` | 批量跑 | 多音频+PPT 对跑完整流水线，输出 test_output/batch_results.json |
| `backend/转录工具选择模块一asr_benchmark.py` | ASR 基准测试 | 多引擎（Whisper/阿里/讯飞/Azure）对比，输出到 asr_benchmark_results/ |

### 测试数据 & 输出

| 路径 | 内容 |
|------|------|
| `backend/test_documents/lec01/` | 测试文档1：19 张 slide PNG + WAV（1min/10min）+ asr/ppt 缓存 |
| `backend/test_documents/test1/` | 测试文档2：PDF 格式 slides + WAV + asr/ppt 缓存 |
| `backend/test_output/ground_truth.json` | 人工标注 ground truth（跨 run 共享） |
| `backend/test_output/run_default/` | 默认 run 产物：aligned_pages（V1/V2/current）+ notes（多模板）+ run_log + meta |
| `backend/test_output/run_20260410_215548/` | 时间戳 run（旧 PNG 格式存档） |
| `backend/test_output/run_new_chunking_v1/` | 新 PDF 格式 run 产物 |
| `backend/asr_benchmark_results/` | ASR benchmark 输出（含 summary.json） |

### 配置文件

| 文件 | 内容 |
|------|------|
| `backend/.env` | 真实密钥（不提交）：OPENAI_API_KEY, ANTHROPIC_API_KEY, ALIYUN_*, FRONTEND_ORIGIN |
| `backend/.env.example` | 所有环境变量模板 |
| `backend/requirements.txt` | Python 依赖 |
| `package.json`（根） | concurrently 脚本，同时启动前后端 |
| `install_deps.bat` | Windows 安装 FFmpeg + LibreOffice |

### 产品 & 设计文档

| 文件 | 内容 |
|------|------|
| `LiberStudy-PRD.md` | PRD v0.4（完整产品需求） |
| `UI/reference/UI-Design-Guide.md` | 前端 UI/UX 设计规范（已迁移至 UI/reference/） |
| `CHANGELOG.md` | 项目变更记录 |
| `step.md` | SDD 流程模板（AI 编码提示用） |
| `wrong-log.md` | AI 编码历史错误记录 |

### 人工阅读笔记（`人，读一下/`）

| 文件 | 内容 |
|------|------|
| `人，读一下/0410进度.md` | 4月10日进度快照：已完成 vs 缺失 vs 阻塞项 |
| `人，读一下/[急]测试平台决策全过程.md` | 测试平台选型决策记录 |
| `人，读一下/项目难点.md` | 项目技术难点汇总 |
| `人，读一下/面试思考.md` | 面试准备思考 |

### 技术规格 & 实现计划（`docs/superpowers/`）

| 文件 | 内容 |
|------|------|
| `docs/superpowers/specs/2026-04-09-mvp-architecture-design.md` | 技术栈决策 + 架构图 + 两阶段策略 |
| `docs/superpowers/specs/2026-04-09-mvp-implementation-plan.md` | MVP 实现计划 |
| `docs/superpowers/specs/2026-04-11-align-compare-design.md` | align_compare 组件设计规格 |
| `docs/superpowers/specs/2026-04-11-history-run-view-design.md` | 历史运行视图设计规格 |
| `docs/superpowers/specs/2026-04-11-step5-active-learning-canvas-design.md` | Step 5 主动学习画布设计（数据结构 + API 格式） |
| `docs/superpowers/plans/2026-04-11-step5-active-learning-canvas.md` | Step 5 升级实现计划（任务清单） |
| `docs/superpowers/plans/2026-04-11-align-compare.md` | align_compare 实现计划 |
| `docs/superpowers/plans/2026-04-11-history-run-view.md` | 历史运行视图实现计划 |

---

###  PRD 章节速查（`LiberStudy-PRD.md`）

| 章节 | 行号 | 内容 |
|------|------|------|
| §1 Executive Summary | L8 | 产品一句话定义 + 核心价值 |
| §2 Problem Statement | L26 | 谁有问题、问题是什么、为什么痛、课堂行为观察 |
| §3 Target Users & Personas | L77 | 小林（理工本科）/ 小陈（文商本科）/ Alex（职场，MVP后） + JTBD |
| §4 Strategic Context | L122 | 业务目标、市场机会、竞品分析、Why Now |
| §5 Solution Overview | L161 | 产品形态、UI 原则、输入场景、核心用户流程、关键特性、技术选型、API 成本 |
| §5 技术栈决策 | L285 | 系统架构图 + 技术栈表 + 部署方式 |
| §5 API 成本面板 | L341 | ASR/LLM/Embedding 成本 + 单节课总成本估算 |
| §6 Success Metrics | L388 | 北极星指标、漏斗指标、质量诊断、行为洞察、Guardrail、埋点方案 |
| §7 User Stories | L523 | Epic Hypothesis + Story 1A（课中录音）/ 1A-2（中断恢复）/ 1B（课后上传）/ 2（进度）/ 3A（被动学习）/ 3B（主动学习）/ 4（导出）+ 约束 |
| §8 Out of Scope | L667 | MVP 明确不做 + 未来可考虑 |
| §9 Dependencies & Risks | L691 | 技术依赖、外部依赖、风险与应对 |
| §10 核心技术挑战 | L729 | 对齐问题详解、场景②数据流、current_page 状态机、行级笔记生成、Quick Ask、无 PPT 模式、场景① |
| §11 UI 规格 | L1074 | 三栏布局、手动批注动线、AI 笔记视图切换、数据状态规范、Quick Ask 浮窗、持久化与导出、大厅工作台 |
| §12 Open Questions | L1395 | 待决策 + 已决策记录 |
| 附录A V2 规划 | L1416 | 场景③视频上传、场景④实时网课（均延后） |

---

### 前端

#### 入口 & 配置

| 路径 | 内容 |
|------|------|
| `frontend/src/App.tsx` | React app 根组件，路由定义：`/` → LobbyPage，`/live` → LivePage，`/processing` → ProcessingPage，`/notes/new` + `/notes/:sessionId` → NotesPage，`/notes/detail/:sessionId` → DetailedNotePage，`/diagnostics` → DiagnosticsPage |
| `frontend/vite.config.ts` | Vite 配置 |
| `frontend/package.json` | React + Vite + Tailwind + shadcn/ui 依赖 |

#### Pages

| 路径 | 内容 |
|------|------|
| `frontend/src/pages/LobbyPage.tsx` | 大厅工作台：侧边栏 + session 卡片网格/列表视图切换。Icons(L7) / CardMenu 三点菜单(L103) / CourseCard 接口(L199) / ProcessingCard(L237) / DoneCard 网格卡片(L267) / ListRow 列表行(L342) / ListTable(L426) / ProcessingToast(L473) / SettingsPanel(L597) / LobbyPage state(L651) / handleRename(L655) / handleDelete(L664) / toast轮询(L683) / listSessions初始加载(L733) / JSX return(L754) / 侧边栏导航(L803) / 网格/列表切换渲染(L854) |
| `frontend/src/pages/LivePage.tsx` | 课中实时录音主页（~2400行）：PDF 渲染、录音控制（WebSocket ASR）、笔记面板、高亮/文字标注、实时字幕、Transcript、AI Notes SSE 生成、Detailed Note 侧边栏、Page Chat、无 PPT 模式。状态机：idle → live → stopped → finalizing → done |
| `frontend/src/pages/ProcessingPage.tsx` | 处理中等待页：流水线进度显示 |
| `frontend/src/pages/NotesPage.tsx` | 笔记主视图：三栏布局（slide nav + PPT 画布 + 笔记面板）。IndexedDB 持久化(L20) / 类型定义(L114) / `RevealText`(L178) / `LineByLineReveal`(L219) / `StreamingExpandText`(L332) / `InlineQA`(L360) / `AiBulletRow`(L532) / `NotesPage` state(L764) / My Notes 状态(L815) / Page Chat 状态(L860) |
| `frontend/src/pages/DetailedNotePage.tsx` | 单页笔记详情视图 |
| `frontend/src/pages/DiagnosticsPage.tsx` | 全流程自动化健康检查页，访问 `/diagnostics` 触发 |

#### Components

| 路径 | 内容 |
|------|------|
| `frontend/src/components/ThreeColumnLayout.tsx` | 三栏布局容器 |
| `frontend/src/components/SlideCanvas.tsx` | PPT 页面渲染画布 |
| `frontend/src/components/OutlineNav.tsx` | 左侧 slide 导航列表 |
| `frontend/src/components/PageNotes.tsx` | 单页笔记容器（含 My Notes / AI Notes 切换） |
| `frontend/src/components/PassiveNotes.tsx` | 被动学习笔记展示 |
| `frontend/src/components/ActiveNotes.tsx` | 主动学习笔记展示 |
| `frontend/src/components/PillToggle.tsx` | pill 样式「我的笔记 / AI 笔记」切换按钮 |
| `frontend/src/components/TemplateSelector.tsx` | 笔记模板选择（4 模板 × 2 粒度） |
| `frontend/src/components/InlineAnnotation.tsx` | PPT 画布上的 inline 文字标注组件 |
| `frontend/src/components/RecordingControl.tsx` | 录音控制条（开始/暂停/停止） |
| `frontend/src/components/AudioPlayer.tsx` | 音频回放组件 |
| `frontend/src/components/FileUpload.tsx` | 文件上传拖拽区域 |
| `frontend/src/components/NewClassModal.tsx` | 新建课程 Modal：PPT + 音频上传，替代原 UploadPage |
| `frontend/src/components/TopBar.tsx` | 顶部导航栏（tab 切换、路由感知） |
| `frontend/src/components/CanvasToolbar.tsx` | PPT 画布工具栏（标注工具、翻译入口） |
| `frontend/src/components/TranslationPopover.tsx` | 划词翻译浮窗 |
| `frontend/src/components/HighlightLayer.tsx` | 画布高亮层（渲染 HighlightRecord） |
| `frontend/src/components/TextAnnotationLayer.tsx` | 画布文字标注层（渲染 TextAnnotation） |
| `frontend/src/components/RunLogModal.tsx` | 流水线运行日志弹窗 |
| `frontend/src/components/SearchDropdown.tsx` | 搜索下拉结果列表 |
| `frontend/src/components/notes/NotesPanel.tsx` | 笔记面板（My Notes / AI Notes / Transcript tab 切换 + Page Chat 抽屉 + 全屏模式）|
| `frontend/src/components/notes/AiBulletRow.tsx` | AI Notes 单行 bullet 展示（时间戳 + 展开详解）|
| `frontend/src/components/notes/StreamingExpandText.tsx` | 流式展开文本组件 |
| `frontend/src/components/notes/RevealText.tsx` | 逐字揭示动画文本 |
| `frontend/src/components/notes/LineByLineReveal.tsx` | 逐行揭示动画 |
| `frontend/src/components/notes/InlineQA.tsx` | 行内问答组件 |

#### UI 参考设计文档

| 路径 | 内容 |
|------|------|
| `UI/reference/UI-Design-Guide.md` | 前端 UI/UX 设计规范（色彩、间距、组件规范） |
| `UI/reference/融合设计文档与AI开发指南.md` | 融合设计文档与 AI 开发指南 |
| `UI/stitch/` | Figma 设计稿截图（LobbyPage 卡片、首页等参考图） |
| `UI/figma-wireframe-script.js` | Figma 线框生成脚本 |
| `UI/figma-plugin/` | Figma 插件（manifest.json + code.js） |

> 前端已接真实流水线（SSE 实时进度推送）+ Live 课堂全流程（WebSocket ASR + SSE AI Notes）。`/api/process-mock` 仅测试用。
