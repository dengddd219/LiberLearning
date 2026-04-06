# Reddit 社交平台需求分析任务指南 (Skill Action Reference) 
token记录：131次开始- 次结束
模型使用minimax

## 0. 核心约束与安全守则 (CRITICAL WARNINGS)
**警告：严禁发生 Token 爆炸！请严格遵守以下数据处理纪律：**
1. **禁止全量读取**：绝对不要尝试将 `@discovery/reddit_data.xlsx` 的全量内容直接读取到对话上下文中！
2. **使用代码处理数据**：必须编写并执行 Python 脚本（如 `pandas`）来读取 Excel 文件，进行数据过滤、切片，并将其转换为轻量级的子集文件（如 JSON/CSV）。
3. **精准投喂机制 (MapReduce)**：每个专家进行分析时，**只能**读取与其特定分析维度相关的数据子集，禁止加载不相关的数据。
4. **防崩溃存档**：所有的工作必须分步进行。每完成一个子任务，必须在指定工作目录生成 `.md` 进度说明文件。

---

## 1. 任务基本信息
- **总体目标**：基于 `@LiberStudy-PRD.md`，对 Reddit 数据进行需求分析。
- **目标受众**：产品经理 (PM)，用于需求研发与产品迭代。
- **输出格式**：高质量的 HTML 报告。
- **分析核心点（仅限2条）**：
  1. 需求点 (Needs / Expectations)
  2. 痛点 (Fears / Pain Points)

---

## 2. 输入资源清单
- **PRD 文件**: `@LiberStudy-PRD.md`
- **原始数据**: `@discovery/reddit_data.xlsx`
  - *字段参考*：话题索引, 话题分类, 搜索关键词, Subreddit, 帖子标题, 帖子正文, 帖子得分(Score), 点赞率(Upvote Ratio), 评论总数, 发帖时间, Top评论1-7。
  - *指标说明*：
    - `Score`：净支持度（点赞-点踩），越高代表社区越认可。
    - `Upvote Ratio`：点赞率（0~1），接近1代表压倒性好评，低于0.5代表争议极大或不受欢迎。可结合此指标进行情绪/痛点筛选。
- **专家人设目录**: `C:\Users\19841\Desktop\github\LiberLearning\LiberLearning\discovery\reddit discovery\expert_data\`
- **专家约束文件**: `expert_roles.md` (位于上述目录)
  - *注：直接读取使用这些现成的专家设定，**不需要也不允许**重新生成专家人设。*

---

## 3. 标准执行工作流 (SOP)

### Phase 1: 环境初始化与数据预处理 (ETL)
1. 在 `/discovery` 目录下创建一个新的专属文件夹，命名为 `/discovery/reddit_analysis_run_[当前时间戳]`。
2. 创建进度日志文件：`/discovery/reddit_analysis_run_[当前时间戳]/00_progress_log.md`，记录初始化完成。
3. **编写 Python 脚本**读取 `reddit_data.xlsx`。
4. **数据清洗与路由**：根据专家设定的需要，利用 Python 提取相关字段（如重点提取 Score 高且 Upvote Ratio 极高或极低的帖子进行对比），将全量 Excel 切分为若干个轻量级的数据子集（例如：`needs_subset.json`, `painpoints_subset.json`），存入新文件夹。
5. 更新 `00_progress_log.md`：记录 ETL 阶段完成及切分的数据集概要。

### Phase 2: PRD 与专家设定对齐
1. 读取并理解 `@LiberStudy-PRD.md` 的核心产品目标。
2. 读取 `expert_roles.md` 及相关专家设定文件，理解各位专家的视角。
3. 更新 `00_progress_log.md`：记录上下文理解完毕，准备进入分析阶段。

### Phase 3: 分布式专家分析 (严格控制 Context)
*注意：本阶段禁止并行一次性处理所有专家。请逐一串行执行，或确保每个 Subagent 的输入极简。*
1. **执行专家分析**：针对每一个专家，**仅加载**其对应的轻量级数据子集和对应的角色设定。
2. **分析输出**：让专家提炼出核心的“需求点”和“痛点”。
3. **存档**：将每个专家的分析结果单独保存为 Markdown 文件（如 `expert_1_analysis.md`, `expert_2_analysis.md`）。
4. 更新 `00_progress_log.md`：记录每个专家的进度。如果发生崩溃，下次从日志中未完成的专家继续。

### Phase 4: 报告综合与 HTML 生成
1. 读取 Phase 3 中生成的所有 `expert_X_analysis.md` 文件。
2. 结合 PM 的业务视角，将零散的“需求点”和“痛点”进行去重、归类、提炼。
3. 生成最终的 HTML 报告 (`reddit_needs_analysis_report.html`)。
   - 报告需具备良好的可读性、清晰的层级结构（适合产品经理快速获取 Insight）。
   - 必须重点突出：用户真实痛点（带典型言论/数据佐证）与核心产品需求点。
4. 更新 `00_progress_log.md`：记录 HTML 报告生成完毕，任务圆满结束。