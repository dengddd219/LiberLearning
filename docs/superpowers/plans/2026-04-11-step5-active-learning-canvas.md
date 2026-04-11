# Step 5 Active Learning Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Step 5 从简单文本框升级为：PPT 画面点击插入标注 → 标注列表 + 老师文本对照 → LLM 逐条扩写笔记，数据结构携带 page_num 以对接未来前端。

**Architecture:** HTML Canvas 组件（`st.components.v1.html`）嵌入 PPT 页面图片，监听点击事件捕获 (x%, y%) 并弹出输入框，通过组件返回值传回 Python。`note_generator.py` 新增 `generate_annotations` 函数专门处理标注扩写，与现有 `generate_notes_for_all_pages` 平行，不破坏已有接口。Step 5 的 UI 区块整体替换，session_state 用 `s5_annotations` 字典按 page_num 存储各页标注。

**Tech Stack:** Python 3.x, Streamlit (`st.components.v1.html`), PyMuPDF (fitz), Anthropic Python SDK, asyncio

---

## File Map

| 文件 | 动作 | 说明 |
|------|------|------|
| `backend/test_ui/pipeline.py` | Modify (lines 548–605) | 替换 Step 5 区块 |
| `backend/services/note_generator.py` | Modify (append) | 新增 `generate_annotations` 函数 |

---

## Task 1: 新增 `generate_annotations` 到 note_generator.py

**Files:**
- Modify: `backend/services/note_generator.py` (append after line 301)

### 接口设计

输入：
```python
page: dict  # 含 page_num, ppt_text, aligned_segments
annotations: list[dict]  # [{"text": "...", "x": 0.32, "y": 0.45}, ...]
template: str  # "active_expand" | "active_comprehensive"
granularity: str  # "simple" | "detailed"
```

输出：
```python
{
    "page_num": 3,
    "annotations": [
        {"text": "...", "x": 0.32, "y": 0.45, "ai_expansion": "..."},
        ...
    ],
    "_cost": {"input_tokens": 100, "output_tokens": 200}
}
```

- [ ] **Step 1: 在 `note_generator.py` 末尾追加 `generate_annotations` 函数**

在 `backend/services/note_generator.py` 末尾（第 301 行之后）追加：

```python


async def generate_annotations(
    page: dict,
    annotations: list[dict],
    template: str = "active_expand",
    granularity: str = "simple",
) -> dict:
    """
    For each annotation on a page, call Claude to generate ai_expansion.

    Args:
        page: page dict with page_num, ppt_text, aligned_segments
        annotations: list of {"text": str, "x": float, "y": float}
        template: active template name
        granularity: "simple" | "detailed"

    Returns:
        {
            "page_num": <int>,
            "annotations": [{"text", "x", "y", "ai_expansion"}, ...],
            "_cost": {"input_tokens": int, "output_tokens": int}
        }
    """
    system_prompt = _load_prompt(template, granularity)
    client, model = _client()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    page_num = page["page_num"]
    ppt_text = page.get("ppt_text", "") or "(no slide text)"
    ppt_bullets = _format_ppt_bullets(ppt_text)
    transcript = _format_segments(page.get("aligned_segments", []))

    total_input = 0
    total_output = 0
    results = []

    for ann in annotations:
        user_note = ann.get("text", "").strip()
        if not user_note:
            results.append({**ann, "ai_expansion": ""})
            continue

        user_msg = (
            f"## PPT Bullet Points\n{ppt_bullets}\n\n"
            f"## Student's Note\n{user_note}\n\n"
            f"## Transcript\n{transcript}"
        )
        try:
            data = await _generate_page(
                client, model, system_prompt, user_msg,
                semaphore, page_num, template,
            )
            usage = data.pop("_usage", {})
            total_input += usage.get("input_tokens", 0)
            total_output += usage.get("output_tokens", 0)
            ai_expansion = data.get("ai_expansion", "") or data.get("content", "") or str(data)
            results.append({**ann, "ai_expansion": ai_expansion})
        except Exception as e:
            results.append({**ann, "ai_expansion": f"[Error: {e}]"})

    return {
        "page_num": page_num,
        "annotations": results,
        "_cost": {"input_tokens": total_input, "output_tokens": total_output},
    }
```

- [ ] **Step 2: 手动验证函数签名不与现有代码冲突**

在 `backend/services/note_generator.py` 中确认：
- 第 162 行的 `generate_notes_for_all_pages` 仍然完整
- 新函数 `generate_annotations` 在文件末尾，无缩进错误

用 Python 语法检查：
```bash
cd backend && python -c "import services.note_generator; print('OK')"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
cd backend && git add services/note_generator.py && git commit -m "feat(note-gen): add generate_annotations for per-annotation LLM expansion"
```

