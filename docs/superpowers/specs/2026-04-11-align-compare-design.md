# Alignment Compare — Design Spec

**Date:** 2026-04-11  
**Feature:** Alignment 版本横向对比视图  
**Scope:** `backend/test_ui/align_compare.py`（新建）+ `backend/test_ui/pipeline.py`（小改）

---

## 1. 背景与目标

每次对 alignment 逻辑做改动后，需要对比两次 run 的 `aligned_pages.json`，判断改动是否有效。目标：
- 以每页为大单位，每条句子为比较对象
- 显示完整量化数据（similarity、时间戳、跨页移动）
- 差异行高亮，无变化行视觉降权
- 支持按需触发 LLM 原因分析

---

## 2. 入口

嵌在 `pipeline.py` Step 3 expander 底部，独立 expander：

```
▼ Step 3 — Semantic alignment
  [现有内容不变]
  st.divider()
  ▼ 🔀 Alignment 版本对比  (默认收起)
    ...
```

`pipeline.py` 改动仅为在 Step 3 末尾追加：
```python
from test_ui.align_compare import render_align_compare
render_align_compare()
```

---

## 3. 数据结构

### PageDiff（字典）

```python
{
  "page_num": int,
  "ppt_text": str,
  "has_diff": bool,                # 任意维度有变化
  "conf_a": float,
  "conf_b": float,
  "segments_a": list[dict],        # aligned_segments from run A
  "segments_b": list[dict],        # aligned_segments from run B
  "off_slide_a": list[dict],       # off_slide_segments from run A
  "off_slide_b": list[dict],       # off_slide_segments from run B
  "moved_in": list[str],           # 文本列表：B有此页，A不在此页（来自哪页）
  "moved_out": list[str],          # 文本列表：A有此页，B不在此页（去了哪页）
  "off_slide_changed": list[dict], # {text, direction: "to_off"|"from_off"}
}
```

### SegmentComparison（用于渲染，临时构建）

每行句子的状态：
- `unchanged` — 两边都有，similarity 变化 ≤ 0.05
- `sim_changed` — 两边都有，similarity 变化 > 0.05
- `new` — B 有，A 无（含来源页信息）
- `gone` — A 有，B 无（含去向页信息）
- `to_off_slide` — A 是 aligned，B 变成 off_slide
- `from_off_slide` — A 是 off_slide，B 变成 aligned

---

## 4. 核心函数

### 4.1 `compare_aligned_pages(data_a, data_b) -> list[PageDiff]`

纯函数，无副作用。

步骤：
1. 以 `page_num` 对齐两份数据，构建 `page_map_a`、`page_map_b`
2. 构建全局文本索引：`text_to_page_a`、`text_to_page_b`（key=`text`，value=`page_num`，aligned 和 off_slide 分开索引）
3. 对每个页面（union of pages in A and B）：
   - 计算 `moved_in`：在 B 的此页 aligned 但在 A 不在此页（查 `text_to_page_a`）
   - 计算 `moved_out`：在 A 的此页 aligned 但在 B 不在此页（查 `text_to_page_b`）
   - 计算 `off_slide_changed`：aligned ↔ off_slide 的转换
   - `has_diff` = conf 变化 > 0.02 OR moved_in/moved_out 非空 OR off_slide_changed 非空 OR 任意句子 sim 变化 > 0.05

### 4.2 `analyze_page_diff_rules(page_diff) -> dict`

纯函数，输出结构：

```python
{
  "conf_delta": float,           # conf_b - conf_a
  "conf_direction": "up"|"down"|"flat",
  "seg_count_a": int,
  "seg_count_b": int,
  "moved_in_count": int,
  "moved_out_count": int,
  "off_slide_changed_count": int,
  "sim_mean_a": float,
  "sim_mean_b": float,
  "sim_min_a": float,
  "sim_min_b": float,
  "summary": str,                # 自动生成的一句话总结，中文
}
```

`summary` 生成规则（按优先级拼接）：
- conf 变化 > 0.05：`"置信度 +0.08（0.42→0.50）"`
- moved_in > 0：`"新增 2 条句子从其他页移入"`
- moved_out > 0：`"移出 1 条句子到其他页"`
- off_slide_changed > 0：`"1 条句子 off_slide 判定变化"`
- sim_mean 变化 > 0.03：`"平均 similarity +0.05"`
- 全部无变化：`"无变化"`

### 4.3 `analyze_page_diff_llm(page_diff, run_id_a, run_id_b) -> str`

