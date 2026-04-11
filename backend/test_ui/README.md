# LiberStudy 测试平台

基于 Streamlit 的可视化调试平台，用于交互式测试和验证 LiberStudy 后端 AI 流水线的各个阶段。

## 启动方式

**Windows（推荐）：**

在项目根目录双击运行 `launch_test_platform.bat`。脚本会自动检查虚拟环境、安装缺失依赖，然后启动应用。

**手动启动：**

```bash
cd backend
..\.venv\Scripts\streamlit run test_app.py
```

启动后浏览器访问 `http://localhost:8501`。

## 功能模块

### 侧边栏 — 全局控制

| 控件 | 说明 |
|------|------|
| Run 选择器 | 支持多个独立测试 Run，每个 Run 数据隔离存储在 `test_output/run_<id>/` |
| 语言 | `zh` / `en`，传给 Whisper ASR |
| 笔记模板 | 4 种模板：被动完整笔记、被动大纲摘要、主动扩展、主动综合 |
| 粒度 | `simple` / `detailed` |
| 对齐阈值 | 余弦相似度阈值，范围 0.1–0.9 |
| 重新对齐 | 强制重跑 Step 3 |
| 清除缓存 | 删除当前 Run 的中间产物 |

---

### Pipeline 标签页 — 流水线逐步测试

核心功能。每个 Step 均支持缓存复用（已跑过则直接展示结果），也可手动重新触发。

| Step | 名称 | 说明 |
|------|------|------|
| Step 0 | 音频上传与转换 | 接受 m4a/mp3/wav，FFmpeg 转为 16kHz 单声道 WAV，自动截取前 10 分钟 |
| Step 1 | PPT 解析 | 接受 pdf/pptx/ppt，调用 `ppt_parser`，展示前 5 张幻灯片缩略图 |
| Step 2 | ASR 转录 | 调用 OpenAI Whisper，展示前 10 条带时间戳的转录段落 |
| Step 3 | 语义对齐 | 调用 `alignment` 服务，显示每张幻灯片置信度（🟢/🟡/🔴）及覆盖率指标；内嵌对齐方法对比（Embedding / LLM / Hybrid）和版本 Diff 组件 |
| Step 4 | 笔记生成 | 调用 `note_generator`，按所选模板/粒度生成笔记，展示带时间戳和 AI 评注的要点 |
| Step 5 | 主动学习测试 | 选择某张幻灯片，输入自己的笔记，查看 AI 扩展效果 |
| Step 6 | 导出 | 下载 Markdown 或 PDF 格式的最终笔记，显示 3000 字预览 |

Step 3 底部内嵌 **Alignment 版本对比组件**（`align_compare`），可选取两个 Run 并排查看每张幻灯片的对齐变化（置信度变化、句子进出、off-slide 转换），支持规则解释和 Claude LLM 解释。

Step 6 之后自动扫描 **Issues & Findings**：低置信度幻灯片、无匹配幻灯片、无内容幻灯片、噪声 bullet（页码/作者名）、整体平均置信度过低等。

---

### Dashboard 标签页 — 成本与延迟分析

读取 `run_log.json`，展示：

- 累计总成本 / 总 token 数 / 已执行步骤数
- 各 Step 的平均延迟、总成本、总 token 汇总表
- 多次 Run 的对齐置信度趋势折线图
- 各笔记模板的生成成本对比表

---

### Ground Truth 标签页 — 人工标注与准确率评估

用于评估对齐质量的人工标注工具：

- 逐条呈现 ASR 转录段落
- 标注人员指定该段落属于哪张幻灯片，以及对应哪个要点（或标记为 off-slide）
- 标注结果保存至 `test_output/ground_truth.json`（跨 Run 共享）
- 累计标注 5+ 条后，自动计算 Method A（Embedding）的页级准确率

---

### Batch 标签页 — 批量测试

> **开发中。** 当前为占位页面，提示运行 `backend/test_batch.py` 进行多用例自动化测试。

---

## 数据目录结构

```
test_output/
├── ground_truth.json              # 跨 Run 共享的人工标注
└── run_<id>/
    ├── test_audio_10min.wav       # Step 0 产物
    ├── asr_segments.json          # Step 2 产物
    ├── ppt_pages.json             # Step 1 产物
    ├── slides/                    # Step 1 幻灯片图片
    ├── aligned_pages.json         # Step 3 产物
    ├── bullet_alignment.json      # Step 3 多方法对比结果
    ├── notes_<template>_<gran>.json  # Step 4 产物
    └── run_log.json               # 每步的延迟/token/成本记录
```

## 代码结构

```
backend/
├── test_app.py          # Streamlit 入口，侧边栏 + 4 个标签页
└── test_ui/
    ├── helpers.py       # 公共常量、路径函数、UI 工具函数
    ├── pipeline.py      # Pipeline 标签页（Step 0–6 + Issues）
    ├── dashboard.py     # Dashboard 标签页
    ├── ground_truth.py  # Ground Truth 标签页
    ├── align_compare.py # 对齐版本 Diff 组件（嵌入 Step 3）
    └── batch.py         # Batch 标签页（占位）
```

## 主要依赖

| 包 | 用途 |
|----|------|
| `streamlit >= 1.35.0` | Web UI 框架 |
| `anthropic == 0.40.0` | Claude API（笔记生成 + LLM 对齐分析）|
| `openai == 1.57.0` | Whisper ASR + Embedding |
| `pymupdf == 1.24.14` | PDF 渲染（幻灯片缩略图）|
| `fpdf2 >= 2.7.9` | PDF 导出 |
| `numpy` | 余弦相似度计算 |
| `python-dotenv` | 加载 `backend/.env` 中的 API Key |

API Key 配置在 `backend/.env`：

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```
