# pipeline/ — Package Map

这个 package 是测试平台的 Pipeline Tab。每个文件对应一个 Step，职责单一。

**读代码时：先看这个文件，定位到对应 Step，再去读那个文件。**

---

## 入口

| 文件 | 职责 |
|------|------|
| `__init__.py` | `render_pipeline()` — 组装所有 Step，是 test_app.py 调用的唯一入口 |

## Step 文件

| 文件 | Step | 功能 | 关键 UI 元素 |
|------|------|------|-------------|
| `step0_audio.py` | Step 0 | 音频上传 & 格式转换（any → 16kHz WAV） | 上传控件、Convert 按钮、进度条 |
| `step1_ppt.py` | Step 1 | PPT 解析（PPTX/PDF → 文本 + 缩略图） | Parse 按钮、5张缩略图预览 |
| `step2_asr.py` | Step 2 | ASR 转录（Whisper API → 句段合并） | Run ASR 按钮、raw vs merged 对比展开器 |
| `step3_alignment.py` | Step 3 | 语义对齐（左右策略 A/B 对比 + GT 成功率） | 策略下拉、Run 按钮、Transcript Timeline 分页、Accuracy 指标 |
| `step4_notes.py` | Step 4 | 笔记生成（4模板×2粒度 + 策略锁定） | 模板选择、Prompt 版本选择、Commit strategy、Generate 按钮 |
| `step5_active.py` | Step 5 | 主动学习测试（PPT 画面 + 标注输入 + AI 扩写） | PPT 图片展示、标注列表、生成笔记按钮 |
| `step6_export.py` | Step 6 | 导出（Markdown 下载 + PDF 生成） | Download Markdown、Generate PDF、预览 |
| `issues.py` | Issues & Findings | 流水线诊断（低置信度、空白页、噪声 bullet） | 无按钮，纯展示 |

## 依赖关系

所有 Step 文件只从以下地方 import：
- `test_ui.helpers` — 共享常量、路径工具、UI 工具函数
- `services.*` — 生产代码（audio/ppt_parser/asr/alignment/note_generator）
- `streamlit` — UI

Step 之间**不互相 import**，状态通过 `test_ui.helpers` 的路径函数（如 `_wav_path()`、`_asr_path()`）共享磁盘缓存文件。

## 数据流

```
Step 0 → test_audio.wav
Step 1 → ppt_pages.json + slides/slides.pdf
Step 2 → asr_sentences.json + asr_raw.json
Step 3 → aligned_pages_{strategy}.json → (commit) → aligned_pages.json
Step 4 → notes_{template}_{gran}_{strategy}.json
Step 5 → 读 aligned_pages.json，输出存 st.session_state["s5_result"]
Step 6 → 读 notes_*.json，生成 Markdown/PDF 下载
Issues → 读 aligned_pages.json + notes_*.json，输出诊断
```

所有缓存文件路径由 `test_ui.helpers._get_run_dir()` 决定，默认为 `backend/test_output/run_default/`。