---

## Task 2: 构建 HTML Canvas 组件

**Files:**
- Modify: `backend/test_ui/pipeline.py`（Step 5 区块内调用）

Canvas 组件是一段内联 HTML/JS，通过 `st.components.v1.html` 嵌入。它负责：
1. 显示 PPT 页面图片（base64 PNG 作为 `<img>` 背景）
2. 监听 `click` → 在点击位置显示 `<textarea>`
3. 用户按 Enter（非 Shift+Enter）或点击外部 → 把 `{x, y, text}` 写入 `window.parent.postMessage` 通过 Streamlit component value 返回

### 关键实现细节

Streamlit 自定义组件双向通信需要用 `st.components.v1.declare_component`，但对于**只需要从 JS → Python 单向传值**的简单场景，更简单的方案是：用 `st.session_state` + `st.query_params` 或直接用 **`streamlit-javascript`** 库。

但最简单可靠的方案：用 `st.components.v1.html` 渲染 HTML，把标注数据通过 **URL hash** 或 **hidden form submit** 传回——但这些都很 hacky。

**实际最简方案（无需第三方库）：**

将 Canvas 组件拆成两部分：
1. `st.image(png_bytes)` 展示 PPT 画面（纯展示）
2. 在图片下方用 `st.number_input` 捕获点击坐标（x%, y% 各一个滑块/输入框）
3. `st.text_input` 输入标注文字
4. `st.button("➕ 添加标注")` 确认

这样完全绕开 JS 通信问题，同时保留了坐标数据（x, y 用滑块 0–100 输入，精度够用）。

> **注意**：这偏离了原始方案 B（真实点击捕获），但考虑到 Streamlit 的双向通信限制，这是最稳定可靠的方案。如果后续要实现真实点击，需要打包成独立的 Streamlit Component（`st.components.v1.declare_component`），那是一个独立工程。

- [ ] **Step 1: 在 pipeline.py 中定义 `_render_ppt_page` 辅助函数**

在 `pipeline.py` 文件顶部 `render_pipeline` 函数定义之前插入：

```python
def _render_ppt_page_image(page_num: int) -> bytes | None:
    """Render PPT page as PNG bytes using PyMuPDF. page_num is 1-indexed."""
    import fitz
    slides_dir = _get_slides_dir()
    pdf_path = slides_dir / "slides.pdf"
    if not pdf_path.exists():
        return None
    doc = fitz.open(str(pdf_path))
    page_idx = page_num - 1
    if page_idx < 0 or page_idx >= len(doc):
        doc.close()
        return None
    mat = fitz.Matrix(1.5, 1.5)
    pix = doc[page_idx].get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    doc.close()
    return img_bytes
```

- [ ] **Step 2: 验证辅助函数语法**

```bash
cd backend && python -c "from test_ui.pipeline import _render_ppt_page_image; print('OK')"
```

Expected: `OK`（注意：如果没有 PDF 文件也不会报错，函数返回 None）

- [ ] **Step 3: Commit**

```bash
git add backend/test_ui/pipeline.py && git commit -m "feat(step5): add _render_ppt_page_image helper"
```

---

## Task 3: 替换 Step 5 区块 UI 逻辑

**Files:**
- Modify: `backend/test_ui/pipeline.py` lines 548–605

将现有 Step 5（lines 548–605）完整替换为新版本。

- [ ] **Step 1: 替换 Step 5 区块**

找到 pipeline.py 中：
```python
    # ── Step 5 ────────────────────────────────────────────────────────────────
    with st.expander("Step 5 — Active learning test", expanded=False):
```
到（不含）：
```python
    # ── Step 6 ────────────────────────────────────────────────────────────────
```

将这段（共约 58 行）替换为：

