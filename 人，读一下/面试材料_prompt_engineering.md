# LiberStudy Prompt Engineering 面试材料

## 一句话定位

> 我为 LiberStudy 的 active learning 笔记生成功能，从零搭建了一套 prompt 迭代 + 自动化评估的完整闭环，历经 v0 到 v5.0 共 6 个版本，将笔记的事实覆盖率从 baseline 的 40% 提升至 100%，同时保持零幻觉。

---

## 一、业务背景与问题定义

**产品是什么**：LiberStudy 是一个课堂笔记工具。学生上课时在 PPT 上写批注，课后系统结合 PPT 文本 + 老师讲课文字稿 + 学生批注，用 LLM 生成结构化复习笔记。

**核心场景**：active learning 笔记生成——学生写了"树模型和神经网络不能直接比复杂度"，AI 要把这句话扩展成一份完整的、有支撑论据的复习笔记。

**为什么需要 prompt 工程**：这不是一个有标准答案的任务。输入是学生的碎片化批注（可能是完整句子，也可能是零散关键词），输出要同时满足：
1. 覆盖老师讲的所有关键知识点（不能漏）
2. 不能编造 transcript 里没有的内容（不能幻觉）
3. 必须以学生自己的视角和关键词为骨架（不能另起炉灶）

这三个目标之间存在张力，不能靠一个简单 prompt 同时满足，需要系统性迭代。

---

## 二、如何定义"好的笔记"

在写第一行 prompt 之前，我先定义了评估标准，否则迭代没有方向。

**"好笔记"的 4 条假设**（MVP 阶段，可被数据推翻）：

| 维度 | 定义 | 对应指标 |
|------|------|---------|
| 知识点不遗漏 | 老师讲的核心概念必须都在 | 事实覆盖率（Method 1）|
| 不能有幻觉 | 笔记内容不能与原始 transcript 矛盾 | 幻觉检测（Method 2A）|
| 保留学生认知锚点 | AI 必须以学生批注的视角为出发点 | 锚点保留率（Method 3）|
| 结构符合复习习惯 | 概念→例子→操作的层级结构 | 结构对齐（Method 2B）|

**为什么不用 BLEU/ROUGE**：这两个指标是字面 n-gram 匹配，适合翻译任务。我的场景里，学生笔记可以用完全不同的措辞表达同一个知识点，字面匹配会误判。我选择 LLM-as-a-Judge，因为它能做细粒度的知识点级别判断，更接近人类评估方式。代价是每次评估约 96 次 API 调用，费用 $0.3-0.5，这是有意识的 tradeoff。

**gold_facts 的来源**：从 transcript 逐句提炼，代表"老师实际讲了什么"，这个事实层面是客观的。但"老师讲了什么"和"学生需要记什么"之间有 gap——这是 MVP 阶段的假设，计划上线后用学生停留时长和笔记复制率来校验。

---

## 三、评估体系的实现

### 核心方法论：LLM-as-a-Judge

我没有用 BLEU/ROUGE 这类字面匹配指标，而是用大模型充当"裁判"来评估笔记质量。这在学术界和工业界被称为 **LLM-as-a-Judge**。

为什么这么选：我的任务是判断"这条知识点有没有被覆盖"，不是"这段文字和参考文本有多像"。学生笔记可以用完全不同的措辞表达同一个知识点，字面匹配会误判。LLM judge 能做细粒度的语义推断，更接近人类评估方式。代价是每次评估约 96 次 API 调用，费用 $0.3-0.5，这是有意识的 tradeoff。

为了防止裁判 AI 胡乱打分，我给每个方法设计了严格的 step-by-step 推理规则，强制模型先推理再输出结论。

---

### Method 1 — 事实覆盖率（Counting Facts）

**回答的问题**：笔记有没有覆盖老师讲的 10 条关键知识点？

**评估逻辑**：这是一种"采分点"式的方法，类似老师改卷子。预先定义好 10 条 gold_facts，让 judge 逐一检查笔记里有没有包含这些点。

Judge 被强制走 4 步：
1. 重述这个知识点
2. 从笔记中提取最接近的原话作为证据
3. 判断：一个完全不懂背景知识的人，能不能从这句原话里**直接推导出**这个知识点（排除"脑补"）
4. 判定 Yes 或 No，最后输出 `{"count": N}`

**第 3 步是关键**：它防止 judge 因为"感觉差不多"就给分。比如笔记里写了"在 69 年的夏天，一次伟大的航行……阿姆斯特朗迈出了一步"，人类一看就知道在说登月，但对于一个没有背景知识的人来说，文本里没有明确说"1969年7月21日"，也没有说他是"历史上第一个"——缺乏直接证据，不给分。

**稳定性保障**：temperature=0，每次跑 3 次取平均。

---

### Method 2A/2B — 幻觉检测 + 结构对齐（Overlapping & Contradiction）

**回答的问题**：
- 2A：笔记有没有编造 transcript 里没有的内容，或与 transcript 矛盾？
- 2B：笔记和手写的"理想笔记"相比，信息结构差多少？

