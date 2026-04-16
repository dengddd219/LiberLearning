"""AI Frontpage Ask — 笔记页内联问答测试平台。"""
from pathlib import Path

import streamlit as st

# ── Prompt 路径 ────────────────────────────────────────────────────────────────
PROMPTS_BASE = Path(__file__).parent.parent.parent / "prompts"
TEMPLATE_NAME = "ai_frontpage_ask"


def _prompt_dir() -> Path:
    d = PROMPTS_BASE / TEMPLATE_NAME
    d.mkdir(exist_ok=True)
    return d


def _load_prompt() -> str:
    """加载主 prompt.md"""
    p = _prompt_dir() / "prompt.md"
    if p.exists():
        return p.read_text(encoding="utf-8")
    return ""


def _save_prompt(text: str):
    _prompt_dir().mkdir(exist_ok=True, parents=True)
    (_prompt_dir() / "prompt.md").write_text(text, encoding="utf-8")


# ── 测试数据 ───────────────────────────────────────────────────────────────────
DEMO_PPT_TEXT = """梯度下降的核心思想

沿损失函数负梯度方向迭代更新参数，使模型逐步逼近最优解。学习率 η 控制每步步长，过大会震荡，过小会收敛慢。

反向传播算法（Backprop）

链式法则逐层计算梯度，从输出层往输入层传播误差信号，每层只需知道上层传来的梯度即可完成本层更新。"""

DEMO_BULLET = {
    "ppt_text": "梯度下降的核心思想：沿损失函数负梯度方向迭代更新参数，使模型逐步逼近最优解。学习率 η 控制每步步长，过大会震荡，过小会收敛慢。",
    "ai_comment": "学习率 η 是超参数，建议从 0.001 开始调参，使用 Adam 优化器可以自动调节学习率。",
}

DEMO_QUESTION = "学习率 η 太大为什么会震荡？"


def _render_prompt_preview(system_text: str, ppt_text: str, ai_comment: str, question: str) -> str:
    """构造发给 LLM 的完整 messages 数组（JSON 字符串）。"""
    import json

    system_content = system_text.replace("{{ppt_text}}", ppt_text)
    system_content = system_content.replace("{{ai_comment}}", ai_comment or "(无)")
    system_content = system_content.replace("{{question}}", question)

    # 提取 SYSTEM 和 USER 部分（简化展示）
    # 实际传给 LLM 的格式
    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": question},
    ]
    return json.dumps(messages, ensure_ascii=False, indent=2)