```python
    # ── Step 5 ────────────────────────────────────────────────────────────────
    with st.expander("Step 5 — Active learning test", expanded=False):
        asr     = _asr_path()
        aligned = _aligned_path()
        if not asr.exists():
            st.info("Complete Step 2 (ASR) first.")
        else:
            # ── 页码 + 模板 + 粒度选择 ──────────────────────────────────────
            if has_ppt and aligned.exists():
                aligned_data = _load_json(aligned)
                page_opts = [f"Slide {p['page_num']}" for p in aligned_data]
                s5_idx = st.selectbox("Page", range(len(page_opts)),
                                      format_func=lambda i: page_opts[i],
                                      key="s5_page_idx")
                active_page = aligned_data[s5_idx]
            else:
                pages_in  = _build_noppt_pages(_load_json(asr))
                page_opts = [f"Topic {p['page_num']}" for p in pages_in]
                s5_idx = st.selectbox("Topic segment", range(len(page_opts)),
                                      format_func=lambda i: page_opts[i],
                                      key="s5_page_idx")
                active_page = pages_in[s5_idx]

            page_num = active_page["page_num"]

            active_tmpl = st.selectbox(
                "Active template",
                ["active_expand", "active_comprehensive"],
                format_func=lambda x: {
                    "active_expand": "① 基于我的笔记扩写",
                    "active_comprehensive": "③ 完整综合笔记",
                }[x],
                key="s5_tmpl",
            )
            granularity_s5 = st.radio(
                "Granularity (Step 5)", ["simple", "detailed"],
                horizontal=True, key="s5_gran",
            )

            # ── PPT 画面展示 ─────────────────────────────────────────────────
            if has_ppt:
                img_bytes = _render_ppt_page_image(
                    active_page.get("pdf_page_num", page_num)
                )
                if img_bytes:
                    st.image(img_bytes, caption=f"Slide {page_num}",
                             use_container_width=True)
                else:
                    st.info("PPT image not available for this page.")

            # ── 标注输入区 ────────────────────────────────────────────────────
            st.markdown("**添加标注**")
            ann_col1, ann_col2, ann_col3 = st.columns([2, 1, 1])
            with ann_col1:
                ann_text = st.text_input(
                    "标注文字", key="s5_ann_text",
                    placeholder="输入你的笔记...",
                )
            with ann_col2:
                ann_x = st.number_input(
                    "X 位置 (%)", min_value=0, max_value=100, value=50,
                    key="s5_ann_x",
                )
            with ann_col3:
                ann_y = st.number_input(
                    "Y 位置 (%)", min_value=0, max_value=100, value=50,
                    key="s5_ann_y",
                )

            if st.button("➕ 添加标注", key="btn_s5_add"):
                if ann_text.strip():
                    if "s5_annotations" not in st.session_state:
                        st.session_state["s5_annotations"] = {}
                    key = str(page_num)
                    if key not in st.session_state["s5_annotations"]:
                        st.session_state["s5_annotations"][key] = []
                    st.session_state["s5_annotations"][key].append({
                        "text": ann_text.strip(),
                        "x": round(ann_x / 100, 4),
                        "y": round(ann_y / 100, 4),
                    })
                    st.rerun()

            # ── 标注列表 + 老师文本 ───────────────────────────────────────────
            col_ann, col_teacher = st.columns(2)

            annotations_key = str(page_num)
            current_annotations = (
                st.session_state.get("s5_annotations", {}).get(annotations_key, [])
            )

            with col_ann:
                st.markdown("**用户标注**")
                if not current_annotations:
                    st.caption("暂无标注，请在上方输入后点击「添加标注」")
                else:
                    for i, ann in enumerate(current_annotations):
                        c1, c2 = st.columns([4, 1])
                        with c1:
                            st.markdown(
                                f"**#{i+1}** {ann['text']}  "
                                f"`x:{ann['x']:.0%} y:{ann['y']:.0%}`"
                            )
                        with c2:
                            if st.button("🗑", key=f"s5_del_{page_num}_{i}"):
                                st.session_state["s5_annotations"][annotations_key].pop(i)
                                st.rerun()

            with col_teacher:
                st.markdown("**该页老师文本**")
                segs = active_page.get("aligned_segments", [])
                if segs:
                    for seg in segs:
                        ts = int(seg.get("start", 0))
                        te = int(seg.get("end", ts))
                        st.caption(
                            f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}] "
                            f"{seg['text']}"
                        )
                else:
                    st.caption("（本页无对齐文本）")

            st.divider()

            # ── 生成笔记 ──────────────────────────────────────────────────────
            if st.button("▶ 生成笔记", key="btn_step5",
                         disabled=not current_annotations):
                t0 = time.time()
                prog = st.progress(0, text="Calling Claude…")
                from services.note_generator import generate_annotations as _gen_ann
                result = _run_sync(_gen_ann(
                    active_page,
                    current_annotations,
                    template=active_tmpl,
                    granularity=granularity_s5,
                ))
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                cost_info = result.get("_cost", {})
                tok  = cost_info.get("input_tokens", 0) + cost_info.get("output_tokens", 0)
                cost = (cost_info.get("input_tokens", 0) / 1e6 * CLAUDE_INPUT_PER_1M
                        + cost_info.get("output_tokens", 0) / 1e6 * CLAUDE_OUTPUT_PER_1M)
                _log_run("active_learn_canvas", elapsed, tok, cost,
                         extra={"template": active_tmpl, "page_num": page_num,
                                "n_annotations": len(current_annotations)})
                st.session_state["s5_result"] = result
                st.rerun()

            # ── LLM 输出展示 ──────────────────────────────────────────────────
            s5_result = st.session_state.get("s5_result")
            if s5_result and s5_result.get("page_num") == page_num:
                st.markdown("**生成笔记**")
                cost_info = s5_result.get("_cost", {})
                tok  = cost_info.get("input_tokens", 0) + cost_info.get("output_tokens", 0)
                cost = (cost_info.get("input_tokens", 0) / 1e6 * CLAUDE_INPUT_PER_1M
                        + cost_info.get("output_tokens", 0) / 1e6 * CLAUDE_OUTPUT_PER_1M)
                st.caption(_badge(0, tok, cost))
                st.caption(f"page_num: {s5_result['page_num']}")
                for ann in s5_result.get("annotations", []):
                    with st.container():
                        left, right = st.columns(2)
                        with left:
                            st.markdown(
                                f"**原始输入** `x:{ann['x']:.0%} y:{ann['y']:.0%}`  \n"
                                f"{ann['text']}"
                            )
                        with right:
                            st.markdown("**AI 扩写**")
                            st.markdown(ann.get("ai_expansion", "（无输出）"))
                    st.divider()

```

