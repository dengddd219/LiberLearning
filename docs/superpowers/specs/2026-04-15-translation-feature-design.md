# 翻译功能设计规格

**日期**：2026-04-15  
**范围**：NotesPage 笔记面板翻译功能（英→中）  
**状态**：待实现

---

## 1. 背景与目标

LiberStudy 支持英文课程场景（英文 ASR via 阿里云 `en-us`）。笔记内容为英文，目标用户（国内大学生）需要中文翻译辅助理解。

**目标**：在笔记面板工具栏添加翻译入口，用户可按需开启/关闭英→中翻译，翻译范围限于笔记内容，界面按钮文字不翻译。

---

## 2. 用户流程

1. 用户在 NotesPage 查看英文笔记
2. 点击笔记面板工具栏的翻译图标（地球仪）
3. 弹出仿 Chrome 翻译弹窗
4. 选择目标语言（中文简体 / 中文繁体），点击「翻译」
5. 当前页笔记内容替换为中文，原文隐藏
6. 翻页时自动翻译新页内容（懒加载）
7. 点击弹窗「✕」或再次点击工具栏图标，关闭弹窗；翻译状态保持开启
8. 弹窗内「更多 ▾」展开后显示「显示原文」，点击关闭翻译、恢复原文

---

## 3. 翻译服务

### 3.1 API

使用 **MyMemory 免费翻译 API**，无需 API Key：

```
GET https://api.mymemory.translated.net/get?q={text}&langpair=en|zh-CN
```

- `langpair`：`en|zh-CN`（简体）或 `en|zh-TW`（繁体）
- 免费配额：每天 1000 次请求
- 预估用量：一次课约 20 页 × 5 条 bullet = 100 次，安全
- 失败处理：静默降级，显示原文，不报错

### 3.2 响应解析

```ts
const res = await fetch(url)
const data = await res.json()
return data.responseData.translatedText as string
```

---

## 4. 状态管理

新建 `TranslationContext`，全局提供：

```ts
interface TranslationContextValue {
  enabled: boolean                        // 翻译是否开启
  targetLang: 'zh-CN' | 'zh-TW'          // 目标语言
  setTargetLang: (lang: 'zh-CN' | 'zh-TW') => void
  toggleEnabled: () => void
  translate: (text: string) => Promise<string>  // 带缓存
}
```

**缓存**：`Map<string, string>`，key = `${targetLang}:${原文}`，value = 译文。存在 Context 内存中，同一 session 内切换开关不重复请求。切换目标语言时缓存仍有效（key 包含语言前缀）。

**Provider 位置**：挂在 `App.tsx` 路由外层，覆盖所有页面。

---

## 5. UI 规格

### 5.1 翻译按钮

**位置**：笔记面板顶部工具栏，导出按钮左侧。

```html
<!-- 现有工具栏结构 -->
<div class="flex items-center gap-2">
  <!-- 新增：翻译按钮 -->
  <button class="p-1.5 rounded hover:bg-black/5" title="翻译">
    <GlobeIcon width="16" height="16" />
  </button>
  <!-- 现有：导出按钮 -->
  <button class="p-1.5 rounded hover:bg-black/5" title="导出 Markdown">
    <DownloadIcon />
  </button>
</div>
```

- 翻译未开启：图标颜色 `#9B9A94`（muted）
- 翻译已开启：图标颜色 `#1A1916`（fg，高亮）
- 点击：切换弹窗显示/隐藏

### 5.2 翻译弹窗

弹窗定位：相对翻译按钮，`position: absolute`，`top: 100% + 8px`，`right: 0`。需要 `z-index: 50`。

**视觉规格（精确还原 Chrome 翻译弹窗）**：

```
┌─────────────────────────────────────┐
│ 翻译 英语 页面？               ✕   │  ← 15px medium, ✕ 右上角
│                                     │
│ 翻译为                              │  ← 12px muted
│ ┌─────────────────────────────── ▾┐ │  ← select 下拉
│ │ 中文（简体）                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│                    [翻译]  更多 ▾  │  ← 右对齐
└─────────────────────────────────────┘
```

**样式参数**：

| 属性 | 值 |
|------|-----|
| 背景 | `#FFFFFF` |
| 圆角 | `border-radius: 12px` |
| 阴影 | `box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)` |
| 宽度 | `280px` |
| padding | `16px` |
| 标题字号 | `15px`, `font-weight: 500` |
| 副标签字号 | `12px`, `color: #6B6A64` |

**下拉选项**：
- 中文（简体）→ `zh-CN`
- 中文（繁体）→ `zh-TW`

**「翻译」按钮**：
- 背景 `#1A1916`，文字白色，`border-radius: 8px`，`padding: 6px 16px`，`font-size: 14px`
- 点击：关闭弹窗，开启翻译，翻译当前页

**「更多 ▾」**：
- 文字按钮，点击展开一个小菜单，包含「显示原文」选项
- 点击「显示原文」：关闭翻译，恢复原文，收起弹窗

**✕ 关闭**：仅关闭弹窗，不关闭翻译

### 5.3 点击外部关闭

弹窗外点击（`useEffect` + `mousedown` 监听）关闭弹窗，不影响翻译状态。

---

## 6. 懒加载翻译策略

**触发时机**：
- 用户点击「翻译」按钮 → 翻译当前页
- 用户翻页（页码变化）且 `enabled === true` → 翻译新页

**翻译粒度**：每条文本独立请求，页内所有条目 `Promise.all` 并行发出。

**翻译范围（每页）**：
1. `passive_notes.bullets[].ppt_text`（所有层级）
2. `passive_notes.bullets[].ai_comment`（非 null 的）
3. `page_supplement.content`（存在时）
4. `active_notes.ai_expansion`（存在时）

**翻译中状态**：文字 `opacity: 0.4`，翻译完成后恢复 `opacity: 1`，过渡 `transition: opacity 0.2s`。

**失败降级**：单条翻译失败时，该条显示原文，其余条目不受影响。

---

## 7. 组件改动范围

| 文件 | 改动 |
|------|------|
| `frontend/src/context/TranslationContext.tsx` | **新建**：Context + Provider + `translate()` 函数 |
| `frontend/src/lib/translation.ts` | **新建**：`translateWithMyMemory()` 纯函数 |
| `frontend/src/App.tsx` | 包裹 `TranslationProvider` |
| `frontend/src/pages/NotesPage.tsx` | 工具栏注入翻译按钮 + 弹窗组件；翻页时触发翻译 |
| `frontend/src/components/TranslationPopover.tsx` | **新建**：仿 Chrome 翻译弹窗 UI |
| `frontend/src/components/PassiveNotes.tsx` | 接收翻译后文本，`enabled` 时显示译文 |

---

## 8. 数据流

```
用户点击「翻译」
  → TranslationContext.enabled = true
  → NotesPage 检测到 enabled && 当前页数据存在
  → 对当前页所有文本调 context.translate()
  → translate() 查缓存 → 未命中则调 MyMemory API
  → 结果存入缓存，返回译文
  → PassiveNotes 接收译文 props，显示中文
  → 用户翻页 → 重复上述流程（已缓存页直接用缓存）
```

---

## 9. 不在范围内

- 其他语言对（仅支持英→中）
- 翻译结果持久化到数据库
- 界面按钮/导航文字翻译
- 中文课程内容翻译（产品语言是中文，无此需求）
- MyMemory 超出配额的处理（MVP 阶段用量安全）
