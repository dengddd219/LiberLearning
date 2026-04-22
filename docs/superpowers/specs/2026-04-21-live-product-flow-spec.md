# Live 产品流程 Spec

**日期：** 2026-04-21  
**状态：** 草案，待确认后回写主技术 spec

---

## 1. 目标

这份文档只定义 **直播期间到课后生成笔记** 的产品流程，不讨论具体技术实现。

目标是明确：

- 用户进入直播页后的选择路径
- 有 PPT 与无 PPT 两种模式的差异
- 课中 `My Notes / AI Notes / Transcript` 的职责
- 课程结束后的状态切换
- `Generate Notes` 之后的生成与阅读模式
- Granola 类产品与 LiberStudy 的关键差异

---

## 2. 核心原则

- `Transcript` 是系统必须记录的底层能力，无论用户是否上传 PPT、是否写笔记，都必须存在。
- `PPT` 是可选输入，不上传 PPT 不能阻断直播流程。
- `My Notes` 是可选输入，用户可以写，也可以完全不写。
- 课中以“低打扰记录”为主，课后以“快速浏览 + 精准定位”为主。
- 有 PPT 时，课中按页组织；课后改为整课浏览模式，并保留 PPT 索引能力。
- 无 PPT 时，课中和课后都采用长文笔记模式，不做人为分页。

---

## 3. 信息架构

### 3.1 右侧栏固定三栏

直播页和课后整理页的右侧栏统一保留三个入口：

- `My Notes`
- `AI Notes`
- `Transcript`

说明：

- 课中默认进入 `My Notes`
- `Transcript` 不默认抢占主视图，但始终可通过 tab 查看
- `AI Notes` 在点击 `Generate Notes` 之前可以为空态

### 3.2 两种课中编辑模式

#### 有 PPT

- 中间区域显示 PPT
- 左侧是 PPT 导航/缩略图
- 右侧 `My Notes` 与当前 PPT 页一一对应
- 用户切换 PPT 页时，右侧 `My Notes` 自动切换到该页对应笔记

这意味着：

- 课中 `My Notes` 是 **页级编辑模式**
- 用户在第 3 页写的笔记，不会在第 4 页继续显示

#### 无 PPT

- 左侧给出明确提示：`如无需 PPT，则进入全屏笔记`
- 用户进入全屏笔记模式
- `My Notes` 变成自由长文输入区

这意味着：

- 无 PPT 时不再按页管理笔记
- 用户的输入体验应接近 Word/飞书文档这类连续长文编辑

---

## 4. 用户流程

### 4.1 进入直播页

用户进入 Live 页面后：

1. 可以上传 PPT，也可以不上传。
2. 如果不上传 PPT，左侧出现提示：`如无需 PPT，则进入全屏笔记`。
3. 右侧默认进入 `My Notes`。
4. 系统进入待录音状态。

### 4.2 开始上课

用户点击开始录音后：

1. 系统开始持续记录 transcript。
2. 用户可以在 `My Notes` 中写自己的笔记，也可以不写。
3. `Transcript` 持续积累，但不强制打断当前 `My Notes` 视图。
4. 如果有 PPT，用户翻页时 `My Notes` 跟着切页。
5. 如果无 PPT，用户始终处于全屏长文笔记模式。

### 4.3 上课过程中

#### 有 PPT 时

课中体验是：

- 用户边看 PPT 边记笔记
- `My Notes` 与单页 PPT 绑定
- `Transcript` 在后台持续累积
- `AI Notes` 暂不作为主交互目标

#### 无 PPT 时

课中体验是：

- 用户像写连续文档一样记笔记
- `Transcript` 在后台持续累积
- 不出现页级切换逻辑

---

## 5. 结束课程后的产品逻辑

### 5.1 结束控制

页面必须有一个非常明确的课程结束入口。

这里建议产品文案优先体现“结束课程”，而不是只写“暂停”，因为结束后会立刻进入课后整理逻辑。

### 5.2 结束课程后的立即变化

用户点击结束课程后，页面立即进入“课后整理起点态”。

此时应发生以下变化：

1. 录音结束，transcript 停止继续增长。
2. 右侧栏仍保留：
   - `My Notes`
   - `AI Notes`
   - `Transcript`
3. `Transcript` tab 中直接展示 **完整 transcript**。
4. 这份 transcript 需要附带 **PPT 页面 match**。
5. `My Notes` 立即从课中的页级编辑模式，切换成 **长文笔记模式**。
6. 右侧下方出现 `Generate Notes` 按钮。
7. `Generate Notes` 由用户手动点击，不自动启动。

### 5.3 课后 My Notes 的展示模式

这是本产品与普通页级笔记器的重要区别。

#### 有 PPT 时

课中：

- `My Notes` 按页编辑

课后：

