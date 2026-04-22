# LiberStudy 实时课堂版 Granola 复刻技术方案 v1

**日期：** 2026-04-21  
**状态：** 草案，待确认后进入实现

---

## 1. 目标

本方案的目标不是复刻 Granola 的产品外观，而是复刻它背后的核心工程机制：

- 课中完成实时转录，避免下课后重新从音频起跑
- 课中持续构建页级 transcript buffer 和页级 note state
- 下课后基于 `ppt_text + transcript` 做一次正式页级对齐，再生成最终 notes，而不是整条流水线从音频重算
- 每条 AI note 都能追溯到原始 transcript 片段
- 与 LiberStudy 当前的 PPT 分页对齐能力、批注锚点能力天然融合

本方案默认适配 **场景 ②：课中实时录音**。  
场景 ① 课后上传继续走现有 [process.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/process.py) 批处理链路，不强行合并。

---

## 2. 现状判断

当前仓库已经具备 Granola 方案的三个基础件，但尚未串成产品级闭环：

- 实时 ASR WebSocket 已存在于 [live.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/live.py)
- 离线页级对齐已存在于 [alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/alignment.py)
- 离线页级 note 生成已存在于 [note_generator.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/note_generator.py)

当前关键缺口：

- 实时 transcript 只在前端 [LivePage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/LivePage.tsx) 内存中按 `currentPage` 粗暴归档，不是服务端权威数据
- `ws/live-asr` 只负责推字，不负责持久化 `final transcript segment`
- 现有 note 生成器是“离线全页生成器”，不是“增量编译器”
- 课程结束后没有一条“复用实时 transcript 的 finalize 流程”

结论：  
要复刻 Granola，必须新增一条 **live-native 数据面**，而不是把现有批处理流水线硬改成实时。

---

## 3. 总体架构

### 3.1 总体原则

- 前端不再维护 transcript 真相，只负责采集、展示、上报用户动作
- 服务端保存每条 final transcript segment，作为唯一 source of truth
- 在线阶段只做轻量处理：实时转录、缓冲、增量抽取、辅助信号记录
- 结束课程后做一次正式离线页级对齐，再进入最终 note 生成；不重跑整段 ASR

### 3.2 数据流

```text
用户上传 PPT / 进入 live
-> 服务端创建 live session
-> 前端采集麦克风音频
-> WebSocket 实时 ASR
-> 服务端落库 final transcript segments
-> 在线阶段只维护 transcript buffer / annotation / page hint
-> 小模型增量抽取 facts
-> 页级 note state 渲染
-> 前端按页拉取/订阅最新状态
-> 结束课程
-> 基于 ppt_text + transcript 做正式页级对齐
-> 生成最终 notes 页面数据
```

### 3.3 建议模块拆分

- 新增 [backend/services/live_store.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_store.py)
  - live session、segment、page state 的存取
- 新增 [backend/services/live_alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_alignment.py)
  - 在线归页，不污染现有离线版 [alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/alignment.py)
- 新增 [backend/services/live_note_builder.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_note_builder.py)
  - 增量 facts 抽取、合并、渲染
- 扩展 [backend/routers/live.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/live.py)
  - 增加 session start、page snapshot、state pull、finalize 接口
- 保留 [backend/routers/process.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/process.py)
  - 继续作为上传音频的批处理入口
  - 可复用其 prompt、输出结构、单页 retry 逻辑

---

## 4. 核心数据模型

### 4.1 LiveSession

```ts
type LiveSession = {
  session_id: string
  ppt_id: string | null
  language: "zh" | "en"
  status: "live" | "stopped" | "finalizing" | "done" | "error"
  current_page: number
  started_at: number
  ended_at: number | null
}
```

用途：

- 表示一节正在进行的课堂
- 承载 live 生命周期状态
- 作为 transcript、annotation、page state 的父实体

### 4.2 LiveSegment

```ts
type LiveSegment = {
  id: string
  session_id: string
  seq: number
  start_ms: number
  end_ms: number
  text: string
  is_final: boolean
  source: "mic"
  current_page_hint: number | null
  assigned_page: number | null
  assign_confidence: number
  revision: number
  created_at: number
}
```