**评估逻辑**：将生成笔记和专家答案做整体对比，输出两个维度：

**重合类型（5 种）**：
- `subset`：笔记是专家答案的子集，信息有缺失
- `superset`：笔记包含了专家答案的所有信息，还额外补充了更多
- `equal`：信息量完全一致
- `overlapping`：各有一些对方没有的信息
- `disjoint`：答非所问，毫不相干

**矛盾（contradiction）**：笔记里有没有和专家答案事实冲突的地方，True 或 False。

**举例说明**：
- 笔记写"他是第一个在月球上走过的人" → `subset + False`（信息不全但没说错）
- 笔记写"阿姆斯特朗是第二个登月的人，跟在奥尔德林之后" → `overlapping + True`（日期对了但顺序说反了）
- 笔记写了日期、第一人、还额外补充了精确时间 02:56 UTC → `superset + False`（信息更全且没有矛盾）

**理想结果**：
- 2A（vs transcript）：`subset + False`，说明笔记没有超出原文范围，零幻觉
- 2B（vs 理想笔记）：`equal + False`，说明结构和信息量对齐

---

### Method 3 — 锚点保留率（Anchor Preservation）

**回答的问题**：AI 笔记是否以学生批注为出发点扩展，而不是另起炉灶？

**评估逻辑**：Judge 先列出学生批注的所有关键词和视角，再逐一检查生成笔记是否以这些锚点为骨架展开。兼容两种粒度：完整句子和零散关键词。

输出：`{"anchor_preserved": bool, "coverage_ratio": float, "ignored_anchors": list}`，coverage_ratio ≥ 0.7 则判定为保留。

**理想结果**：`anchor_preserved=True, coverage_ratio=1.0`

---

### 两个 baseline

- `baseline_student_note_only`：学生原始批注原文，零 AI 介入（**下限**，代表没有 AI 时的起点）
- `baseline_transcript_summary`：直接摘要 transcript，不考虑学生视角（**上限**，代表知识点覆盖的天花板，但丢失了学生视角）

这两个 baseline 也用于验证 judge 本身是否可信：学生原始批注覆盖 4/10 个 fact，直接摘要覆盖 10/10，两个极端值和人工判断完全一致，说明 judge 的方向是对的。

---

## 四、Prompt 迭代过程

### 起点：v0（最简单的 prompt）

```
你是学习助手。用 PPT 文本和讲座 transcript 扩写学生笔记，输出 Markdown，3-6 个 bullet points。
```

**评估结果**：事实覆盖 10/10，vs 理想笔记 equal，无矛盾。
**问题**：覆盖率高，但笔记是 AI 视角重写，学生原话被完全替换成学术腔调。学生看到的不是"自己的笔记被补全"，而是"AI 写了一份新笔记"。

---

### v1：引入结构化 prompt + 视觉分层

核心改动：加入 `[主干信息]` 和 `*[Context]*` 双层结构，区分"学生原话扩写"和"AI 补充细节"。

**评估结果**：事实覆盖 10/10，但 vs transcript 是 **superset**。
**根因分析**：v1 在 transcript 里找到了两个独立维度（参数数量、参数取值），然后自己推导出"两者综合来看，参数数量多不代表复杂度高"——这个结论 transcript 里没有明说，是模型的合理推断，但超出了原文范围。没有幻觉约束的 prompt 会做合理但超出原文的推断。

---

### v3/v3.1：引入 JSON 结构化输出 + 学生原话保护

核心改动：
- 输出改为 JSON，包含 `user_anchor`（学生原话）、`ai_context`（AI 补充）、`timestamp_start/end`
- 明确要求"heading 必须以学生关键词为主干，最小改写"

**评估结果**：事实覆盖降至 7.7-8.3/10。
**根因分析**：学生批注只写了两句话，都是关于"比较方法"的，完全没有提到"如何调整复杂度"和"数据复杂度"。prompt 越忠实学生视角，就越容易漏掉 transcript 后半段的内容。这是一个核心 tradeoff：**学生视角保留率 vs 知识点覆盖率**。

---

### v4.0/v4.1：加入 Chain-of-Thought + 幻觉约束 + Few-Shot

核心改动：
- 加入 6 步 CoT 工作流（意图锚定→时空定位→融合升级→案例提取→跨条目隔离）
- 明确"拒绝幻觉"铁律：所有 bullet 必须来自 transcript 或 PPT
- 加入 few-shot example，包含与真实数据相同的场景

**评估结果**：事实覆盖 7.7-8.3/10，幻觉全部消除，锚点保留 100%。
**仍然存在的问题**：per-fact 明细分析发现，第 9 条（增加复杂度=增加层数/隐藏单元）和第 10 条（数据点数量影响数据复杂度）在所有 v4.x 版本中完全缺失。原因明确：这两个知识点在学生批注里根本没有出现，以学生视角为骨架的 prompt 天然会漏掉它们。

---

### v5.0：加入遗漏扫描机制（supplements）

