# LiberStudy Codebase Map

快速导航文档。告别每次都要重新翻代码找文件。

---

## 核心流水线：Step 1–5

| Step | 功能 | 生产代码 | Streamlit 测试入口 |
|------|------|----------|--------------------|
| Step 1 | 音频格式转换（any → 16kHz WAV） | `backend/services/audio.py` | test_ui/pipeline.py Step 0 |
| Step 2 | PPT 解析（PPTX→PDF→文本提取） | `backend/services/ppt_parser.py` | test_ui/pipeline.py Step 1 |
| Step 3 | ASR 转录（Whisper / 阿里云） | `backend/services/asr.py` | test_ui/pipeline.py Step 2 |
| Step 4 | 语义对齐（ASR 段落 → PPT 页面） | `backend/services/alignment.py` | test_ui/pipeline.py Step 3 |
| Step 5 | LLM 笔记生成（Claude） | `backend/services/note_generator.py` | test_ui/pipeline.py Step 4–5 |

流水线串联调用入口：`backend/routers/process.py` → `_run_pipeline()`

---

## 完整文件地图

### 入口 & 路由

| 文件 | 作用 |
|------|------|
| `backend/main.py` | FastAPI app 工厂，挂载路由、静态目录、CORS |
| `backend/routers/process.py` | `POST /api/process`（真实流水线）+ `POST /api/process-mock` + 单页重试 |
| `backend/routers/sessions.py` | `GET /api/sessions/{id}`，mock 数据也在这里硬编码 |

### Services（核心逻辑）

| 文件 | 作用 |
|------|------|
| `backend/services/audio.py` | FFmpeg 封装：格式转换、chunk 合并、时长获取 |
| `backend/services/ppt_parser.py` | LibreOffice→PDF + PyMuPDF 文本提取 + 术语抽取 |
| `backend/services/asr.py` | Whisper API（支持 >25MB 分段）+ 阿里云 stub |
| `backend/services/alignment.py` | **当前生产对齐算法（V2/D-004）**：embedding cosine + K=3 debounce + 锚点约束 |
| `backend/services/alignment_v1.py` | 历史 V1 算法（argmax，无 debounce），测试平台 A/B 用 |
| `backend/services/alignment_v2.py` | V2 快照，测试平台 strategy dropdown 用 |
| `backend/services/bullet_alignment.py` | 实验性 bullet 级对齐（Method A/B/C） |
| `backend/services/note_generator.py` | Claude 笔记生成：4模板×2粒度 + 批注扩写 `generate_annotations()` |
| `backend/services/judge.py` | LLM-as-a-Judge 评分（完整性/准确性/可读性 1–5 分） |

### Prompts

| 文件 | 对应模板 |
|------|----------|
| `backend/prompts/passive_ppt_notes.md` | Template 2：全PPT讲解笔记（按 bullet 加时间戳） |
| `backend/prompts/passive_outline_summary.md` | Template 4：大纲摘要 |
| `backend/prompts/active_expand.md` | Template 1：基于我的笔记扩写 |
| `backend/prompts/active_comprehensive.md` | Template 3：完整综合笔记 |

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
| `UI-Design-Guide.md` | 前端 UI/UX 设计规范 |
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

## PRD 章节速查（`LiberStudy-PRD.md`）

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

## 前端（未与真实 API 联通）

| 路径 | 内容 |
|------|------|
| `frontend/src/App.tsx` | React app 根组件 |
| `frontend/vite.config.ts` | Vite 配置 |
| `frontend/package.json` | React + Vite + Tailwind + shadcn/ui 依赖 |

> 当前前端仍调用 `/api/process-mock`，未接真实流水线。