设计要点：

- `is_final=false` 的 interim 结果不持久化，最多只做内存态预览
- 只有 `is_final=true` 的 sentence 才落库
- `current_page_hint` 是前端当时所见页码，不是最终归属
- `assigned_page` 是服务端对齐器给出的真实页归属
- `revision` 预留给后续 ASR 二次修正

### 4.3 AnnotationEvent

```ts
type AnnotationEvent = {
  id: string
  session_id: string
  page_num: number
  text: string
  x: number
  y: number
  created_at: number
}
```

用途：

- 作为“用户显式关注点”信号
- 在在线对齐与 note 渲染中提供强锚点

### 4.4 PageState

```ts
type PageState = {
  session_id: string
  page_num: number
  transcript_segment_ids: string[]
  transcript_text: string
  live_facts_json: string
  rendered_note_md: string
  citations_json: string
  last_compiled_at: number | null
}
```

其中：

- `live_facts_json` 保存结构化中间态，而不是 prose
- `citations_json` 保存 note 到 segment ids 的映射
- `rendered_note_md` 才是给前端直接显示的结果

### 4.5 建议事实结构

```json
{
  "summary": "",
  "concepts": [],
  "definitions": [],
  "examples": [],
  "steps": [],
  "formulas": [],
  "teacher_emphasis": [],
  "open_questions": [],
  "off_slide_points": []
}
```

这样设计的原因：

- 增量更新容易做 merge
- 比直接让模型反复重写整段 markdown 更稳
- 能天然支持“简略 / 详细”两种渲染粒度

---

## 5. 接口设计

### 5.1 `POST /api/live/session/start`

用途：

- 创建 live session
- 绑定 `ppt_id`
- 返回初始页数据

请求：

```json
{
  "ppt_id": "xxx",
  "language": "zh"
}
```

响应：

```json
{
  "session_id": "live_xxx",
  "status": "live",
  "pages": [
    {
      "page_num": 1,
      "ppt_text": "...",
      "pdf_url": "...",
      "pdf_page_num": 1
    }
  ]
}
```

### 5.2 `WS /api/ws/live-asr?session_id=...`

用途：

- 前端发音频 chunk
- 服务端返回 interim/final transcript
- 服务端在 `SentenceEnd` 时写入 `LiveSegment`

服务端回推消息建议改为：

```json
{
  "type": "transcript",
  "text": "老师刚才说的内容",
  "is_final": true,
  "start_ms": 12000,
  "end_ms": 15400,
  "segment_id": "seg_001",
  "assigned_page": 3,
  "assign_confidence": 0.88
}
```

原因：

- 前端不应自己猜页归属
- 后续 transcript tab、QA、citations 都依赖 `segment_id`

### 5.3 `POST /api/live/page-snapshot`

用途：

- 用户翻页时上报当前页
- 用户停留页作为在线对齐软先验

请求：

```json
{
  "session_id": "live_xxx",
  "current_page": 4,
  "timestamp_ms": 523000
}
```

说明：

- 不需要高频心跳
- 仅在切页时、首次进入时、课程恢复时上报即可

### 5.4 `POST /api/live/annotations`

用途：

- 保存 inline annotation
- 触发当前页 note 增量刷新

请求：

```json
{
  "session_id": "live_xxx",
  "page_num": 4,
  "text": "这里老师补充了例外情况",
  "x": 0.53,
  "y": 0.27
}
```

### 5.5 `GET /api/live/state/{session_id}?page_num=...`

用途：

- 返回当前页或全局 live state
- 前端进入页面、切页、恢复 session 时拉取

响应建议至少包含：

```json
{
  "session_id": "live_xxx",
  "status": "live",
  "current_page": 4,
  "page_state": {
    "page_num": 4,
    "transcript": ["...", "..."],
    "rendered_note_md": "...",
    "citations": [
      { "note_key": "example_1", "segment_ids": ["seg_013", "seg_014"] }
    ]
  }
}
```

### 5.6 `POST /api/live/finalize`