**关键操作**：在 CoT 第 6 步加入"遗漏扫描"——处理完所有学生锚点后，通读 transcript，找出学生笔记完全未覆盖的重要知识点，收入 `supplements` 数组。

```
6. 遗漏扫描：处理完所有学生锚点后，通读 Transcript 和 PPT_Text，
   找出学生笔记完全未覆盖的重要知识点。判断标准：该知识点在任何
   一个 heading 或其 bullets 中均未出现，且在 Transcript 中有明确讲解。
   将这些遗漏知识点收集到 supplements 数组。
```

**评估结果**：事实覆盖从 7.7 → **10.0/10**，幻觉依然为零，锚点保留 100%。

supplements 精准捡回了两条：
- "实践操作：增加层数/隐藏单元可以提高复杂度"（transcript 18:51）
- "数据复杂度：数据点数量是重要因素"（transcript 19:13）

---

## 五、完整数据对比表

| 版本 | 事实覆盖 | vs Transcript | 矛盾 | vs 理想笔记 | 矛盾 | 锚点保留 | 关键特征 |
|------|---------|--------------|------|------------|------|---------|---------|
| baseline_student_only | 4.0/10 | subset | ✅ | subset | ✅ | 100% | 下限，零 AI 介入 |
| baseline_transcript | 10.0/10 | subset | ✅ | subset | ✅ | 100% | 上限，无学生视角 |
| v0 | 10.0/10 | subset | ✅ | equal | ✅ | 100% | 覆盖全但学生视角丢失 |
| v1 | 10.0/10 | **superset** | ✅ | superset | ✅ | 100% | 有推断超出原文 |
| v3 | 8.3/10 | subset | ✅ | subset | ✅ | 100% | 学生视角强但漏知识点 |
| v3.1 | 7.7/10 | subset | ✅ | superset | ✅ | 100% | 同上，更严格 |
| v4.0 | 8.3/10 | subset | ✅ | subset | ✅ | 100% | CoT+幻觉约束，仍漏2条 |
| v4.1 | 7.7/10 | subset | ✅ | subset | ✅ | 100% | 同上，更严格 |
| **v5.0** | **10.0/10** | superset | ✅ | superset | ✅ | **100%** | **supplements 补全遗漏** |

**核心结论**：
- 所有版本 contradiction 全部 False，幻觉约束有效
- 锚点保留率全程 100%，学生视角始终被保留
- 事实覆盖率：baseline_student(40%) → v4.1(77%) → v5.0(100%)
- v5.0 的 superset 是预期行为（supplements 本身就是额外补充），不是幻觉

---

## 六、关键决策与 tradeoff

**决策 1：为什么选 LLM-as-a-Judge 而不是 BLEU/ROUGE**
字面匹配无法评估语义覆盖。我需要的是"这条知识点有没有被覆盖"，不是"这段文字和参考文本有多像"。

**决策 2：为什么 v3 之后覆盖率反而下降**
这是有意识的 tradeoff。v0 覆盖率高是因为 AI 完全重写，学生视角丢失。v3 开始保护学生视角，代价是漏掉学生没写到的知识点。v5.0 用 supplements 机制同时解决了两个问题。

**决策 3：为什么 supplements 不直接合并进 notes**
supplements 和 notes 的来源不同——notes 来自学生视角，supplements 来自 AI 扫描。合并会破坏"学生感知不到 AI 存在"的产品哲学。前端可以把 supplements 渲染成折叠的"老师还讲了"模块，和主笔记视觉区分。

**决策 4：评估稳定性**
temperature=0 + 每方法跑 3 次取平均/多数投票。结果文件保留每次 run 的原始值，方便排查波动。

---

## 七、局限性与后续计划（面试追问准备）

**局限 1：gold_facts 是假设**
现在的 10 条 gold_facts 是我从 transcript 手动提炼的，代表"老师讲了什么"，不一定等于"学生需要记什么"。计划上线后用行为数据（停留时长、复制率）校验并迭代。

**局限 2：单页测试集**
当前测试数据只有 1 页 PPT、约 2 分钟讲课内容。真实课堂是 20-30 页，不同页面的知识密度和学生批注粒度差异很大。需要扩展多页测试集。

**局限 3：v5.0 的 superset 需要观察**
supplements 机制让笔记变长，可能影响"快速复习"体验。下一步需要加限制：supplements 最多 N 条，或只收 PPT 上有明确标注的知识点。

**局限 4：没有跨产品 baseline**
目前只有自己的版本对比，没有和 Granola 等竞品做横向对比。这是严格产品决策前需要补的。

---

## 八、STAR 口语版迭代叙述

### v0 → v1：模型开始"自由发挥"
S 我当时想的是，学生写了两句批注，AI 要把它扩展成一份完整的复习笔记，同时不能编造老师没讲过的东西。