- [ ] **Step 2: 验证 Python 语法**

```bash
cd backend && python -c "import ast; ast.parse(open('test_ui/pipeline.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

- [ ] **Step 3: 验证 Streamlit 可以启动（不报 import 错误）**

```bash
cd backend && python -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path('.').resolve()))
from dotenv import load_dotenv
load_dotenv(Path('.env'))
from test_ui import pipeline
print('import OK')
"
```

Expected: `import OK`

- [ ] **Step 4: Commit**

```bash
git add backend/test_ui/pipeline.py && git commit -m "feat(step5): replace with canvas annotation UI — PPT image + annotation list + LLM expansion"
```

---

## Task 4: 验证端到端管道

这一步需要 Streamlit 已运行，手动走一遍流程确认各端口正确。

- [ ] **Step 1: 启动 Streamlit**

```bash
cd backend && ../.venv/Scripts/streamlit run test_app.py
```

- [ ] **Step 2: 验证 Step 5 正常渲染**

打开浏览器，展开 Step 5：
- [ ] 页码下拉正确显示所有 slide
- [ ] PPT 图片正确渲染（有 PPT 时）
- [ ] 标注输入区显示 X/Y 输入框
- [ ] 点击「添加标注」后标注出现在左框
- [ ] 老师文本出现在右框
- [ ] 「生成笔记」按钮在无标注时 disabled

- [ ] **Step 3: 验证 LLM 输出结构包含 page_num**

添加一条标注后点击「生成笔记」，确认：
- [ ] 输出框显示 `page_num: <N>`
- [ ] 每条标注显示原始输入（左）+ AI 扩写（右）
- [ ] cost badge 正确显示

- [ ] **Step 4: 验证切换页码后 result 不残留**

切换到另一页 → 确认上一页的 LLM 结果不显示（`s5_result.page_num != page_num` 时隐藏）

---

## Self-Review

**Spec coverage check:**

| Spec 要求 | 实现任务 |
|-----------|---------|
| PPT 画面渲染 | Task 2 Step 1 (`_render_ppt_page_image`) + Task 3 Step 1 (`st.image`) |
| 点击插入标注（坐标）| Task 3 Step 1（number_input x/y，坐标存为 0.0–1.0 比例值）|
| 标注列表显示（左框）| Task 3 Step 1（`col_ann` 区块）|
| 该页老师文本（右框）| Task 3 Step 1（`col_teacher` 区块）|
| LLM 生成笔记 | Task 1（`generate_annotations`）+ Task 3 Step 1（调用 `_gen_ann`）|
| page_num 必传 | Task 1 输出结构 + Task 3 result 展示时 `st.caption(f"page_num: ...")` |
| 逐条标注生成 ai_expansion | Task 1 中 `for ann in annotations` 循环 |
| cost badge | Task 3 Step 1（`_log_run` + `_badge`）|
| session_state 键规范 | `s5_annotations`, `s5_result`, `s5_page_idx` |

**无 TBD / 无 placeholder 确认：** 所有代码块均为完整实现。

**类型一致性：**
- `generate_annotations` 输入 `annotations: list[dict]`，Task 3 传入 `current_annotations`（同类型）
- 输出 `{"page_num": int, "annotations": [...], "_cost": {...}}`，Task 3 用 `result.get("annotations", [])` 读取，一致
- `_render_ppt_page_image(page_num: int)` 接收 `active_page.get("pdf_page_num", page_num)`，类型为 int，一致
