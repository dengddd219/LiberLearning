# Translation Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在笔记面板工具栏添加翻译按钮，点击后弹出仿 Chrome 翻译弹窗，用户可选中文简体/繁体，开启后当前页笔记内容（bullets、AI comments、page supplement、active notes AI expansion）替换为中文译文，翻页时懒加载翻译，同一 session 内缓存复用。

**Architecture:** TranslationContext 持有 enabled/targetLang 状态和带缓存的 translate() 函数，挂在 App.tsx 最外层。NotesPage 监听 enabled 和 currentPage，触发当前页所有文本的并行翻译。PassiveNotes 接收 translatedBullets prop，enabled 时显示译文，否则显示原文。TranslationPopover 是独立弹窗 UI 组件，由 NotesPage 工具栏的翻译按钮控制显隐。

**Tech Stack:** React Context, MyMemory API (free, no key), TypeScript, Tailwind CSS

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/lib/translation.ts` | 新建 | 纯函数 `translateWithMyMemory(text, langpair)` |
| `frontend/src/context/TranslationContext.tsx` | 新建 | Context + Provider，带缓存的 `translate()` |
| `frontend/src/components/TranslationPopover.tsx` | 新建 | 仿 Chrome 弹窗 UI |
| `frontend/src/App.tsx` | 修改 | 包裹 TranslationProvider |
| `frontend/src/pages/NotesPage.tsx` | 修改 | 翻译按钮、弹窗、翻译状态、translatePage() |
| `frontend/src/components/PassiveNotes.tsx` | 修改 | 接收 translatedBullets prop，显示译文 |

---

## Task 1: 翻译服务纯函数

**Files:**
- Create: `frontend/src/lib/translation.ts`

- [ ] **Step 1: 新建文件，写 translateWithMyMemory 函数**

```typescript
// frontend/src/lib/translation.ts

/**
 * 调用 MyMemory 免费翻译 API（无需 API Key）。
 * 失败时静默返回原文。
 * @param text 要翻译的文本
 * @param langpair 语言对，如 "en|zh-CN" 或 "en|zh-TW"
 */