T 我先写了一个最简单的 prompt，就是"你是学习助手，扩写学生笔记，输出 Markdown"，没有任何约束。跑完评估之后发现覆盖率是满分，但有个问题——模型自己推导出了一个结论："参数量多不代表复杂度高"。这个结论听起来很合理，但老师的 transcript 里根本没有说过这句话，老师只讲了参数数量和参数取值是两个独立的维度，是模型自己把它们综合起来得出了这个推断。

A 所以我在后续版本里加了一条铁律：所有 bullet 的内容必须来自 transcript 或 PPT，不能自行推断，不能做合理但超出原文的延伸。

R 这个问题在 v4.0 之后完全解决了，后面所有版本跑下来 contradiction 全部是 False。

v1 → v3：覆盖率高了，但笔记不像学生自己写的了
S v1 的覆盖率很好，但我发现一个更根本的问题——笔记变成了 AI 的视角，学生原来写的话被完全替换成了学术腔调。学生打开笔记看到的不是"我的笔记被补全了"，而是"AI 帮我重新写了一份笔记"。这和我们产品的核心理念是冲突的，我们想做的是 Granola 那种感觉——你自己写的东西还在，AI 只是帮你把它补完整。

T 所以我需要让 AI 以学生的关键词为骨架来生成笔记，而不是另起炉灶。

A v3 改成了 JSON 结构化输出，把学生原话和 AI 补充分开存，同时明确要求 heading 必须用学生的关键词，最小改写，不能自创标题。

R 锚点保留率到了 100%，学生视角保住了。但覆盖率从 10 分掉到了 8.3 分。我做了 per-fact 的明细分析，发现掉的是第 9、10 条——"增加层数可以提高复杂度"和"数据点数量影响数据复杂度"。原因很直接：学生批注里根本没有提到这两个话题，所以以学生视角为骨架的 prompt 天然就会跳过它们。这是一个我有意识接受的 tradeoff，不是 bug。

v3 → v4.0：prompt 有结构了，但模型还是不知道怎么"思考"
S v3 解决了视角问题，但我发现模型在处理主张句的时候会直接复述，比如学生写了"跨家族比较没有意义"，模型就在 bullet 里再说一遍"跨家族比较没有意义"，换了个措辞而已，没有去找"为什么没有意义"的底层原因。另外多个锚点之间会串台，把其他话题的内容写进当前条目里。

T 我需要告诉模型怎么一步一步思考，而不只是给它一个输出格式。

A 我加了一个 6 步的 CoT 工作流：先锚定学生意图，再去 transcript 里定位对应内容，然后判断这个 heading 是不是主张句——如果是，就必须找支撑论据，不能留空，不能复述。同时加了 few-shot example，而且这个 example 用的场景和我的真实测试数据完全一样，就是树模型 vs 神经网络那个场景，让模型在具体情境下学会正确的做法。

R 幻觉全部消除，锚点保留 100%。但覆盖率还是卡在 8.3 分，第 9、10 条 fact 依然缺失。这时候我已经很清楚根因了——CoT 的前 5 步全部是围绕学生锚点展开的，没有任何机制去扫描学生没写到的内容。

v4.0 → v5.0：加一个"查漏"的步骤
S 问题已经定位得很清楚了：有两条 fact 系统性缺失，而且不管我怎么调 v4.x，它们就是不会出现，因为学生批注里根本没有提到这两个话题。

T 我需要在不破坏学生视角的前提下，把老师讲了但学生没写到的重要知识点也捡回来。

A 我在 CoT 的最后加了第 6 步，叫"遗漏扫描"：处理完所有学生锚点之后，通读一遍 transcript 和 PPT，找出学生笔记完全没有覆盖的重要知识点，单独放进一个 supplements 数组。supplements 和主笔记分开存，前端可以把它渲染成一个折叠的"老师还讲了"模块，视觉上和主笔记区分开，这样学生看主笔记的时候感觉还是自己的笔记，supplements 是额外的补充层。

R 覆盖率直接从 7.7 跳到 10/10，supplements 精准捡回了那两条一直缺失的 fact，幻觉依然是零，锚点保留 100%。这个版本同时解决了"学生视角"和"知识点覆盖"两个之前互相矛盾的目标。

---

## 附录：各版本 Prompt 完整记录

> 每个版本按"策略 → Prompt 核心内容 → 评估结果 → 发现的问题 → 修复方向"展示。

---

### v0 — 最简 prompt，验证基线

**策略**：什么约束都不加，先看模型的自然输出是什么水平。

**Prompt 核心内容**：
```
You are a study assistant. A student wrote a brief note during a lecture.
Using the PPT slide text and the lecture transcript, expand their note
into a clear, concise explanation.

Output ONLY valid JSON:
{ "ai_expansion": "2-3 paragraph expansion. Stay grounded in what the
                    teacher actually said.",
  "timestamp_start": <integer seconds>,
  "timestamp_end": <integer seconds> }

Rules:
- Preserve the student's original intent and phrasing as the opening.
- Keep it concise: 150-250 words total.
- Do NOT invent content not present in the transcript or PPT.
```

**评估结果**：事实覆盖 10/10，vs 理想笔记 equal，无矛盾，锚点保留 100%。