调用 Claude API，使用 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`（与其他 service 文件一致）。

Prompt 构建：将 page_diff 的关键数据序列化为结构化文本，要求 Claude 用中文分析：
- 为什么句子的 similarity 分数变化
- 跨页移动的可能原因
- off_slide 判定变化的合理性
- 总体建议

返回纯文本（markdown）。

### 4.4 `render_align_compare()`

Streamlit UI 函数。

流程：
1. 用 `_list_runs()` 获取所有 run，各用 selectbox 选择 Run A 和 Run B
2. 若两者相同，提示"请选择不同的 run"
3. 各自加载 `aligned_pages.json`，若不存在则提示
4. 调用 `compare_aligned_pages()` 得到 `page_diffs`
5. 顶部显示汇总指标：有差异的页数、总移动句子数、off_slide 变化句数
6. checkbox：`只显示有变化的页`（默认勾选）
7. 对每个 PageDiff 渲染一个 expander：
   - 标题：`Slide N — conf A:0.42 → B:0.50  🟡 有变化` 或 `Slide N — 无变化`
   - `has_diff=True` 的页默认展开，否则默认收起
   - expander 内：
     - 规则推断摘要（`analyze_page_diff_rules` 的 `summary` + 量化数据表格）
     - 按需触发 LLM 按钮（`🤖 Claude 分析`），结果缓存在 `st.session_state`
     - 两列并排句子对比（左 A 右 B）
     - off_slide 区块（两列并排，放在 aligned 句子下方，用分割线隔开）

---

## 5. UI 渲染细节

### 句子行颜色方案

| 状态 | 左列（A） | 右列（B） |
|------|-----------|-----------|
| unchanged | 灰色 caption | 灰色 caption |
| sim_changed | 正常文本 + `sim=0.37` | 正常文本 + `sim=0.45 (+0.08)` 🟡 |
| gone | 正常文本 + `sim=0.37` 🔴 | `──` |
| new | `──` | 正常文本 + `sim=0.45` 🟢 + `(from page 2)` |
| to_off_slide | 正常文本 ⚠️ | 显示在 off_slide 区块 |
| from_off_slide | 显示在 off_slide 区块 | 正常文本 ✅ |

每条句子显示：`[MM:SS–MM:SS] 句子文本  sim=0.61`

### off_slide 区块

```
──── off_slide ────
[左列 A 的 off_slide]     [右列 B 的 off_slide]
```

off_slide 句子状态：
- 两边都是 off_slide：灰色 caption
- A 是 off_slide，B 变成 aligned：🟢 `→ 升为 aligned (page N)`
- A 是 aligned，B 变成 off_slide：🔴 `← 降为 off_slide`

---

## 6. LLM Prompt 模板

```
你是一个 AI 对齐质量分析助手。以下是一段讲座录音与 PPT 对齐结果的两个版本的对比数据，请分析变化原因并给出建议。

页面：Slide {page_num}
PPT 文本：{ppt_text[:200]}

【Run A ({run_id_a})】
- 置信度：{conf_a:.3f}
- Aligned 句子数：{seg_count_a}，平均 similarity：{sim_mean_a:.3f}
- Off_slide 句子数：{len(off_slide_a)}

【Run B ({run_id_b})】
- 置信度：{conf_b:.3f}
- Aligned 句子数：{seg_count_b}，平均 similarity：{sim_mean_b:.3f}
- Off_slide 句子数：{len(off_slide_b)}

【变化详情】
移入句子（B有A无）：{moved_in}
移出句子（A有B无）：{moved_out}
Off_slide 变化：{off_slide_changed}
Similarity 变化显著的句子：{sim_changed_segs}

请用中文分析：
1. 这些变化的可能原因
2. 变化是否合理（改动方向是否正确）
3. 一句话建议

输出格式：直接输出分析内容，不要加额外标题。
```

---

## 7. 文件边界总结

| 文件 | 改动类型 | 内容 |
|------|----------|------|
| `backend/test_ui/align_compare.py` | 新建 | 全部逻辑 |
| `backend/test_ui/pipeline.py` | 追加 2 行 | import + 调用 `render_align_compare()` |

`helpers.py`、`dashboard.py`、`test_app.py` 均不改动。

---

## 8. 不在本次 scope 内

- 对比结果的持久化/导出
- 多于两个版本的对比（只支持 A vs B）
- aligned_pages 以外的 JSON 文件对比（asr_segments、notes 等）
