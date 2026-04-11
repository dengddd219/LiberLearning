# Step 5 — Active Learning Canvas 设计文档

**日期**：2026-04-11  
**范围**：`backend/test_ui/pipeline.py` Step 5 区块 + `backend/services/note_generator.py`（接口扩展）  
**目标**：打通"PPT 画面点击标注 → LLM 扩写笔记"的完整业务逻辑管道，数据结构与未来前端接口对齐

---

## 1. 背景与目标

当前 Step 5 是一个简单的文本框 + 按钮，无法模拟用户在 PPT 画面上点击插入标注的核心 UX。

新版目标：
- 渲染 PPT 页面图片，用户点击画面任意位置插入文字标注
- 每条标注携带 `(page_num, x, y, text)`，坐标为相对比例值（0.0–1.0）
- 当前页所有标注 + 该页 aligned segments 一起传给 LLM
- LLM 输出带 `page_num` 的扩写结果，为前端接口预留端口

test 平台目标是 80% 还原前端体验，UI 细节从简，业务逻辑管道必须完整正确。

---

## 2. 布局结构

```
┌─────────────────────────────────────────────────────┐
│  页码选择 + 模板选择 + 粒度选择                        │
├─────────────────────────────────────────────────────┤
│  [PPT 画面 — HTML Canvas 组件]                       │
│  点击任意位置 → 弹出输入框 → 保存标注                  │
├──────────────────────────┬──────────────────────────┤
│  用户标注列表             │  该页老师文本               │
│  [{text, x, y}, ...]     │  (aligned_segments 拼接)   │
├──────────────────────────┴──────────────────────────┤
│  [▶ 生成笔记]                                        │
├─────────────────────────────────────────────────────┤
│  LLM 输出（带 page_num）                             │
└─────────────────────────────────────────────────────┘
```

---

## 3. 数据结构

### 3.1 单条标注（Annotation）

```json
{
  "text": "这里很重要",
  "x": 0.32,
  "y": 0.45
}
```

- `x`, `y`：相对于画面宽高的比例值（0.0–1.0），由 HTML 组件返回
- `text`：用户输入的文字

### 3.2 LLM 输入

```json
{
  "page_num": 3,
  "ppt_text": "...",
  "aligned_segments": [
    {"start": 120, "end": 145, "text": "老师口述内容..."}
  ],
  "annotations": [
    {"text": "这里很重要", "x": 0.32, "y": 0.45},
    {"text": "考试重点", "x": 0.10, "y": 0.80}
  ]
}
```

### 3.3 LLM 输出

```json
{
  "page_num": 3,
  "annotations": [
    {
      "text": "这里很重要",
      "x": 0.32,
      "y": 0.45,
      "ai_expansion": "LLM 生成的扩写内容..."
    },
    {
      "text": "考试重点",
      "x": 0.10,
      "y": 0.80,
      "ai_expansion": "LLM 生成的扩写内容..."
    }
  ]
}
```

**`page_num` 在输入和输出中都是必传字段**，供前端接口对接用。

---

## 4. 业务逻辑管道（5步）

### Step A — PPT 画面渲染 + 点击捕获

- 从 `slides_dir/slides.pdf` 用 PyMuPDF 渲染目标页为 PNG（复用 Step 1 现有逻辑）
- 将 PNG base64 编码后注入 HTML Canvas 组件（`st.components.v1.html`）
- Canvas JS 监听 `click` 事件，计算点击坐标相对比例 `(x, y)`
- 点击后在原位渲染 `<textarea>` 供用户输入文字
- 用户按 Enter 或点击画面外部确认 → 通过 Streamlit component value 将 `{x, y, text}` 传回 Python
- Python 端将新标注 append 到 `st.session_state["s5_annotations"][page_num]`

### Step B — 标注列表显示

- 左框：遍历 `st.session_state["s5_annotations"][page_num]`，每条显示 `text` + `(x:{x:.0%}, y:{y:.0%})`，带删除按钮
- 右框：读取 `aligned_pages.json` 中该页的 `aligned_segments`，拼接文本只读展示

### Step C — 触发生成

- 点击"▶ 生成笔记"
- 构造 LLM 输入（见 3.2）
- 调用 `generate_notes_for_all_pages([page_with_annotations], template=active_tmpl, granularity=...)`
- `page_with_annotations` 结构：

```python
{
  **active_page,            # 含 page_num, ppt_text, aligned_segments
  "annotations": [...],    # 当前页标注列表
}
```

### Step D — LLM 输出处理

- note_generator 对有 `annotations` 字段的页面，逐条标注生成 `ai_expansion`
- 返回结构见 3.3，`page_num` 必须透传

### Step E — 结果展示

- 下方展示 LLM 输出，每条标注原文 + ai_expansion
- 显示 cost badge（复用现有 `_badge`）

---

## 5. session_state 键

| 键 | 类型 | 说明 |
|---|---|---|
| `s5_annotations` | `dict[int, list[Annotation]]` | 按 page_num 存储各页标注 |
| `s5_last_click` | `dict | None` | HTML 组件最新返回的点击事件 `{x, y, text}` |
| `s5_result` | `dict | None` | 最近一次 LLM 输出结果 |
| `s5_page_idx` | `int` | 当前选中页码索引 |

---

## 6. HTML Canvas 组件接口

组件通过 `st.components.v1.html(..., height=...) ` 嵌入，返回值为：

```json
{"x": 0.32, "y": 0.45, "text": "用户输入的文字"}
```

或 `null`（无新标注时）。

Python 端轮询返回值，非 null 时 append 到 session_state 并 `st.rerun()`。

---

## 7. note_generator 接口扩展

现有 `generate_notes_for_all_pages` 需要识别 `annotations` 字段并做专门处理：

- 若页面含 `annotations` 且非空 → 走 active learning 路径，对每条标注生成 `ai_expansion`
- prompt 中提供：该页 ppt_text + aligned_segments 的拼接文本 + 单条标注 text
- 输出中 `page_num` 必须透传（已有机制，确认不丢失）

---

## 8. 不在本次范围内

- 标注的视觉还原（虚线边框、拖拽手柄、浮动菜单）— 留给前端 UI 专项
- 标注持久化到磁盘（本次只存 session_state）
- 多页标注的批量生成
