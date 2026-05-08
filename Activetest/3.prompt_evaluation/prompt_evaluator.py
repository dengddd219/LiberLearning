"""
prompt_evaluator.py

LiberStudy active learning 笔记质量评估模块。
评估三个维度：
  Method 1 — 事实覆盖率：笔记是否覆盖了 gold_facts 中的关键知识点
  Method 2 — 重叠与矛盾：笔记与 transcript（2A）或理想笔记（2B）的信息关系
  Method 3 — 锚点保留率：AI 笔记是否以学生批注为出发点扩展

用法：
  python prompt_evaluator.py
"""

import json
import os
import re
import pathlib
from collections import Counter
from typing import Any

import anthropic
from dotenv import load_dotenv

# ── 路径 & 配置 ───────────────────────────────────────────────────────────────
DIR = pathlib.Path(__file__).resolve().parent
INPUTS = DIR / "inputs"
OUTPUTS = DIR / "outputs"
OUTPUTS.mkdir(exist_ok=True)

# 从项目 backend/.env 加载 API 配置
_ENV = DIR.parents[1] / "backend" / ".env"
load_dotenv(_ENV)

_CLIENT: anthropic.Anthropic | None = None


def _get_client() -> tuple[anthropic.Anthropic, str]:
    global _CLIENT
    if _CLIENT is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
        _CLIENT = anthropic.Anthropic(
            api_key=api_key,
            **({"base_url": base_url} if base_url else {}),
        )
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    return _CLIENT, model


def call_llm(system: str, user: str) -> str:
    """调用 Claude API，temperature=0 确保评估结果可复现。"""
    client, model = _get_client()
    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        temperature=0,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return resp.content[0].text