用途：

- 在“结束课程”之后，由用户点击 `Generate Notes` 触发
- 基于 `ppt_text + transcript + current_page_hint/annotation` 做正式页级对齐
- 基于对齐结果生成最终 notes
- 写入正式 session 结果，供 [sessions.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/sessions.py) 和 notes 页面消费

说明：

- “结束课程” 与 “Generate Notes” 是两个动作
- 结束课程后，页面先进入课后整理起点态：
  - `My Notes` 立即切成长文浏览模式
  - `Transcript` tab 直接展示完整 transcript
  - 页面出现 `Generate Notes` 按钮
- 用户点击 `Generate Notes` 后，才调用 `POST /api/live/finalize`

请求：

```json
{
  "session_id": "live_xxx"
}
```

响应：

```json
{
  "session_id": "live_xxx",
  "status": "finalizing"
}
```

---

## 6. 在线对齐设计

### 6.1 为什么不能直接复用离线版

当前 [alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/alignment.py) 是批处理式：

- 一次性拿到全量 segments
- 一次性做 embedding
- 一次性跑 K=3 debounce

在线场景的问题是：

- 实时阶段拿不到全量上下文
- 每来一句话全量重算成本太高
- 用户翻页会给出强先验，不能忽略

因此需要单独的 `live_alignment.py`。

### 6.2 在线归页打分

对每条 final segment，对所有候选页打分：

```text
score(page) =
  0.45 * semantic_similarity(segment, page)
+ 0.25 * current_page_hint_score
+ 0.15 * temporal_continuity_score
+ 0.10 * annotation_anchor_score
+ 0.05 * lexical_overlap_score
```

信号解释：

- `semantic_similarity`
  - segment 文本与 PPT 页文本 embedding 相似度
- `current_page_hint_score`
  - 用户当前正在看的页给高分
- `temporal_continuity_score`
  - 与上一条已归页 segment 保持平滑
- `annotation_anchor_score`
  - 当前页近期有 annotation 时加权
- `lexical_overlap_score`
  - 与 slide 关键词重合时补分

### 6.3 切页状态机

建议保留 Granola 风格的“稳态优先”，不要一句话就切页。

状态：

- `stable(page_n)`
- `candidate(page_m, votes=1..k)`
- `off_slide`

规则：

- 新候选页需要连续命中 2 到 3 条 final segment 才能切换
- 若所有页分数都低于阈值，则进入 `off_slide`
- `off_slide` 内容挂到最近稳定页的 `page_supplement`
- 用户手动写 annotation 时，该页未来 N 秒内获得额外 prior

### 6.4 Embedding 优化

实时场景不要重复算：

- PPT 页 embedding 在 `upload-ppt` 阶段一次性算好并缓存
- final segment embedding 只算一次
- 允许将最近 2 到 3 条 segment 拼成短窗再算一次“局部上下文 embedding”

---

## 7. AI Note 快速生成机制

### 7.1 核心思想

快，不靠每次都让大模型重写整页 markdown。  
快，靠四层状态：

- 原始 transcript 层
- 页级 transcript buffer 层
- facts 抽取层
- 渲染层

### 7.2 增量编译策略

触发条件建议为任一满足即编译：

- 当前页新增 2 到 4 条 final segments
- 当前页累计新增文本超过 80 到 120 个中文字符
- 用户新增 annotation
- 用户主动点击“刷新 AI Note”

编译分两步：

1. `extract_page_delta`
   - 输入：旧 `live_facts` + 新增 transcript 片段 + annotation
   - 输出：新增 facts JSON

2. `render_page_note`
   - 输入：合并后的完整 `live_facts`
   - 输出：简略版或详细版 markdown

### 7.3 模型职责拆分

建议至少拆成两类调用：

- 小模型 / 快模型
  - 做 `extract_page_delta`
  - 目标是低延迟、结构化、便宜
- 主模型
  - 做 `render_page_note`
  - 或仅在 finalize 阶段做全页 polish

这样可以把日常高频刷新成本压下去。

### 7.4 Citation 机制