**实际输出**：
```
## 在同一模型家族内通过参数数量与参数取值评估模型复杂度

- 跨模型家族直接比较通常没意义（例如树模型 vs 神经网络），因为结构和表示方式不同，
  不能简单用"更复杂/更简单"判定。
- 在同一模型家族内常用两种可比量：参数数量（有多少可调权重）和参数的取值分布
  （这些权重实际有多少不同信息）。
- 参数数量举例：线性回归 vs 多层感知机（MLP）——MLP 带更多权重参数，通常被认为
  容量更大、可表达更复杂函数。
- 参数取值举例：若许多参数相同或为零，实际描述长度变小，模型更简单；卷积神经网络
  通过权重共享比同样规模的全连接网络实际更简单。
- 这对模型调优有直接意义：想增加复杂度就增加层数或隐藏单元，想降低复杂度则相反；
  同时评估复杂度时也要考虑数据复杂度（例如数据点数量会影响所需模型容量）。
```

**发现的问题**：覆盖率满分，但笔记是 AI 视角的重写。学生原来写的话被完全替换成了学术腔调，学生打开笔记看到的不是"我的笔记被补全了"，而是"AI 帮我重新写了一份"。违背了产品核心哲学。

**修复方向**：需要让 AI 以学生的关键词为骨架，而不是另起炉灶。

---

### v1 — 引入视觉分层，区分主干和补充

**策略**：用 `[主干信息]` 和 `*[Context]*` 双层结构，明确区分"学生原话扩写"和"AI 补充细节"，同时引入 CoT 的雏形（4 步工作流）。

**Prompt 核心内容**：
```
# Role
你是一个顶级的学术笔记重构引擎。以【核心锚点】为主干，融合【完整逐字稿】，
生成结构化复习笔记。

# 处理步骤
1. 主题聚类：归纳为 3-4 个逻辑模块
2. 语义对齐与扩写：将每个速记短句在逐字稿中定位并扩写为完整句子
3. 隐性知识提取：提取口述补充了但未出现在锚点中的高价值细节
4. 视觉分层输出：
   - 主干信息：基于锚点扩写的内容
   - *[Context]*：仅在逐字稿中出现的额外细节（前端渲染为浅灰色）
```

**评估结果**：事实覆盖 10/10，但 vs transcript 是 **superset**，锚点保留 100%。

**实际输出**：
```
### 概念概述
- [主干信息] 不同算法家族之间很难直接比较模型复杂度。
  - *[Context]* 跨家族比较（例如 tree vs neural network）并不容易判断哪个更复杂，
    因为它们的结构和参数形式不同。
- [主干信息] 给定一个算法家族（例如神经网络），可以在内部对不同模型的复杂度进行比较。

### 算法族内复杂度的两个核心维度
- [主干信息] 第一个维度是参数的数量。
  - *[Context]* 例如，多层感知器拥有比线性回归更多的参数，因此被认为是更复杂的模型。
- [主干信息] 第二个维度是每个参数所取的值：参数值的分布或冗余程度也影响复杂度。
  - *[Context]* 如果许多参数取相同的值（例如大量为零），则模型可以用更少的信息描述，
    从而在实际意义上更简单。

### 例子、机制与隐含结论
- [主干信息] 参数取值的冗余（如零或共享权重）会降低模型的"有效复杂度"。
- [主干信息] 卷积神经网络（CNN）通过权重共享降低了需要描述的数值量，因此比全连接
  的多层感知器更简单。
- [主干信息] 参数数量多并不必然意味着高"有效复杂度"，要同时考虑参数值的差异性与冗余。

### 实践指引与数据复杂度
- [主干信息] 增加复杂度通常指增加层数或隐藏单元；降低复杂度则相反。
- [主干信息] 评估数据的复杂度时，数据量（例如样本数）是一个重要因素。
```

**发现的问题**：模型在 transcript 里找到了"参数数量"和"参数取值"两个独立维度，然后自己推导出了"参数量多不代表复杂度高"这个综合结论——transcript 里根本没有说过这句话，是模型的合理推断，但超出了原文范围。没有幻觉约束的 prompt 会做合理但超出原文的延伸。

**修复方向**：加入明确的"拒绝幻觉"铁律，所有内容必须来自 transcript 或 PPT，不能自行推断。

---

### v3.0 — JSON 结构化输出 + 学生原话保护 + 完整 CoT

**策略**：输出改为 JSON，把学生原话（`user_anchor`）和 AI 补充（`ai_context`）分开存储，明确要求 heading 必须以学生关键词为主干。同时引入完整的 CoT 工作流。

