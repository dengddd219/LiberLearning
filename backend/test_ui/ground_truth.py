"""
Ground Truth 标签页 — 人工标注 ASR 句子所属 PPT 页码。

UI 设计：
- 所有句子平铺显示（不折叠）
- 每句直接显示页码单选按钮，随时可更改
- 每页有两个选项：Slide N（PPT 文本直接覆盖）和 Slide N (ext)（老师口头扩展，不在 PPT 文本中但属于该页）
- 一个保存按钮，最后统一保存
"""
import streamlit as st

from test_ui.helpers import (
    _asr_path, _ppt_path, _gt_path,
    _load_json, _save_json,
)


def _fmt_time(sec: float) -> str:
    s = int(sec)
    return f"{s // 60:02d}:{s % 60:02d}"


def _load_gt() -> dict:
    p = _gt_path()
    return _load_json(p) if p.exists() else {}


def render_ground_truth():
    st.title("Ground Truth 标注")

    if not _asr_path().exists():
        st.info("请先完成 Step 2（ASR 转录）再进行标注。")
        return

    segments: list[dict] = _load_json(_asr_path())
    if not segments:
        st.info("ASR 转录结果为空。")
        return

    # 读取 PPT 页码列表（用于选项）
    # 每页两个选项：Slide N（PPT 文本直接覆盖）、Slide N (ext)（口头扩展，不在 PPT 文本中）
    if _ppt_path().exists():
        ppt_pages: list[dict] = _load_json(_ppt_path())
        page_nums = [p["page_num"] for p in ppt_pages]
    else:
        page_nums = list(range(1, 21))
    page_options: list[str] = []
    for n in page_nums:
        page_options.append(f"Slide {n}")
        page_options.append(f"Slide {n} (ext)")
    page_options.append("off-slide")

    # 从磁盘加载已有标注，作为初始值
    saved_gt: dict = _load_gt()

    st.caption(f"共 {len(segments)} 条句子，每句选择所属页码后点击底部「保存」。")
    st.divider()

    # 用 session_state 暂存本次选择
    state_key = "gt_labels"
    if state_key not in st.session_state:
        # 初始化：优先用磁盘已有标注
        init: dict[str, str] = {}
        for i, seg in enumerate(segments):
            saved = saved_gt.get(f"seg_{i}", {})
            if isinstance(saved, dict):
                page_label = saved.get("page_label", "")
            else:
                # 兼容旧格式（直接存 page_num int）
                pn = saved.get("page_num") if isinstance(saved, dict) else None
                page_label = f"Slide {pn}" if pn else ""
            init[f"seg_{i}"] = page_label
        st.session_state[state_key] = init

    labels: dict[str, str] = st.session_state[state_key]

    # 平铺渲染每条句子
    for i, seg in enumerate(segments):
        seg_key = f"seg_{i}"
        ts = _fmt_time(seg.get("start", 0))
        te = _fmt_time(seg.get("end", 0))
        text = seg.get("text", "")

        current_label = labels.get(seg_key, "")
        # 计算默认 index（未标注时默认选第一个）
        try:
            default_idx = page_options.index(current_label) if current_label in page_options else 0
        except ValueError:
            default_idx = 0

        col_info, col_radio = st.columns([2, 3])
        with col_info:
            st.markdown(f"**#{i+1}** `[{ts}–{te}]`")
            st.caption(text[:120] + ("…" if len(text) > 120 else ""))
        with col_radio:
            chosen = st.radio(
                label="所属页面",
                options=page_options,
                index=default_idx,
                key=f"radio_{seg_key}",
                horizontal=True,
                label_visibility="collapsed",
            )
            labels[seg_key] = chosen

        st.divider()

    # 统一保存按钮
    if st.button("💾 保存所有标注", type="primary"):
        gt_data: dict = {}
        for i, seg in enumerate(segments):
            seg_key = f"seg_{i}"
            label = labels.get(seg_key, "")
            if label == "off-slide":
                page_num = None
                is_extension = False
            elif label.endswith(" (ext)"):
                base = label[: -len(" (ext)")]
                try:
                    page_num = int(base.replace("Slide ", ""))
                except ValueError:
                    page_num = None
                is_extension = True
            else:
                try:
                    page_num = int(label.replace("Slide ", ""))
                except ValueError:
                    page_num = None
                is_extension = False
            gt_data[seg_key] = {
                "page_label": label,
                "page_num": page_num,
                "is_extension": is_extension,
                "text": seg.get("text", ""),
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
            }
        _save_json(_gt_path(), gt_data)
        st.success(f"已保存 {len(gt_data)} 条标注至 ground_truth.json")

    # 准确率评估（5条以上时显示）
    labeled = {k: v for k, v in saved_gt.items() if isinstance(v, dict) and v.get("page_num")}
    if len(labeled) >= 5 and _asr_path().exists():
        st.divider()
        st.subheader("准确率评估（基于已保存标注）")
        from test_ui.helpers import _aligned_path, _render_accuracy_table
        if _aligned_path().exists():
            aligned = _load_json(_aligned_path())
            _render_accuracy_table(segments, [], aligned, saved_gt)
        else:
            st.info("请先完成 Step 3（语义对齐）再查看准确率。")