# ── 共用 JSON 解析 ─────────────────────────────────────────────────────────────
def _parse_json(text: str) -> dict[str, Any]:
    """从 LLM 输出中提取 JSON 对象，正则兜底。"""
    # 优先直接解析
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    # 提取第一个 {...} 块
    match = re.search(r"\{[\s\S]*?\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


# ── Method 1：事实覆盖率 ───────────────────────────────────────────────────────
_FACT_SYSTEM = """\
You will be provided with text delimited by triple quotes that is supposed to be \
the answer to a question. Check if the following pieces of information are directly \
contained in the answer:
{facts_list}

For each of these points perform the following steps:
1 - Restate the point.
2 - Provide a citation from the answer which is closest to this point.
3 - Consider if someone reading the citation who doesn't know the topic could \
directly infer the point. Explain why or why not before making up your mind.
4 - Write "yes" if the answer to 3 was yes, otherwise write "no".

Finally, provide a count of how many "yes" answers there are. \
Provide this count as {{"count": <insert count here>}}.\
"""


def count_facts(generated_note: str, gold_facts: list[str], n_runs: int = 3) -> dict[str, Any]:
    """
    Method 1：统计 generated_note 中覆盖了多少条 gold_facts。
    n_runs 次取平均，消除 LLM 随机性。

    Returns:
        {"count": float}  — 最大值为 len(gold_facts)
    """
    facts_list = "\n".join(f"- {f}" for f in gold_facts)
    system = _FACT_SYSTEM.format(facts_list=facts_list)
    user = f'"""{generated_note}"""'

    counts = []
    for _ in range(n_runs):
        raw = call_llm(system, user)
        result = _parse_json(raw)
        if "count" in result:
            counts.append(int(result["count"]))
        else:
            counts.append(len(re.findall(r"\byes\b", raw, re.IGNORECASE)))

    avg = round(sum(counts) / len(counts), 1)
    return {"count": avg, "runs": counts}


# ── Method 2：重叠与矛盾 ───────────────────────────────────────────────────────
_OVERLAP_SYSTEM = """\
Use the following steps to respond to user inputs. \
Fully restate each step before proceeding. i.e. "Step 1: Reason...".
Step 1: Reason step-by-step about whether the information in the submitted answer \
compared to the expert answer is either: disjoint, equal, a subset, a superset, \
or overlapping (i.e. some intersection but not subset/superset).
Step 2: Reason step-by-step about whether the submitted answer contradicts any \
aspect of the expert answer.
Step 3: Output a JSON object structured like: \
{{"type_of_overlap": "disjoint" or "equal" or "subset" or "superset" or "overlapping", \
"contradiction": true or false}}\
"""

_OVERLAP_TYPES = {"disjoint", "equal", "subset", "superset", "overlapping"}


def check_overlap(
    generated_note: str, expert: str, n_runs: int = 3
) -> dict[str, Any]:
    """
    Method 2：评估 generated_note 与 expert 的信息重叠类型及矛盾。
    n_runs 次多数投票，消除 LLM 随机性。
    expert 可以是 transcript（2A 幻觉检测）或理想笔记（2B 结构对齐）。

    Returns:
        {"type_of_overlap": str, "contradiction": bool}
    """
    user = f'Expert Answer: """{expert}"""\nSubmitted Answer: """{generated_note}"""'

    overlaps: list[str] = []
    contradictions: list[bool] = []

    for _ in range(n_runs):
        raw = call_llm(_OVERLAP_SYSTEM, user)
        result = _parse_json(raw)

        overlap = result.get("type_of_overlap", "")
        if overlap not in _OVERLAP_TYPES:
            for t in _OVERLAP_TYPES:
                if t in raw.lower():
                    overlap = t
                    break
        if overlap in _OVERLAP_TYPES:
            overlaps.append(overlap)

        contradiction = result.get("contradiction", None)
        if contradiction is None:
            if re.search(r"\btrue\b", raw, re.IGNORECASE):
                contradiction = True
            elif re.search(r"\bfalse\b", raw, re.IGNORECASE):
                contradiction = False
        if contradiction is not None:
            contradictions.append(bool(contradiction))

    # 多数投票
    overlap_vote = Counter(overlaps).most_common(1)[0][0] if overlaps else "unknown"
    contradiction_vote = Counter(contradictions).most_common(1)[0][0] if contradictions else None

    return {
        "type_of_overlap": overlap_vote,
        "contradiction": contradiction_vote,
        "runs_overlap": overlaps,
        "runs_contradiction": contradictions,
    }


# ── Method 3：锚点保留率 ───────────────────────────────────────────────────────
_ANCHOR_SYSTEM = """\
You are evaluating whether an AI-generated study note preserves the student's \
original perspective and key concepts.

Use the following steps:
Step 1: List the key concepts and perspective from the Student Note. \
Note: the student note may be complete sentences or scattered keywords — \
treat both equally as anchors.
Step 2: For each anchor, find whether the Generated Note expands from that anchor \
(uses it as a starting point) or ignores it entirely.
Step 3: Calculate the ratio of preserved anchors to total anchors.
Step 4: Output a JSON object structured like: \
{{"anchor_preserved": true or false, \
"coverage_ratio": <float between 0.0 and 1.0>, \
"ignored_anchors": ["<anchor 1>", "<anchor 2>"]}} \
anchor_preserved is true if coverage_ratio >= 0.7\
"""


def check_anchor(
    generated_note: str, user_note: str, n_runs: int = 3
) -> dict[str, Any]:
    """
    Method 3：评估 AI 笔记是否以学生批注为出发点扩展。
    n_runs 次取平均 coverage_ratio，多数投票 anchor_preserved。
    兼容完整句子和零散关键词两种批注粒度。

    Returns:
        {"anchor_preserved": bool, "coverage_ratio": float, "ignored_anchors": list[str]}
    """
    user = f'Student Note: """{user_note}"""\nGenerated Note: """{generated_note}"""'

    preserved_votes: list[bool] = []
    ratios: list[float] = []
    ignored_sets: list[list] = []

    for _ in range(n_runs):
        raw = call_llm(_ANCHOR_SYSTEM, user)
        result = _parse_json(raw)
        if "anchor_preserved" in result:
            preserved_votes.append(bool(result["anchor_preserved"]))
        if "coverage_ratio" in result:
            ratios.append(float(result["coverage_ratio"]))
        if "ignored_anchors" in result:
            ignored_sets.append(list(result["ignored_anchors"]))

    avg_ratio = round(sum(ratios) / len(ratios), 2) if ratios else 0.0
    preserved = Counter(preserved_votes).most_common(1)[0][0] if preserved_votes else False
    # 取出现最多的 ignored_anchors 列表（用最后一次作为代表）
    ignored = ignored_sets[-1] if ignored_sets else []

    return {
        "anchor_preserved": preserved,
        "coverage_ratio": avg_ratio,
        "ignored_anchors": ignored,
        "runs_ratio": ratios,
    }


# ── 批量评估入口 ───────────────────────────────────────────────────────────────
def evaluate_version(
    version: str,
    generated_note: str,
    gold_facts: list[str],
    expert_transcript: str,
    expert_ideal_note: str,
    user_note: str,
    n_runs: int = 3,
) -> dict[str, Any]:
    """对单个 prompt 版本运行全部三个评估方法，返回汇总结果。"""
    print(f"  评估 {version}（每方法 {n_runs} 次）...")

    m1  = count_facts(generated_note, gold_facts, n_runs)
    m2a = check_overlap(generated_note, expert_transcript, n_runs)
    m2b = check_overlap(generated_note, expert_ideal_note, n_runs)
    m3  = check_anchor(generated_note, user_note, n_runs)

    return {
        "version": version,
        "method1_fact_coverage": m1,
        "method2a_vs_transcript": m2a,
        "method2b_vs_ideal_note": m2b,
        "method3_anchor_preservation": m3,
    }


# ── __main__ ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # 加载输入数据
    gold_facts: list[str] = json.loads((INPUTS / "gold_facts.json").read_text(encoding="utf-8"))
    expert_transcript = (INPUTS / "transcript.md").read_text(encoding="utf-8")
    expert_ideal_note = (INPUTS / "expert_ideal_note.md").read_text(encoding="utf-8")
    user_note = (INPUTS / "student_note.md").read_text(encoding="utf-8")

    # 加载所有版本的生成笔记
    notes_dir = INPUTS / "generated_notes"
    versions = sorted(notes_dir.glob("*.md"))

    all_results: list[dict] = []

    print(f"找到 {len(versions)} 个版本，开始评估...\n")

    for note_file in versions:
        version = note_file.stem  # e.g. "v0", "v3.1"
        generated_note = note_file.read_text(encoding="utf-8")

        result = evaluate_version(
            version=version,
            generated_note=generated_note,
            gold_facts=gold_facts,
            expert_transcript=expert_transcript,
            expert_ideal_note=expert_ideal_note,
            user_note=user_note,
        )
        all_results.append(result)

        # 保存单版本结果
        out_file = OUTPUTS / f"results_{version}.json"
        out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    # 打印汇总对比表
    print("\n" + "=" * 80)
    print(f"{'版本':<8} {'事实覆盖':>8} {'重叠(transcript)':>18} {'矛盾(T)':>8} {'重叠(理想)':>12} {'矛盾(I)':>8} {'锚点保留':>8} {'覆盖率':>8}")
    print("-" * 80)
    for r in all_results:
        v = r["version"]
        count = r["method1_fact_coverage"].get("count", "?")
        ov_t = r["method2a_vs_transcript"].get("type_of_overlap", "?")
        ct_t = r["method2a_vs_transcript"].get("contradiction", "?")
        ov_i = r["method2b_vs_ideal_note"].get("type_of_overlap", "?")
        ct_i = r["method2b_vs_ideal_note"].get("contradiction", "?")
        anc = r["method3_anchor_preservation"].get("anchor_preserved", "?")
        ratio = r["method3_anchor_preservation"].get("coverage_ratio", "?")
        print(f"{v:<8} {f'{count}/10':>8} {ov_t:>18} {str(ct_t):>8} {ov_i:>12} {str(ct_i):>8} {str(anc):>8} {str(ratio):>8}")

    # 保存汇总 JSON
    summary_file = OUTPUTS / "summary.json"
    summary_file.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n结果已保存至 {OUTPUTS}/")