**Prompt 核心内容**：
```
# Role & Philosophy
你是一个专为深度学习设计的顶级学术笔记增强引擎。
核心任务：以学生随手记下的【碎片化笔记（索引）】为绝对主导，
在【录音逐字稿】和【PPT讲义】中精准检索，提取高密度学术上下文。

# Processing Workflow (CoT)
1. 意图锚定：逐句拆解学生笔记，识别核心考点
2. 时空定位：在 Transcript 中寻找对应原话，提取时间戳
3. 案例提取：老师解释该概念时用了什么具体例子？
4. 语气提纯：提纯核心主张，但必须保留第一人称视角

# Output
JSON 格式，包含 user_anchor（学生原话）和 ai_context（AI 补充）

# 约束
- 严禁越俎代庖：user_anchor 必须像学霸自己整理的笔记
- 拒绝幻觉：找不到对应内容则 ai_context 留空
```

**评估结果**：事实覆盖降至 8.3/10，vs transcript subset，无矛盾，锚点保留 100%。

**实际输出**：
```json
{
  "enhanced_notes": [
    {
      "user_anchor": "没有意义的比较，因为树模型和神经网络完全不一样，不能直接说谁更复杂。",
      "ai_context": "讲稿指出一般来说，很难在不同模型之间比较复杂度，并直接举例很难判断
                    树模型是否比神经网络更复杂（见 17:07–17:13）。",
      "timestamp_start": "17:07",
      "timestamp_end": "17:13"
    },
    {
      "user_anchor": "有意义的比较是在同一个模型家族内，通过参数数量或参数值来调整和比较模型的复杂度。",
      "ai_context": "讲稿提出在同一算法家族内可以用两种方式比较复杂度：一是比较参数数量
                    （例如线性回归 vs 多层感知机，后者参数更多因而更复杂，见 17:30–17:38）；
                    二是比较参数的取值性质（若许多参数相同或为零，模型实际上更简单，
                    见 17:52–18:09）。并给出卷积神经网络的实际案例：由于权值共享，
                    描述该模型所需的不同数值更少，因此比全连接的多层感知机更简单
                    （见 18:09–18:22）。此外，讲稿还阐明增加复杂度通常意味着增加层数
                    或隐藏单元，减少复杂度则相反（见 18:51）。",
      "timestamp_start": "17:21",
      "timestamp_end": "18:22"
    }
  ]
}
```
> 注意：学生原话完整保留在 `user_anchor`，AI 补充在 `ai_context`。但 transcript 18:51 和 19:13 的内容（调整复杂度的操作方法、数据复杂度）完全缺失——因为学生批注里没有提到这两个话题。

**发现的问题**：学生视角保住了，但覆盖率从 10 分掉到了 8.3 分。per-fact 明细分析发现，第 9、10 条 fact 完全缺失。根因：学生批注里根本没有提到这两个话题，以学生视角为骨架的 prompt 天然会跳过它们。这是核心 tradeoff：**学生视角保留率 vs 知识点覆盖率**。

**修复方向**：CoT 工作流需要更精细，特别是对"主张句"的处理——模型在处理主张句时会直接复述，而不是找支撑论据。

---

### v4.0 — 完整 CoT + 主张判断 + 幻觉铁律 + Few-Shot

**策略**：在 v3 基础上大幅强化 CoT，加入"主张判断"步骤（如果 heading 是主张句，必须找支撑论据），加入"跨条目隔离"防止串台，加入 few-shot example，场景和真实测试数据完全一致。

**Prompt 核心内容**：
```
# Role & Philosophy
感知不到 AI 的存在——学生的关键词和短语必须直接升级成笔记的标题或主干。

# Processing Workflow (CoT) — 5步
1. 意图锚定：逐句拆解，每个锚点独立处理
2. 时空定位：在 Transcript 中定位，提取时间戳
3. 融合升级 + 主张判断：
   - 将用户原词升级为 heading（最小改写）
   - 如果 heading 是主张或结论，必须找"为什么成立"的底层原因填入 bullets
   - 支撑 ≠ 复述：支撑=解释为什么成立；复述=换措辞重说同一件事
4. 案例提取：具体例子直接织入 bullet
5. 跨条目隔离：每条 bullet 只能是当前 heading 的增量，禁止串台

# 约束
- 拒绝幻觉铁律：所有 bullet 必须来自 Transcript 或 PPT
- 主张句禁止留空：必须填入支撑论据

# Few-Shot
包含两个 example，第二个 example 场景和真实测试数据完全一致
（树模型 vs 神经网络），让模型在具体情境下学会正确做法
```

**评估结果**：事实覆盖 8.3/10，幻觉全部消除（contradiction=False），锚点保留 100%。

