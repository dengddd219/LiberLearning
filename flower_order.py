"""
美团花店订单费用计算器
使用 Claude API + 提示词工程，根据自然语言订单信息计算费用
"""

import anthropic
import json
import os
import re
from pathlib import Path
from dotenv import load_dotenv

# 加载 backend/.env
env_path = Path(__file__).parent / "backend" / ".env"
load_dotenv(env_path)

SYSTEM_PROMPT = """你是美团花店的订单计费助手。根据用户提供的订单信息，严格按照以下规则逐步计算费用，最终输出 JSON。

## 计费规则

### 第一步：确定花束类型和基础价
- 3到5枝 → 小束，基础价 88 元
- 6到11枝 → 中束，基础价 168 元
- 12到20枝 → 大束，基础价 288 元

### 第二步：计算花材加价（每枝单独计算）
- 玫瑰：每枝 +5 元
- 百合：每枝 +8 元
- 向日葵：每枝 +3 元
- 康乃馨：每枝 +0 元（不加价）
- 花材加价合计 = 各花材枝数 × 对应单价之和

### 第三步：会员折扣（仅作用于花材加价）
- 若是会员：花材加价 × 0.8，结果向下取整（去掉小数）
- 若非会员：花材加价不变

### 第四步：计算节日加价（仅在情人节或母亲节时适用）
- 节日加价基数 = 基础价 + 折后花材加价
- 节日附加费 = 节日加价基数 × 20%，结果向上取整
- 注意：包装费和配送费不参与节日加价

### 第五步：计算包装费
- 豪华包装：+30 元
- 礼盒：+50 元
- 普通包装：+0 元

### 第六步：计算配送费
- 自提：0 元
- 配送距离 ≤ 5 公里：0 元（免费）
- 配送距离 > 5 公里：超出部分按每公里 3 元计算，不足 1 公里按 1 公里算
  - 超出距离 = 总距离 - 5（公里）
  - 超出距离向上取整后 × 3

### 第七步：汇总
order_price = 基础价 + 折后花材加价 + 节日附加费（如有）+ 包装费 + 配送费
delivery_fee = 配送费（自提为 0）
bouquet_type = 花束类型（"小束"/"中束"/"大束"）

## 输出要求
先写出每一步的计算过程（用于验证），最后一行输出标准 JSON：
{"order_price": <整数>, "delivery_fee": <整数>, "bouquet_type": "<小束|中束|大束>"}

JSON 必须在最后一行，格式严格，不加任何其他内容。"""


def extract_json(text: str) -> dict:
    """从模型输出中提取最后一个 JSON 对象"""
    matches = re.findall(r'\{[^{}]+\}', text)
    if not matches:
        raise ValueError(f"未找到 JSON，模型输出：\n{text}")
    return json.loads(matches[-1])


def calculate_order(order_text: str) -> dict:
    """调用 Claude API 计算订单费用"""
    client = anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url=os.environ.get("ANTHROPIC_BASE_URL"),
    )

    message = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": order_text}
        ]
    )

    raw_output = message.content[0].text
    print("=== 模型推理过程 ===")
    print(raw_output)
    print("===================\n")

    return extract_json(raw_output)


def main():
    print("美团花店订单计费系统（提示词工程版）")
    print("输入订单信息（自然语言），输入 'quit' 退出\n")

    # 内置测试用例
    test_cases = [
        "5枝玫瑰，普通包装，配送3公里，非节日，非会员。",
        "8枝百合，豪华包装，配送7公里，非节日，会员。",
        "15枝玫瑰，礼盒，自提，情人节，非会员。",
    ]

    print("=== 内置测试用例 ===")
    for i, case in enumerate(test_cases, 1):
        print(f"\n测试 {i}: {case}")
        try:
            result = calculate_order(case)
            print(f"结果: {json.dumps(result, ensure_ascii=False)}")
        except Exception as e:
            print(f"错误: {e}")

    print("\n=== 交互模式 ===")
    while True:
        user_input = input("请输入订单信息（或 'quit' 退出）: ").strip()
        if user_input.lower() == 'quit':
            break
        if not user_input:
            continue
        try:
            result = calculate_order(user_input)
            print(f"计算结果: {json.dumps(result, ensure_ascii=False)}\n")
        except Exception as e:
            print(f"计算出错: {e}\n")


if __name__ == "__main__":
    main()