- `My Notes` 不再限制为“当前页只能看当前页的内容”
- 要切换成 **整课浏览模式**
- 展示用户整节课输入过的全部文字
- 每段内容带对应的 PPT 索引
- 用户可以快速通览整节课笔记
- 需要时再根据索引定位到对应 PPT 页面

也就是说：

- 课中：按页写
- 课后：整课看

#### 无 PPT 时

课中就是长文笔记模式，课后继续保持长文浏览模式即可，不需要再做页级切换。

---

## 6. Generate Notes 之后的逻辑

### 6.1 触发方式

- 由用户主动点击 `Generate Notes`
- 不自动生成

### 6.2 点击后的页面变化

点击后：

1. 右侧切到 `AI Notes`
2. `AI Notes` 从上往下逐步生成
3. 用户能看到明显的生成过程，而不是纯等待

### 6.3 AI Notes 的课后展示模式

#### 有 PPT 时

`AI Notes` 不再卡死在单页视角，而是进入 **整课浏览模式**：

- 展示整节课的 AI notes
- 每段 AI note 带 PPT 索引
- 用户先按全文快速浏览
- 需要时再根据索引定位到对应页

这和 `My Notes` 的课后逻辑一致。

#### 无 PPT 时

- 直接生成整课 AI notes
- 不带页级组织
- 可以按主题、段落或章节组织

---

## 7. Transcript 的课后逻辑

课后 `Transcript` 的职责不是“藏起来做底层数据”，而是作为右侧栏中的一个明确 tab，供用户随时查看。

要求：

- 展示完整 transcript
- transcript 自身附带 PPT 页面 match
- 用户可以通过 transcript 反查某段内容属于哪页 PPT

因此课后右侧三栏的角色分工是：

- `My Notes`
  - 用户自己的整课长文笔记
- `AI Notes`
  - 系统生成的整课浏览版笔记
- `Transcript`
  - 完整逐字稿，附带 PPT 匹配信息

---

## 8. Detailed Notes 交互

### 8.1 触发方式

用户先看到的是简洁版 `AI Notes`。

如果用户对某一条内容有疑问：

1. 鼠标移到该条 AI note 上
2. 该条内容底色发生变化
3. 右侧出现放大镜操作入口
4. 用户点击放大镜

### 8.2 展示方式

详细解释采用 **悬浮侧栏** 展示，不整页跳走。

### 8.3 Detailed Notes 的定义

Detailed Notes 不是重新生成一整份新的笔记，而是：

- 针对某一条 AI note
- 结合 transcript 做更详细解释
- 帮助用户理解“这句话为什么这么总结”

所以 Detailed Notes 更像：

- line-level explain
- transcript-grounded expansion

而不是：

- 再来一份完整的大纲笔记

---

## 9. 有 PPT 与无 PPT 的完整对比

### 9.1 有 PPT

课中：

- 看 PPT
- 按页写 `My Notes`
- 系统持续记录 transcript

课后：

- `Transcript` 展示完整逐字稿，并带 PPT match
- `My Notes` 变成长文笔记模式
- `AI Notes` 点击后生成，并以整课浏览模式呈现
- `My Notes / AI Notes / Transcript` 都支持通过 PPT 索引定位

### 9.2 无 PPT

课中：

- 进入全屏长文笔记模式
- 系统持续记录 transcript

课后：

- `Transcript` 展示完整逐字稿
- `My Notes` 继续以长文方式展示
- `AI Notes` 点击后生成整课笔记
- 不做页级索引，只做主题式浏览

---

## 10. 与 Granola 的核心差异

Granola 的主链路更接近：

- transcript
- AI notes
- detailed explanation

LiberStudy 在此基础上多一层：

- transcript
- AI notes
- detailed explanation
- PPT 页面匹配与索引

并且这个差异不是小功能，而是产品结构差异：

- Granola 更偏“会议记录流”
- LiberStudy 更偏“课堂内容流 + 课件结构索引”

因此 LiberStudy 的关键体验不是“只生成笔记”，而是：

- 课中按页记录
- 课后整课浏览
- 需要时通过 PPT 索引快速定位

---

## 11. 本文档的最终结论

直播产品的核心逻辑可以压缩为一句话：

- 课中，有 PPT 就按页记；无 PPT 就全屏长文记
- 课后，无论 `My Notes` 还是 `AI Notes`，都改成整课浏览模式
- `Transcript` 作为独立 tab 直接展示完整内容
- 有 PPT 时，`Transcript / My Notes / AI Notes` 都要带 PPT 索引能力
- `Generate Notes` 必须由用户主动触发
- `Detailed Notes` 通过悬浮侧栏展开，而不是跳转整页

如果这份产品流程确认无误，再将其中稳定结论回写到主技术 spec：

- [2026-04-21-live-granola-replica-design.md](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/docs/superpowers/specs/2026-04-21-live-granola-replica-design.md)