**实际输出**：
```json
{
  "notes": [
    {
      "heading": "没有意义的比较：树模型 vs 神经网络，不能直接说谁更复杂",
      "bullets": [
        "两类模型的结构和表达方式根本不同，没有统一的度量标准可以横向对比",
        "这类跨算法家族的比较在理论上缺乏依据，实践中也无法得出有意义的结论"
      ],
      "timestamp_start": "17:07",
      "timestamp_end": "17:20"
    },
    {
      "heading": "有意义的比较：同一模型家族内，用参数数量或参数值衡量复杂度",
      "bullets": [
        "**参数数量**：模型中权重参数越多，复杂度越高——例如多层感知机（MLP）的参数量
          远多于单一线性回归模型，因此 MLP 被认为更复杂",
        "**参数取值**：参数数量多不等于复杂度高——若大量参数共享同一个值（如很多权重
          为零），模型实际上更简单",
        "卷积神经网络（CNN）就是典型例子：大量权重参数共享相同的值，描述模型所需的
          独立数字远少于全连接 MLP，因此复杂度反而更低",
        "调整复杂度的实操方向：增加层数或隐藏单元数 → 复杂度上升；反之则下降"
      ],
      "timestamp_start": "17:21",
      "timestamp_end": "18:51"
    }
  ]
}
```
> 注意：学生原话升级为 heading，幻觉消除。但第 9、10 条 fact（调整复杂度操作、数据复杂度）依然缺失，因为 CoT 的 5 步全部围绕学生锚点展开，没有机制扫描学生没写到的内容。

**发现的问题**：幻觉解决了，但第 9、10 条 fact 依然缺失。CoT 的 5 步全部围绕学生锚点展开，没有任何机制去扫描学生没写到的内容。根因已经非常明确，不是 prompt 写法的问题，而是架构上缺少一个"查漏"步骤。

**修复方向**：在 CoT 最后加一步"遗漏扫描"，处理完所有学生锚点后，通读 transcript 找出完全未覆盖的重要知识点。

---

### v5.0 — 加入遗漏扫描（supplements 机制）

**策略**：在 v4.0 的基础上，在 CoT 第 6 步加入"遗漏扫描"，将学生没写到但老师讲了的知识点收入独立的 `supplements` 数组，与主笔记分开存储。

**Prompt 核心内容**（在 v4.0 基础上新增的部分）：
```
# Processing Workflow (CoT) — 新增第 6 步
6. 遗漏扫描：处理完所有学生锚点后，通读 <Transcript> 和 <PPT_Text>，
   找出学生笔记完全未覆盖的重要知识点。
   判断标准：该知识点在任何一个 heading 或其 bullets 中均未出现，
   且在 <Transcript> 中有明确讲解。
   将这些遗漏知识点收集到 supplements 数组，每条格式与 notes 条目相同。
   如果没有遗漏，supplements 为空数组。

# Output Constraints 新增第 8 条
8. supplements 只收真正遗漏的知识点：
   ① 在 notes 的任何 heading 或 bullets 中均未出现
   ② 在 Transcript 或 PPT 中有明确讲解
   不得把 notes 已覆盖的内容重复写入 supplements。
```

**Few-Shot 新增示范**：Example 2 的 supplements 精准捡回了两条：
- "实践操作：增加层数/隐藏单元可以提高复杂度"（transcript 18:51）
- "数据复杂度：数据点数量是重要因素"（transcript 19:13）

**评估结果**：事实覆盖从 7.7 → **10.0/10**，幻觉依然为零，锚点保留 100%。supplements 的 superset 结果是预期行为，不是幻觉。

**实际输出**：
```json
{
  "notes": [
    {
      "heading": "跨家族模型比较复杂度没有意义：树模型和神经网络完全不一样，不能直接说谁更复杂",
      "bullets": [
        "**难以判断的根本原因**：不同算法家族之间，模型结构和参数的含义本就不同，
          没有统一的标准可以衡量"谁更复杂"",
        "**典型例子**：树模型和神经网络，无法直接判断哪个更复杂"
      ],
      "timestamp_start": "17:07",
      "timestamp_end": "17:21"
    },
    {
      "heading": "有意义的比较在同一家族内：通过参数数量或参数值衡量复杂度",
      "bullets": [
        "**参数数量**：同一家族内参数越多，模型越复杂；例：多层感知机的权重参数远多于
          单一线性回归，因此更复杂",
        "**参数取值**：参数数量多不代表复杂度高——若大量参数共享相同值或为零，模型实际
          上更简单",
        "**零值参数**：模型中存在大量零值时，其复杂度低于所有参数取值各不相同的模型",
        "**权重共享（CNN）**：卷积神经网络中大量权重参数共享同一值，描述模型所需的独立
          数值更少，因此比同规模的全连接多层感知机更简单"
      ],
      "timestamp_start": "17:21",
      "timestamp_end": "18:22"
    }
  ],
  "supplements": [
    {
      "heading": "实践操作：如何调整模型复杂度",
      "bullets": [
        "**增加复杂度**：增加网络的层数或隐藏单元数量",
        "**降低复杂度**：减少层数或隐藏单元数量"
      ],
      "timestamp_start": "18:51",
      "timestamp_end": "19:00"
    },
    {
      "heading": "数据复杂度的评估",
      "bullets": [
        "**数据点数量**：样本数量是衡量数据复杂度的重要因素之一"
      ],
      "timestamp_start": "19:13",
      "timestamp_end": "19:20"
    }
  ]
}
```
> supplements 精准捡回了 transcript 18:51 和 19:13 的两条内容，这两条在 v4.x 所有版本中完全缺失。notes 部分保持学生视角，supplements 作为独立补充层，前端可渲染为折叠的"老师还讲了"模块。