每个 facts 项都要记录来源：

```json
{
  "note_key": "definition_2",
  "segment_ids": ["seg_021", "seg_022"]
}
```

这样前端可以做：

- 点击 bullet 查看来源 transcript
- “老师刚才讲了什么”时直接定位相关片段
- 后续 QA 只检索当前页高相关 source

### 7.5 Finalize 阶段做什么

结束课程后不要再做：

- 音频重新 ASR
- 从音频重新跑整条 [process.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/process.py) 全流水线

结束课程后要做：

- 读取全量 live transcript segments
- 读取 PPT 页文本 `ppt_text`
- 将课中记录的 `current_page_hint` 和 annotation 作为辅助信号，而不是最终页归属
- 复用 [alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/alignment.py) 或其轻改版本，做一次正式离线页级对齐
- 将对齐结果喂给 [note_generator.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/note_generator.py)
- 生成 [NotesPage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/NotesPage.tsx) 需要的稳定结构

结论：

- `current_page_hint` 只是在 live 阶段帮助理解上下文的软信号
- 最终 `assigned_page` 必须在结束课程后由 `ppt_text + transcript` 正式计算

---

## 8. 数据存储建议

### 8.1 MVP 先用 SQLite

理由：

- 你当前仓库已经有 SQLite session 存储
- 单用户开发调试阶段足够
- 方便快速打通端到端

建议新增 4 张表：

- `live_sessions`
- `live_segments`
- `live_annotations`
- `live_page_states`

### 8.2 表结构建议

`live_sessions`

```sql
session_id TEXT PRIMARY KEY,
ppt_id TEXT,
language TEXT NOT NULL,
status TEXT NOT NULL,
current_page INTEGER NOT NULL DEFAULT 1,
started_at INTEGER NOT NULL,
ended_at INTEGER
```

`live_segments`

```sql
id TEXT PRIMARY KEY,
session_id TEXT NOT NULL,
seq INTEGER NOT NULL,
start_ms INTEGER NOT NULL,
end_ms INTEGER NOT NULL,
text TEXT NOT NULL,
source TEXT NOT NULL,
current_page_hint INTEGER,
assigned_page INTEGER,
assign_confidence REAL NOT NULL DEFAULT 0,
revision INTEGER NOT NULL DEFAULT 1,
created_at INTEGER NOT NULL
```

索引：

- `idx_live_segments_session_seq(session_id, seq)`
- `idx_live_segments_session_page(session_id, assigned_page, seq)`

`live_annotations`

```sql
id TEXT PRIMARY KEY,
session_id TEXT NOT NULL,
page_num INTEGER NOT NULL,
text TEXT NOT NULL,
x REAL NOT NULL,
y REAL NOT NULL,
created_at INTEGER NOT NULL
```

`live_page_states`

```sql
session_id TEXT NOT NULL,
page_num INTEGER NOT NULL,
transcript_text TEXT NOT NULL DEFAULT '',
live_facts_json TEXT NOT NULL DEFAULT '{}',
rendered_note_md TEXT NOT NULL DEFAULT '',
citations_json TEXT NOT NULL DEFAULT '[]',
last_compiled_at INTEGER,
PRIMARY KEY (session_id, page_num)
```

### 8.3 后续迁移到 Postgres 的边界

当出现以下需求时再迁移：

- 多并发 live sessions
- 需要服务端事件订阅 / 后台 worker
- 单节课 transcript 规模明显增大

在此之前，不建议为未来做过度设计。

---

## 9. 前端改造原则

主要改造文件是 [LivePage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/LivePage.tsx)。

前端角色重新定义：

- 负责采音频并发到 WebSocket
- 负责上报翻页和 annotation 事件
- 负责展示服务端返回的 transcript 与 page state
- 不再自己维护 `transcriptByPage` 作为真相

### 9.1 已确认的产品流程约束

这部分是已经确认的产品逻辑，技术实现必须服从这些约束：