def render_ai_frontpage_ask():
    st.title("💬 AI Frontpage Ask — 测试平台")

    # ── 左侧：PPT 内容输入 ───────────────────────────────────────────────────
    left, right = st.columns([1, 1])

    with left:
        st.subheader("📄 PPT 内容")

        ppt_text = st.text_area(
            "PPT 文字（bullet 原文）",
            value=DEMO_BULLET["ppt_text"],
            height=160,
            key="afa_ppt_text",
        )
        ai_comment = st.text_area(
            "AI 注释（可选）",
            value=DEMO_BULLET["ai_comment"],
            height=80,
            key="afa_ai_comment",
        )

        st.divider()
        st.subheader("❓ 用户问题")
        question = st.text_area(
            "输入问题",
            value=DEMO_QUESTION,
            height=60,
            key="afa_question",
        )

        # ── 模型选择 ──────────────────────────────────────────────────────────
        st.divider()
        st.subheader("🤖 模型")
        model_options = {
            "中转站 (Claude)": "claude",
            "通义千问": "qwen",
            "DeepSeek": "deepseek",
            "豆包": "doubao",
        }
        selected_label = st.selectbox("选择模型", list(model_options.keys()), key="afa_model")

        if st.button("🚀 发送请求", type="primary", use_container_width=True):
            with st.spinner("调用中..."):
                import json, httpx, os
                from openai import OpenAI

                model_key = model_options[selected_label]

                # 组装 system prompt
                system_raw = _load_prompt()
                system_filled = system_raw.replace("{{ppt_text}}", ppt_text)
                system_filled = system_filled.replace("{{ai_comment}}", ai_comment or "(无)")
                system_filled = system_filled.replace("{{question}}", question)

                # 提取实际 system content（去掉模板变量标记）
                # prompt.md 结构：SYSTEM ... CONTENT ... USER
                # 简单处理：取 --- 之前的内容作为 system
                parts = system_filled.split("---")
                system_part = parts[0] if parts else system_filled

                messages = [
                    {"role": "system", "content": system_part.strip()},
                    {"role": "user", "content": question},
                ]

                # 调用对应模型
                answer = ""
                try:
                    if model_key == "claude":
                        client = OpenAI(
                            api_key=os.getenv("ANTHROPIC_API_KEY"),
                            base_url="https://api.anthropic.com/v1",
                        )
                        # 用 Anthropic SDK
                        import anthropic
                        c = anthropic.Anthropic(
                            api_key=os.getenv("ANTHROPIC_API_KEY"),
                            base_url="https://api.anthropic.com",
                        )
                        resp = c.messages.create(
                            model="claude-sonnet-4-20250514",
                            max_tokens=1024,
                            system=system_part.strip(),
                            messages=[{"role": "user", "content": question}],
                        )
                        answer = resp.content[0].text

                    elif model_key == "qwen":
                        client = OpenAI(
                            api_key=os.getenv("DASHSCOPE_API_KEY"),
                            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                        )
                        resp = client.chat.completions.create(
                            model="qwen-plus",
                            messages=messages,
                        )
                        answer = resp.choices[0].message.content

                    elif model_key == "deepseek":
                        client = OpenAI(
                            api_key=os.getenv("DEEPSEEK_API_KEY"),
                            base_url="https://api.deepseek.com/v1",
                        )
                        resp = client.chat.completions.create(
                            model="deepseek-chat",
                            messages=messages,
                        )
                        answer = resp.choices[0].message.content

                    elif model_key == "doubao":
                        client = OpenAI(
                            api_key=os.getenv("DOUBAO_API_KEY"),
                            base_url="https://ark.cn-beijing.volces.com/api/v3",
                        )
                        resp = client.chat.completions.create(
                            model="doubao-pro-32k",
                            messages=messages,
                        )
                        answer = resp.choices[0].message.content

                except Exception as e:
                    answer = f"❌ 调用失败：{e}"

                st.session_state["afa_answer"] = answer

    # ── 右侧：Prompt 编辑 + 流程展示 ─────────────────────────────────────────
    with right:
        st.subheader("📝 Prompt 编辑（实时保存）")
        prompt_text = st.text_area(
            "编辑 prompt 模板",
            value=_load_prompt() or _get_default_prompt(),
            height=300,
            key="afa_prompt_edit",
            label_visibility="collapsed",
        )

        if st.button("💾 保存 Prompt", use_container_width=True):
            _save_prompt(prompt_text)
            st.success("Prompt 已保存到 backend/prompts/ai_frontpage_ask/prompt.md")

        st.divider()
        st.subheader("🔄 流程展示")

        # Step 1: Bullet Context
        with st.expander("Step 1 — Bullet Context（发送给 LLM 的上下文）", expanded=True):
            ctx_lines = []
            ctx_lines.append(f"**ppt_text:**\n{ppt_text or '(空)'}")
            if ai_comment:
                ctx_lines.append(f"\n**ai_comment:**\n{ai_comment}")
            ctx_lines.append(f"\n**question:**\n{question or '(空)'}")
            st.markdown("\n".join(ctx_lines))

        # Step 2: System Prompt
        with st.expander("Step 2 — System Prompt（替换模板变量后）", expanded=True):
            sys_filled = prompt_text
            sys_filled = sys_filled.replace("{{ppt_text}}", ppt_text or "(空)")
            sys_filled = sys_filled.replace("{{ai_comment}}", ai_comment or "(无)")
            sys_filled = sys_filled.replace("{{question}}", question or "(空)")
            st.text_area(
                "System 部分",
                value=sys_filled,
                height=200,
                key="afa_sys_preview",
                label_visibility="collapsed",
            )

        # Step 3: Final Messages
        with st.expander("Step 3 — Final Messages（实际发给 LLM 的格式）", expanded=True):
            import json
            sys_clean = sys_filled.split("---")[0].strip() if "---" in sys_filled else sys_filled.strip()
            messages = [
                {"role": "system", "content": sys_clean},
                {"role": "user", "content": question or ""},
            ]
            st.json(messages)

        # Step 4: LLM Response
        with st.expander("Step 4 — LLM 回答", expanded=True):
            answer = st.session_state.get("afa_answer", "")
            if answer:
                st.markdown(answer)
            else:
                st.info("点击左侧「发送请求」查看结果")


def _get_default_prompt() -> str:
    return """# Template: AI Frontpage Ask — 笔记页内联问答

当用户在笔记页面点击"针对此条提问"时，使用此 prompt 向大模型发送请求。

---

## SYSTEM

你是一位耐心的高校课程助教，基于以下课件原文回答学生问题。如果课件中没有相关信息，诚实告知学生。

回答要求：
- 简洁，用中文
- 如涉及公式，用 $...$ 或 $$...$$ 包裹 LaTeX
- 如果原课件没有足够信息回答，诚实说"这页内容没有涉及，我会帮你联系相关知识点..."
- 不要编造课件中没有的内容
- 用**加粗**标注关键术语

---

## CONTENT

以下是你要回答的课件原文：

'''
{{ppt_text}}
'''

{% if ai_comment %}
---
补充注释（老师/AI 已添加）：
'''
{{ai_comment}}
'''
{% endif %}

---

## USER

{{question}}
"""
