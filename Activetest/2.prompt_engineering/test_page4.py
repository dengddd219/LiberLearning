"""
test_page4.py
用 lec01 page 4（Training Error vs Generalization Error）测试 v5.0 prompt。
学生批注为模拟的碎片化笔记（无真实批注）。
运行：python "Activetest/2.prompt_engineering/test_page4.py"
"""

import os
import pathlib
from dotenv import load_dotenv
import anthropic

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = pathlib.Path(__file__).resolve().parent
PROMPT_FILE = DIR / "prompt_v5.0.md"
ENV_FILE = REPO_ROOT / "backend" / ".env"

load_dotenv(ENV_FILE)

API_KEY    = os.environ["ANTHROPIC_API_KEY"]
BASE_URL   = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
MODEL      = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# ── 测试数据：lec01 page 4 ────────────────────────────────────────
STUDENT_NOTE = """
训练误差 ≠ 泛化误差，在训练集上表现好不代表新数据也好。
死记硬背 vs 理解原理——学生A和B的例子。
""".strip()

PPT_TEXT = """
Training Error and Generalization Error
• Training error (bias): model error on the training data
• Generalization error (variance): model error on new data
• Example: practice a future exam with past exams
• Doing well on past exams (training error) doesn't guarantee a good score on the future exam (generalization error)
• Student A gets 0 error on past exams by rote learning
• Student B understands the reasons for given answers
""".strip()

TRANSCRIPT = """
[4:37] training error means the error on the training data set.
[4:42] And generalization error refers to your error on a new data.
[4:47] And we always say that the performance on the training data does not represent the performance on a new data set.
[4:56] This is very similar to we make practices for a future exam with past exams.
[5:03] For those who do well on past exam, that means you get a very small training error that does not guarantee a good score on the future exam, where the future exam actually represent the generalization error.
[5:19] And one student may get zero error on past exam by rote learning. That means he remember all the answers mechanically.
[5:29] But that student may have a worse score compared to another student who understand the reasons for a given number of answers.
[5:37] So even if student B may not have good score on past exam, as long as he can understand the reasonings, he should be able to have a higher score.
[5:50] So this is the trade-off we have mentioned about training and generalization, or they call it bias and variance in some cases.
[6:03] So because of that, we need to evaluate our model to understand whether it has a good generalization performance.
[6:12] So in this process, we say that we can have two data sets. One data set is called validation data set. This is the data used to evaluate the model.
[6:23] And this data should not be mixed with your training data. And the validation data set will be used to do model selection.
[6:32] The test data set will be the data set to evaluate your final performance. So that could be a future exam or the house sale price I bid, or the data set used in private leaderboard in Kaggle.
""".strip()

# ── 注入 prompt ───────────────────────────────────────────────────
prompt_tpl = PROMPT_FILE.read_text(encoding="utf-8").strip()
user_message = (
    prompt_tpl
    .replace("{USER_NOTE}", STUDENT_NOTE)
    .replace("{PPT_TEXT}", PPT_TEXT)
    .replace("{TRANSCRIPT}", TRANSCRIPT)
)

print(f"模型: {MODEL}  |  Prompt: {PROMPT_FILE.name}")
print(f"测试页面: lec01 page 4 — Training Error vs Generalization Error")
print("=" * 60)
print("调用中...\n")

client = anthropic.Anthropic(api_key=API_KEY, base_url=BASE_URL)

response = client.messages.create(
    model=MODEL,
    max_tokens=2048,
    messages=[{"role": "user", "content": user_message}],
)

usage = response.usage
raw = response.content[0].text if response.content else ""

print(f"[stop_reason: {response.stop_reason} | input={usage.input_tokens} output={usage.output_tokens}]")
print()
print("【AI 扩写结果】")
print(raw if raw else "(空输出)")