- 用户进入 live 后，可以上传 PPT，也可以不上传 PPT
- 如果用户不上传 PPT，左侧需要给出明确提示：`如无需 PPT，则进入全屏笔记`
- 右侧固定保留三个入口：`My Notes / AI Notes / Transcript`
- 课中默认进入 `My Notes`
- 系统必须始终记录 transcript；这是基础能力，不依赖 PPT 或用户是否记笔记
- `Generate Notes` 必须由用户主动点击，不自动触发
- Detailed Notes 采用悬浮侧栏展开，不整页跳走

### 9.2 课中与课后的展示切换

#### 有 PPT 时

课中：

- `My Notes` 按 PPT 页级组织
- 用户切换 PPT 页时，右侧 `My Notes` 自动切换到对应页笔记
- `Transcript` 持续累积，但不抢占主视图

课后：

- `Transcript` tab 直接展示完整 transcript，并附带 PPT 页面 match
- `My Notes` 从页级编辑模式切换成整课长文浏览模式
- `AI Notes` 在点击 `Generate Notes` 后生成，并以整课浏览模式呈现
- 课后 `My Notes / AI Notes / Transcript` 都不再被“当前页”锁死，而是以“整课浏览 + PPT 索引定位”为主

#### 无 PPT 时

课中：

- 进入全屏笔记模式
- `My Notes` 采用连续长文编辑体验，不按页切换

课后：

- `My Notes` 继续以长文方式展示
- `Transcript` 直接展示完整 transcript
- `AI Notes` 点击后生成整课笔记，不做页级索引

### 9.3 建议改动

- 保留 `subtitleLines`
  - 它只是 UI 预览态
- 废弃本地 `transcriptByPage` 权威地位
  - 仅作为过渡态显示
- 新增 `liveState`
  - 从 `GET /api/live/state/{session_id}` 拉取
- 切页时调用 `POST /api/live/page-snapshot`
- 课程结束时调用 `POST /api/live/finalize`
- 完成后跳转到 notes 路由

### 9.4 右侧面板建议

- `My Notes`
  - 课中仍然本地秒级保存
  - 有 PPT 时按页保存；无 PPT 时按整篇长文保存
  - 课程结束后切换为整课长文浏览模式
- `AI Notes`
  - 课中可以为空态
  - 点击 `Generate Notes` 后开始从上往下生成
  - 课后展示整课 AI notes，并带 PPT 索引能力
- `Transcript`
  - 课中可以作为辅助查看 tab
  - 课程结束后直接展示完整 transcript
  - 有 PPT 时，transcript 需要附带 PPT 页面 match

### 9.5 Detailed Notes 交互

- 用户首先阅读简洁版 `AI Notes`
- hover 某条 AI note 时，该条内容出现底色变化
- 同时提供放大镜入口
- 点击放大镜后，以悬浮侧栏方式展示该条 AI note 的详细解释
- 详细解释基于 transcript，对单条 AI note 做展开，而不是重新生成一整份新笔记

---

## 10. 状态机

### 10.1 Session 状态机

```text
idle
-> live
-> stopped
-> finalizing
-> done
-> error
```

状态含义：

- `idle`
  - 仅前端态，未真正开课
- `live`
  - 正在录音、ASR、增量编译
- `stopped`
  - 已结束课程，`My Notes / Transcript` 可浏览，等待用户点击 `Generate Notes`
- `finalizing`
  - 用户已点击 `Generate Notes`，正在执行正式对齐与最终笔记生成
- `done`
  - 正式 session 数据可供 notes 页消费
- `error`
  - ASR 或 final polish 失败

### 10.2 Segment 状态机

```text
interim
-> final
-> assigned
-> compiled
```

说明：

- `interim`
  - 仅内存，不落库
- `final`
  - 句子结束，落库
- `assigned`
  - 完成页归属
- `compiled`
  - 已被纳入 page state

### 10.3 Page 编译状态

```text
clean
-> dirty
-> compiling
-> ready
-> dirty
```

含义：

- `dirty`
  - 有新 transcript 或 annotation 到来
- `compiling`
  - 正在跑 facts 抽取或渲染
- `ready`
  - 当前页有可展示 AI notes

---

## 11. 时延预算