export async function translateWithMyMemory(
  text: string,
  langpair: string,
): Promise<string> {
  if (!text.trim()) return text
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`
    const res = await fetch(url)
    if (!res.ok) return text
    const data = await res.json()
    const translated: string = data?.responseData?.translatedText
    // MyMemory 在配额耗尽时返回错误消息字符串，检测并降级
    if (!translated || translated.startsWith('MYMEMORY WARNING')) return text
    return translated
  } catch {
    return text
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/lib/translation.ts
git commit -m "feat: add translateWithMyMemory service function"
```

---

## Task 2: TranslationContext

**Files:**
- Create: `frontend/src/context/TranslationContext.tsx`

- [ ] **Step 1: 新建 Context 文件**

```typescript
// frontend/src/context/TranslationContext.tsx
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { translateWithMyMemory } from '../lib/translation'

export type TargetLang = 'zh-CN' | 'zh-TW'

interface TranslationContextValue {
  enabled: boolean
  targetLang: TargetLang
  setTargetLang: (lang: TargetLang) => void
  setEnabled: (v: boolean) => void
  translate: (text: string) => Promise<string>
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-CN')
  // cache key: `${targetLang}:${originalText}` → translatedText
  const cacheRef = useRef<Map<string, string>>(new Map())

  const translate = useCallback(
    async (text: string): Promise<string> => {
      const key = `${targetLang}:${text}`
      if (cacheRef.current.has(key)) {
        return cacheRef.current.get(key)!
      }
      const result = await translateWithMyMemory(text, `en|${targetLang}`)
      cacheRef.current.set(key, result)
      return result
    },
    [targetLang],
  )

  return (
    <TranslationContext.Provider value={{ enabled, setEnabled, targetLang, setTargetLang, translate }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(TranslationContext)
  if (!ctx) throw new Error('useTranslation must be used inside TranslationProvider')
  return ctx
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/context/TranslationContext.tsx
git commit -m "feat: add TranslationContext with cache"
```

---

## Task 3: 挂载 TranslationProvider 到 App

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 在 App.tsx 导入并包裹 TranslationProvider**

打开 `frontend/src/App.tsx`，在文件顶部导入区添加：

```typescript
import { TranslationProvider } from './context/TranslationContext'
```

将 `<TabsProvider>` 外层包裹 `<TranslationProvider>`：

```tsx
function App() {
  return (
    <TranslationProvider>
      <TabsProvider>
        <TopBar />
        <Routes>
          {/* ...所有 Route 保持不变... */}
        </Routes>
      </TabsProvider>
    </TranslationProvider>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wrap App with TranslationProvider"
```

---

## Task 4: TranslationPopover 弹窗组件

**Files:**
- Create: `frontend/src/components/TranslationPopover.tsx`

- [ ] **Step 1: 新建弹窗组件**

```tsx
// frontend/src/components/TranslationPopover.tsx
import { useEffect, useRef, useState } from 'react'
import { type TargetLang } from '../context/TranslationContext'

interface TranslationPopoverProps {
  onClose: () => void          // 仅关闭弹窗，不改变翻译状态
  onTranslate: () => void      // 点击「翻译」按钮
  onShowOriginal: () => void   // 点击「显示原文」
  targetLang: TargetLang
  onTargetLangChange: (lang: TargetLang) => void
  enabled: boolean             // 翻译是否已开启（控制「更多」菜单内容）
}

export default function TranslationPopover({
  onClose,
  onTranslate,
  onShowOriginal,
  targetLang,
  onTargetLangChange,
  enabled,
}: TranslationPopoverProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击弹窗外部关闭
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: '280px',
        background: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
        padding: '16px',
        zIndex: 50,
        fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span style={{ fontSize: '15px', fontWeight: 500, color: '#1A1916' }}>
          翻译 英语 页面？
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            color: '#9B9A94',
            padding: '0 2px',
            lineHeight: 1,
          }}
          aria-label="关闭翻译弹窗"
        >
          ✕
        </button>
      </div>

      {/* 翻译为 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#6B6A64', marginBottom: '6px' }}>翻译为</div>
        <select
          value={targetLang}
          onChange={(e) => onTargetLangChange(e.target.value as TargetLang)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #E4E3DE',
            fontSize: '14px',
            color: '#1A1916',
            background: '#FAFAF8',
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6A64' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            paddingRight: '32px',
          }}
        >
          <option value="zh-CN">中文（简体）</option>
          <option value="zh-TW">中文（繁体）</option>
        </select>
      </div>

      {/* 底部按钮行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', position: 'relative' }}>
        {/* 更多 ▾ */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#6B6A64',
              padding: '6px 8px',
              borderRadius: '6px',
            }}
          >
            更多 ▾
          </button>
          {moreOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                right: 0,
                background: '#FFFFFF',
                borderRadius: '8px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
                padding: '4px',
                minWidth: '120px',
                zIndex: 51,
              }}
            >
              <button
                onClick={() => {
                  setMoreOpen(false)
                  onShowOriginal()
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: '#1A1916',
                  padding: '8px 12px',
                  borderRadius: '6px',
                }}
                className="hover:bg-black/5"
              >
                显示原文
              </button>
            </div>
          )}
        </div>

        {/* 翻译按钮 */}
        <button
          onClick={onTranslate}
          style={{
            background: '#1A1916',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            padding: '6px 16px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          翻译
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/TranslationPopover.tsx
git commit -m "feat: add TranslationPopover component (Chrome-style)"
```

---

## Task 5: NotesPage — 翻译按钮、翻译状态、translatePage

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

这个 Task 分三个子步骤，每步独立提交。

### 5a: 导入和状态

- [ ] **Step 1: 在 NotesPage.tsx 顶部添加导入**

在现有 import 块末尾添加：

```typescript
import { useTranslation } from '../context/TranslationContext'
import TranslationPopover from '../components/TranslationPopover'
```

- [ ] **Step 2: 在 NotesPage() 函数体内，现有 state 声明之后添加翻译相关 state**

找到 `const [animatedBullets, setAnimatedBullets] = useState...` 这行之后，添加：

```typescript
// Translation state
const { enabled: translationEnabled, setEnabled: setTranslationEnabled, targetLang, setTargetLang, translate } = useTranslation()
const [popoverOpen, setPopoverOpen] = useState(false)
// translatedTexts: pageNum → { bullets: string[], aiComments: string[], supplement: string | null, aiExpansion: string | null }
const [translatedTexts, setTranslatedTexts] = useState<Map<number, {
  bullets: string[]
  aiComments: (string | null)[]
  supplement: string | null
  aiExpansion: string | null
}>>(new Map())
```

- [ ] **Step 3: 添加 translatePage 函数**

在 `handleRetryPage` 函数之后添加：

```typescript
const translatePage = useCallback(async (pageNum: number) => {
  if (!session) return
  const page = session.pages.find((p) => p.page_num === pageNum)
  if (!page) return

  const bullets = page.passive_notes?.bullets ?? []
  const supplement = page.page_supplement?.content ?? null
  const aiExpansion = page.active_notes?.ai_expansion ?? null

  // 并行翻译所有文本
  const [translatedBullets, translatedAiComments, translatedSupplement, translatedAiExpansion] =
    await Promise.all([
      Promise.all(bullets.map((b) => translate(b.ppt_text))),
      Promise.all(bullets.map((b) => (b.ai_comment ? translate(b.ai_comment) : Promise.resolve(null)))),
      supplement ? translate(supplement) : Promise.resolve(null),
      aiExpansion ? translate(aiExpansion) : Promise.resolve(null),
    ])

  setTranslatedTexts((prev) => {
    const next = new Map(prev)
    next.set(pageNum, {
      bullets: translatedBullets,
      aiComments: translatedAiComments,
      supplement: translatedSupplement,
      aiExpansion: translatedAiExpansion,
    })
    return next
  })
}, [session, translate])
```

- [ ] **Step 4: 添加 useEffect 监听翻页时自动翻译**

在现有 `useEffect` 块之后（`handleTimestampClick` 之前）添加：

```typescript
// 翻译已开启时，翻页自动翻译新页
useEffect(() => {
  if (translationEnabled && session) {
    translatePage(currentPage)
  }
}, [currentPage, translationEnabled, session])
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(NotesPage): add translation state and translatePage logic"
```

### 5b: 翻译按钮 UI 注入

- [ ] **Step 6: 在工具栏 `{/* Right: Download */}` 块内，导出按钮之前插入翻译按钮**

找到 `frontend/src/pages/NotesPage.tsx` 第 572 行附近的：

```tsx
{/* Right: Download */}
<div className="flex items-center gap-2">
  <button
    onClick={handleExportMarkdown}
    className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
    title="导出 Markdown"
  >
```

在 `<div className="flex items-center gap-2">` 和导出按钮之间插入（整个 `<div>` 改为带 `position: relative`）：

```tsx
{/* Right: Translate + Download */}
<div className="flex items-center gap-2" style={{ position: 'relative' }}>
  {/* 翻译按钮 */}
  <button
    onClick={() => setPopoverOpen((v) => !v)}
    className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
    title="翻译"
    style={{ color: translationEnabled ? '#1A1916' : '#9B9A94' }}
  >
    {/* 地球仪图标 */}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  </button>

  {/* 翻译弹窗 */}
  {popoverOpen && (
    <TranslationPopover
      enabled={translationEnabled}
      targetLang={targetLang}
      onTargetLangChange={setTargetLang}
      onClose={() => setPopoverOpen(false)}
      onTranslate={() => {
        setTranslationEnabled(true)
        setPopoverOpen(false)
        translatePage(currentPage)
      }}
      onShowOriginal={() => {
        setTranslationEnabled(false)
        setPopoverOpen(false)
      }}
    />
  )}

  {/* 导出按钮（保持不变） */}
  <button
    onClick={handleExportMarkdown}
    className="cursor-pointer transition-all duration-150 p-1.5 rounded hover:bg-black/5"
    title="导出 Markdown"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  </button>
</div>
```

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(NotesPage): add translation button and popover in toolbar"
```

### 5c: 把 translatedTexts 传给渲染层

- [ ] **Step 8: 在笔记面板的 passive_notes bullets 渲染处，把译文传给 AiBulletRow**

找到 NotesPage.tsx 中 `AiBulletRow` 被渲染的地方（约第 890 行），它渲染了 `bullet` prop。
需要给 `AiBulletRow` 传两个新 prop：`translatedPptText` 和 `translatedAiComment`。

先找到 `AiBulletRow` 组件定义（约第 62 行）。在其 props interface 添加：

```typescript
// 在现有 AiBulletRow 的 props 中添加（找到该组件的 props interface 或 function 签名）：
translatedPptText?: string
translatedAiComment?: string | null
translationEnabled?: boolean
```

在组件内，把所有显示 `bullet.ppt_text` 的地方改为：
```tsx
{translationEnabled && translatedPptText ? translatedPptText : bullet.ppt_text}
```

把所有显示 `bullet.ai_comment` 的地方改为：
```tsx
{translationEnabled && translatedAiComment ? translatedAiComment : bullet.ai_comment}
```

- [ ] **Step 9: 在 AiBulletRow 调用处传入译文**

找到 NotesPage.tsx 约第 890 行的 `<AiBulletRow` 调用，添加新 props：

```tsx
<AiBulletRow
  key={`${currentPage}-${i}`}
  bullet={bullet}
  expanded={expandedBullets.get(currentPage)?.has(i) ?? false}
  animationDone={animatedBullets.get(currentPage)?.has(i) ?? false}
  translationEnabled={translationEnabled}
  translatedPptText={translatedTexts.get(currentPage)?.bullets[i]}
  translatedAiComment={translatedTexts.get(currentPage)?.aiComments[i]}
  onToggle={() => { /* 保持不变 */ }}
  onAnimationDone={() => { /* 保持不变 */ }}
  onTimestampClick={handleTimestampClick}
/>
```

- [ ] **Step 10: 翻译 page_supplement.content（约第 950 行）**

找到：
```tsx
<p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6' }}>
  {currentPageData.page_supplement.content}
</p>
```

改为：
```tsx
<p
  style={{
    fontSize: '13px',
    color: C.fg,
    lineHeight: '1.6',
    opacity: translationEnabled && !translatedTexts.get(currentPage)?.supplement ? 0.4 : 1,
    transition: 'opacity 0.2s',
  }}
>
  {translationEnabled && translatedTexts.get(currentPage)?.supplement
    ? translatedTexts.get(currentPage)!.supplement!
    : currentPageData.page_supplement.content}
</p>
```

- [ ] **Step 11: 翻译 active_notes.ai_expansion（约第 840 行）**

找到：
```tsx
<p style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6' }}>
  {currentPageData.active_notes.ai_expansion}
</p>
```

改为：
```tsx
<p
  style={{
    fontSize: '14px',
    color: C.fg,
    lineHeight: '1.6',
    opacity: translationEnabled && !translatedTexts.get(currentPage)?.aiExpansion ? 0.4 : 1,
    transition: 'opacity 0.2s',
  }}
>
  {translationEnabled && translatedTexts.get(currentPage)?.aiExpansion
    ? translatedTexts.get(currentPage)!.aiExpansion!
    : currentPageData.active_notes.ai_expansion}
</p>
```

- [ ] **Step 12: 提交**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(NotesPage): wire translated texts to bullet/supplement/expansion rendering"
```

---

## Task 6: AiBulletRow 组件——翻译 opacity 加载动效

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx` (AiBulletRow 定义部分，约 L62-L221)

- [ ] **Step 1: 在 AiBulletRow 的 ppt_text span 上添加 opacity 动效**

找到 AiBulletRow 内渲染 `bullet.ppt_text` 的 `<span>`，添加 style：

```tsx
<span
  style={{
    opacity: translationEnabled && !translatedPptText ? 0.4 : 1,
    transition: 'opacity 0.2s',
  }}
>
  {translationEnabled && translatedPptText ? translatedPptText : bullet.ppt_text}
</span>
```

找到渲染 `bullet.ai_comment` 的 `<p>`，添加 style：

```tsx
<p
  style={{
    opacity: translationEnabled && !translatedAiComment ? 0.4 : 1,
    transition: 'opacity 0.2s',
  }}
>
  {translationEnabled && translatedAiComment ? translatedAiComment : bullet.ai_comment}
</p>
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat(AiBulletRow): add opacity transition for translation loading state"
```

---

## Task 7: 手动验证

- [ ] **Step 1: 启动开发服务器**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 打开一个有英文笔记的 session（/notes/:id）**

验证以下行为：

| 操作 | 预期结果 |
|------|----------|
| 点击工具栏地球仪图标 | 弹出 Chrome 风格弹窗，默认选中"中文（简体）" |
| 弹窗外点击 | 弹窗关闭，翻译状态不变 |
| 点击「翻译」 | 弹窗关闭，bullet 文字短暂变淡（opacity 0.4），随后显示中文 |
| 翻到下一页 | 新页 bullet 短暂变淡，随后显示中文 |
| 翻回已翻页 | 直接显示中文（缓存命中，无网络请求） |
| 下拉选"中文（繁体）" → 点翻译 | 切换为繁体中文 |
| 点「更多 ▾」→「显示原文」 | 弹窗关闭，所有文字恢复英文原文 |
| 地球仪图标颜色 | 翻译开启时深色（#1A1916），关闭时浅色（#9B9A94） |

- [ ] **Step 3: 提交（如有 fix）**

```bash
git add -p
git commit -m "fix: translation feature manual test fixes"
```

---

## 自检 Checklist

Spec 覆盖检查：
- [x] §2 用户流程 → Task 5b（按钮）+ Task 4（弹窗）+ Task 5c（懒加载翻页）
- [x] §3 MyMemory API → Task 1
- [x] §4 TranslationContext + 缓存 → Task 2
- [x] §5.1 翻译按钮位置/颜色 → Task 5b
- [x] §5.2 弹窗 UI（标题/下拉/翻译/更多/✕） → Task 4
- [x] §5.3 点击外部关闭 → Task 4（useEffect mousedown）
- [x] §6 懒加载：点翻译 → 当前页；翻页 → 新页 → Task 5a（useEffect）
- [x] §6 翻译范围：bullets / ai_comment / supplement / ai_expansion → Task 5a translatePage + Task 5c
- [x] §6 opacity 动效 → Task 6
- [x] §6 失败降级 → Task 1（try/catch 返回原文）
- [x] §7 所有 6 个文件 → Task 1-6 全覆盖