**发现的问题**：supplements 机制让笔记变长，可能影响"快速复习"体验。

**修复方向**：下一阶段加限制——supplements 最多 N 条，或只收 PPT 上有明确标注的知识点。当前版本已达到 MVP 目标。

---

### Granola — 竞品 baseline

**产品定位**：Granola 是一个 AI 会议/课堂记录工具，输入为用户自己的笔记 + 录音，输出结构化笔记。

**实际输出**（基于相同的学生批注 + transcript）：
```markdown
## 核心结论
- 跨算法族的复杂度比较没有意义 — 树模型和神经网络结构完全不同，无法直接对比谁更复杂
- 有意义的比较发生在同一算法族内，通过参数数量或参数值来衡量

## 同一算法族内的两个比较维度

### 1. 参数数量（Number of Parameters）
- 参数越多 → 模型越复杂
- 例：MLP 比单一线性回归参数更多 → MLP 更复杂

### 2. 参数取值（Values of Parameters）
- 参数多 ≠ 复杂度高，还需看参数值是否多样
- 大量参数共享相同值（如大量为零）→ 模型实际更简单
- 例：CNN 中权重大量共享 → 描述模型所需信息少 → 比全连接 MLP 更简单

## 如何调整模型复杂度
| 方向 | 操作 |
|------|------|
| 增加复杂度 | 增加层数 / 隐藏单元数 |
| 降低复杂度 | 减少层数 / 隐藏单元数 |

## 延伸：数据复杂度
- 数据点数量是影响数据复杂度的重要因素之一
```

**评估结果**：事实覆盖 10/10，学生原话作为"核心结论"骨架，无矛盾。

**和 v5.0 的关键差异**：

| 维度 | Granola | v5.0 |
|------|---------|------|
| 事实覆盖 | 10/10 | 10/10 |
| 学生原话作为骨架 | ✅（核心结论） | ✅（heading） |
| 遗漏知识点处理 | 平铺进正文 | 单独 supplements 层 |
| 前端渲染可控性 | Markdown 直出 | JSON，前端控制每个字段的渲染方式 |
| 学生感知 | "一份整理好的笔记" | "我的笔记被补全了 + 老师还讲了这些" |

Granola 和 v5.0 在"学生原话作为骨架"这一点上设计哲学一致。核心差异在于 v5.0 把"学生视角扩写"和"AI 查漏补充"分层存储，前端可以给用户不同的感知层次；Granola 把所有内容平铺在一份笔记里，用户无法区分哪些是自己写的延伸、哪些是 AI 主动补充的。

---

## 附录：测试数据原文

> 以下是本次所有评估使用的真实输入数据，所有版本的 prompt 都基于这同一份数据跑评估。

---

### 学生批注原文（Student Note）

```
没有意义的比较，因为树模型和神经网络完全不一样，不能直接说谁更复杂。

有意义的比较是在同一个模型家族内，通过参数数量或参数值来调整和比较模型的复杂度。
```

---

### PPT 原文（PPT Slide Text）

```
It's hard to compare complexity between different algorithms

- e.g. tree vs neural network

Given an algorithm family, two main factors matter:

- The number of parameters
- The values taken by each parameter
```

---

### 讲座逐字稿原文（Lecture Transcript）

```
17:03 The next thing is how to estimate the complexity of the model.

17:07 In general, it is difficult to compare complexity between different models.

17:13 For example, it's hard to tell whether a tree model is more complex or not
      compared to a neural network.

17:21 So on the other hand, given an algorithm family like neural network, it is
      possible to compare the model complexity in two ways.

17:30 The first way is you can compare the number of parameters. So how many weight
      parameters do you have in this model?

17:38 For example, if you compare a single linear regression model with a multilayer
      perceptron, your multilayer perceptron definitely has more parameters. So we say
      that multilayer perceptron is a more complex model.

17:52 The other consideration is the values taken by each parameter. So maybe my model
      could have a lot of parameters. However, maybe many of the parameters share the
      same value.

18:09 For example, in some models, there are a lot of zeros. If you have a lot of zeros,
      then your model is actually simpler than a model that has all different numbers.

18:22 Next class, we'll talk about convolutional neural networks. In that model, there
      are a lot of weight parameters that share the same value. Because they share the
      same value, you don't need too many numbers to describe the model. So those types
      of models are actually simpler compared to a fully connected multilayer perceptron.

18:51 This is about how we compare model complexity. This should give you a sense of
      whether you should increase or decrease complexity. Increase complexity means
      increase the number of layers or hidden units. Decrease complexity is the reverse.

19:13 And if you want to make an evaluation of data complexity, there are many factors.
      For example, the number of data points definitely matters for the complexity.
```

**注意**：学生批注是中文，PPT 和 transcript 是英文。这是真实课堂场景——学生用母语记笔记，老师用英文授课。prompt 需要跨语言处理，这也是为什么不能用字面匹配指标的原因之一。