目标是让用户主观感受接近“老师刚说完，几秒内右侧 AI notes 就更新”。

建议预算：

- 浏览器录音 chunk：250ms
- ffmpeg 转码：100ms 到 300ms
- 流式 ASR 首次 interim：300ms 到 900ms
- sentence final：1s 到 3s
- 在线归页：小于 50ms
- facts 增量抽取：800ms 到 2000ms
- 页级渲染：800ms 到 2500ms

用户可感知目标：

- 字幕更新延迟：1 秒内
- 当前页 AI note 更新延迟：2 到 5 秒
- 结束课程进入最终笔记：10 到 90 秒，随课程长度增长

---

## 12. 分阶段实施

### Phase 1：打通可靠数据面

目标：

- 每条 final transcript 都能带 `segment_id` 落库
- 前端能从服务端拉到当前页 transcript

文件：

- [backend/routers/live.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/live.py)
- [backend/services/live_store.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_store.py)
- [frontend/src/pages/LivePage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/LivePage.tsx)

验收：

- 断开页面后重新进入，live transcript 不丢
- transcript 不再只存在前端内存

### Phase 2：结束课程后的正式对齐

目标：

- 录音结束后，服务端基于 `ppt_text + transcript` 输出正式 `assigned_page`
- `currentPage` / `current_page_hint` 只作为辅助信号，不再当最终归属

文件：

- [backend/services/live_alignment.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_alignment.py)
- [backend/routers/live.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/live.py)

验收：

- 同一节课结束后，session 中每页的 `aligned_segments` 来自正式语义对齐，而不是前端按 `currentPage` 直接归档
- `off_slide` 片段能进入最近页 supplement

### Phase 3：增量 note 编译

目标：

- 当前页 AI note 能在课中自动刷新
- note 与 transcript 可追溯

文件：

- [backend/services/live_note_builder.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/live_note_builder.py)
- [backend/services/note_generator.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/services/note_generator.py)

验收：

- 新增 2 到 4 条 final segments 后，右侧 AI Notes 在 5 秒内刷新
- 每个 bullet 至少能回溯到 1 个以上 `segment_id`

### Phase 4：finalize 与 notes 页接入

目标：

- 结束课程后自动进入正式 notes
- 不重跑整段音频 ASR
- finalize 阶段包含正式对齐，而不是只做 polish

文件：

- [backend/routers/live.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/live.py)
- [backend/routers/sessions.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/sessions.py)
- [frontend/src/pages/LivePage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/LivePage.tsx)
- [frontend/src/pages/NotesPage.tsx](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/frontend/src/pages/NotesPage.tsx)

验收：

- 结束课程后 1 次 finalize 即可进入 notes 页
- 正式 notes 与课中累积内容一致，不发生大规模重写偏移

---

## 13. 明确不做

本阶段明确不做：

- 多人 speaker diarization 精细区分
- 混合中英实时识别
- 全量事件总线、消息队列、分布式 worker
- 实时 vector DB 检索层
- 课程中每句都触发大模型重写全文

这些都不属于 MVP 的最短路径。

---

## 14. 风险与应对

- 风险：在线归页抖动
  - 应对：加入切页 hysteresis，维持 `stable / candidate / off_slide` 状态机
- 风险：高频模型调用成本过高
  - 应对：先抽取 facts，再按阈值渲染，不做逐句重写
- 风险：前后端状态不一致
  - 应对：服务端成为 transcript 与 note state 唯一真相
- 风险：结束课程后结果与课中显示不一致
  - 应对：接受 live 阶段只是预览态；最终页归属以结束课程后的正式对齐结果为准

---

## 15. 推荐决策

建议立即确认以下决策：

- 采用“服务端为 live transcript 唯一真相”的架构
- 新增 `live_store.py / live_alignment.py / live_note_builder.py`
- 将 [process.py](C:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/routers/process.py) 保持为上传音频批处理链路，不强改成实时主链路
- Live 模式 finalize 要做正式页级对齐 + 最终 note 生成，但不重跑整段音频 ASR

一旦这四个决策确认，后续实现路径就很清晰了。
