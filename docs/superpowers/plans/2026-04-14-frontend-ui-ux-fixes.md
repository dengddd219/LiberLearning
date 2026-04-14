# Frontend UI/UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复全站 7 个页面的系统性 UI/UX 问题，覆盖响应式布局、无障碍语义、颜色 token、功能性 bug 三个层面。

**Architecture:** 采用「从基础到页面」的修复顺序：先建立全局设计 token（index.css）和工具类，再逐页修复，保证每次提交后页面仍可运行。不重构组件结构，只做外科手术式修改。

**Tech Stack:** React 18 + Vite + Tailwind CSS v4（`@theme` 语法）+ React Router v6

**Review 背景（修复依据来源）：**
所有问题均来自对 7 个页面的并行 UI/UX Review，评分范围 2.5–4.5/10，主要问题分三类：
1. **响应式缺失**：LobbyPage `w-[1280px]`、SessionPage/LiveSessionPage `width: 1519px` 硬编码
2. **无障碍（a11y）缺失**：`<div onClick>` 代替 `<button>`，无 `aria-label`，Modal 无焦点管理
3. **功能性 bug**：DetailedNotePage 底部导航无 onClick，catch 块静默降级，版权年份过期

---

## 文件地图

| 文件 | 改动类型 | 主要内容 |
|------|----------|----------|
| `frontend/src/index.css` | 修改 | 新增语义颜色 token、通用工具类 |
| `frontend/src/pages/LobbyPage.tsx` | 修改 | 响应式布局、`<button>` 替换、Modal aria、图标 aria-label |
| `frontend/src/pages/SessionPage.tsx` | 修改 | 响应式布局、导航语义、工具栏 aria-label、catch 错误处理 |
| `frontend/src/pages/LiveSessionPage.tsx` | 修改 | 响应式布局、所有图标 div → button、输入框改为 textarea、Tab 切换逻辑 |
| `frontend/src/pages/UploadPage.tsx` | 修改 | UploadZone 键盘支持、删除按钮触控区、Modal aria、catch 错误处理 |
| `frontend/src/pages/ProcessingPage.tsx` | 修改 | progressbar aria、错误状态用 SVG 替换 emoji、字体统一、颜色统一 |
| `frontend/src/pages/NotesPage.tsx` | 修改 | pill toggle aria、导航按钮 aria-label、发送按钮功能修正 |
| `frontend/src/pages/DetailedNotePage.tsx` | 修改 | 底部导航 onClick、Tab 激活状态修正、章节标题语义化 |

---

## Task 1：建立全局颜色 Token 和工具类

**目标：** 在 `index.css` 中补全语义颜色 token，供后续任务的 Tailwind 类使用。避免每页各自硬编码颜色。

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1：扩展 `@theme` 颜色 token**

打开 `frontend/src/index.css`，将 `@theme` 块替换为：

```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap');

@theme {
  /* Brand */
  --color-primary: #3D3B35;
  --color-primary-hover: #2A2925;

  /* Text */
  --color-text-primary: #1A1916;
  --color-text-secondary: #2F3331;
  --color-text-muted: #76756F;
  --color-user-text: #1A1916;
  --color-ai-text: #4A4940;

  /* Surface */
  --color-surface: #F0EFEA;
  --color-surface-card: #FFFFFF;
  --color-surface-hover: #E8E7E2;

  /* Semantic */
  --color-error: #C0392B;
  --color-success: #2D6A4F;
  --color-warning: #B45309;

  /* Font */
  --font-serif: "Lora", Georgia, "Times New Roman", serif;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
}

body {
  margin: 0;
  font-family: var(--font-serif);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--color-surface);
  color: var(--color-text-primary);
}

#root {
  min-height: 100vh;
}
```

- [ ] **Step 2：启动 dev server 验证页面不报错**

```bash
cd frontend && npm run dev
```

访问 `http://localhost:5173`，确认页面加载正常，无控制台错误。

- [ ] **Step 3：提交**

```bash
git add frontend/src/index.css
git commit -m "style: add semantic color tokens to @theme in index.css"
```

---

## Task 2：修复 DetailedNotePage — 功能性 Bug（优先修复）

**目标：** 修复底部导航按钮无 onClick（功能完全失效）和顶部 Tab 激活状态标记错误。

**Files:**
- Modify: `frontend/src/pages/DetailedNotePage.tsx`

- [ ] **Step 1：定位底部导航区域**

在文件第 624–690 行找到以下结构：

```tsx
{/* Previous */}
<div ...>
  <div ...><IconArrowLeft /></div>
  ...
</div>

{/* Next */}
<div ...>
  ...
  <div ...><IconArrowRight /></div>
</div>
```

- [ ] **Step 2：给 Previous 导航 div 添加点击事件和语义**

将 Previous 外层 `<div>` 改为 `<button>`，加上 `onClick` 和 `aria-label`：

```tsx
<button
  type="button"
  onClick={() => navigate(-1)}
  aria-label="上一篇笔记"
  className="flex items-center gap-4 group cursor-pointer bg-transparent border-none p-0"
>
  {/* 内部内容保持不变 */}
</button>
```

- [ ] **Step 3：给 Next 导航 div 添加点击事件和语义**

将 Next 外层 `<div>` 改为 `<button>`，加上 `onClick` 和 `aria-label`：

```tsx
<button
  type="button"
  onClick={() => navigate(1)}
  aria-label="下一篇笔记"
  className="flex items-center gap-4 group cursor-pointer bg-transparent border-none p-0 ml-auto"
>
  {/* 内部内容保持不变 */}
</button>
```

- [ ] **Step 4：修复顶部导航 Tab 激活状态**

在第 142–161 行找到导航高亮逻辑：

```tsx
borderBottom: item === 'Courses' ? '2px solid #2F3331' : 'none'
```

改为：

```tsx
borderBottom: item === 'Detailed Note' ? '2px solid #2F3331' : 'none'
```

- [ ] **Step 5：修复章节标题语义（`<span>` → `<h2>`）**

找到第 320–331 行的 "SUMMARY"、第 346–357 行的 "KEY CONCEPTS"、第 547–558 行的 "DETAILED OBSERVATIONS"，将各自的外层 `<span>` 改为 `<h2>`，样式保持不变：

```tsx
// 示例：SUMMARY 标题
<h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9B9A94' }}>
  SUMMARY
</h2>
```

对 KEY CONCEPTS 和 DETAILED OBSERVATIONS 做相同处理。

- [ ] **Step 6：给顶部 bell/user 按钮加 aria-label**

在第 167–172 行找到两个 `<button>`：

```tsx
<button className="p-2 ..."><IconBell /></button>
<button className="p-2 ..."><IconUser /></button>
```

改为：

```tsx
<button type="button" aria-label="通知" className="p-3 ...">
  <IconBell aria-hidden="true" />
</button>
<button type="button" aria-label="用户菜单" className="p-3 ...">
  <IconUser aria-hidden="true" />
</button>
```

- [ ] **Step 7：更新版权年份**

找到页脚版权文字，将 `© 2024` 改为：

```tsx
© {new Date().getFullYear()} LIBERSTUDY EDITORIAL
```

- [ ] **Step 8：验证**

启动 dev server，访问 `/notes/detail/mock`，点击底部 Previous/Next 确认页面跳转，确认顶部"Detailed Note"有下划线而非"Courses"。

- [ ] **Step 9：提交**

```bash
git add frontend/src/pages/DetailedNotePage.tsx
git commit -m "fix: DetailedNotePage bottom nav onClick, active tab, heading semantics, aria-labels"
```

---

## Task 3：修复 ProcessingPage — aria 语义和视觉风格统一

**目标：** 给进度条加 aria，错误状态去掉 emoji，字体颜色与全站统一。

**Files:**
- Modify: `frontend/src/pages/ProcessingPage.tsx`

- [ ] **Step 1：给进度条容器加 aria 属性**

在第 95–100 行找到进度条外层 `<div>`：

```tsx
<div className="w-full bg-gray-100 rounded-full h-2 mb-8">
  <div className="h-full bg-indigo-600 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
</div>
```

改为：

```tsx
<div
  role="progressbar"
  aria-valuenow={progress}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label="处理总进度"
  className="w-full bg-gray-100 rounded-full h-2 mb-8"
>
  <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
</div>
```

注意同时将 `bg-indigo-600` 改为 `bg-primary`（使用 Task 1 定义的 token）。

- [ ] **Step 2：错误状态替换 emoji ❌**

在第 73–80 行找到错误状态的 `<span className="text-4xl mb-4 block">❌</span>`，替换为语义化 SVG 并加 `role="alert"`：

```tsx
<div role="alert" aria-live="assertive" className="text-center">
  <svg
    aria-hidden="true"
    className="w-12 h-12 mx-auto mb-4 text-error"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
  {/* 后续 h2 和段落保持不变 */}
</div>
```

同时将错误文字 `text-gray-600` 保持，移除原有 `<span>` 包裹。

- [ ] **Step 3：修复步骤列表的语义化状态**

在第 103–131 行的 `<ol>` 列表，给每个 `<li>` 加上状态 aria-label。找到渲染每个步骤的 JSX，在 `<li>` 上添加：

```tsx
<li
  key={stage.id}
  aria-label={`${stage.label}：${done ? '已完成' : active ? '进行中' : '等待中'}`}
  className="flex items-start gap-4"
>
  <div aria-hidden="true" className={...}>
    {done ? '✓' : i + 1}
  </div>
  ...
</li>
```

- [ ] **Step 4：修复低对比度颜色**

将第 93 行 `text-gray-400`（倒计时文字）改为 `text-gray-600`，将第 120 行 completed 步骤的 `text-gray-400 line-through` 改为 `text-gray-500`（去掉 `line-through`，视觉上够清晰）。

- [ ] **Step 5：加 `font-sans` 覆盖 body 的 serif 继承**

在外层容器 `<div>` 上加 `font-sans`：

```tsx
<div className="min-h-screen bg-surface flex items-center justify-center p-4 font-sans">
```

同时将 `bg-gray-50` 改为 `bg-surface`（使用 Task 1 token）。

- [ ] **Step 6：remaning === 0 时的文案修复**

在第 69 行找到 `remaining` 计算，在显示倒计时的 JSX 处加条件判断：

```tsx
<p className="text-sm text-gray-600 mb-8">
  {remaining > 0 ? `预计还需 ${remaining} 秒` : '仍在处理中，请稍候...'}
</p>
```

- [ ] **Step 7：错误恢复提供两个选项**

在第 79 行找到"重新处理"按钮，将 `window.location.reload()` 替换为两个按钮：

```tsx
<div className="flex gap-3 justify-center mt-6">
  <button
    type="button"
    onClick={() => navigate('/upload')}
    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
  >
    重新上传
  </button>
  <button
    type="button"
    onClick={() => setFailed(false)}
    className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover"
  >
    重试
  </button>
</div>
```

注意：需要确认 `setFailed` 是否在组件 state 中定义（第 35 行的 `failed` state），若无则添加 `const [failed, setFailed] = useState(false)`。

- [ ] **Step 8：验证**

访问 `/processing?session_id=test`，确认进度条动画正常、字体为 sans-serif、颜色与全站一致。

- [ ] **Step 9：提交**

```bash
git add frontend/src/pages/ProcessingPage.tsx
git commit -m "fix: ProcessingPage aria progressbar, error state semantics, font/color consistency"
```

---

## Task 4：修复 UploadPage — 键盘无障碍和错误处理

**目标：** UploadZone 支持键盘访问，删除按钮触控区扩大，Modal 加 aria，catch 块显示错误。

**Files:**
- Modify: `frontend/src/pages/UploadPage.tsx`

- [ ] **Step 1：给 UploadZone 外层 div 加键盘支持**

在第 98–103 行找到 UploadZone 外层 `<div onClick={handleClick}>`，改为：

```tsx
<div
  role="button"
  tabIndex={0}
  aria-label={file ? `已选择：${file.name}，点击替换` : `点击或拖拽上传${label}文件`}
  onClick={handleClick}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
  className={...}
>
```

- [ ] **Step 2：扩大删除按钮触控区**

在第 163–175 行找到删除按钮，将其尺寸改为至少 44px 热区：

```tsx
<button
  type="button"
  aria-label="移除已选文件"
  onClick={(e) => { e.stopPropagation(); onClear(); }}
  style={{
    width: '24px',
    height: '24px',
    padding: '10px',
    margin: '-10px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }}
>
  <svg aria-hidden="true" width="24" height="24" ...>...</svg>
</button>
```

- [ ] **Step 3：给 Modal 添加 aria 语义**

在第 397–406 行找到 Modal 根容器，添加 `role="dialog"` 等：

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="upload-modal-title"
  className="fixed inset-0 z-50 flex items-center justify-center"
>
```

在 Modal 标题（"ACTION CENTER" 或 "Upload Files"）的元素上加 `id="upload-modal-title"`。

- [ ] **Step 4：给关闭按钮加 aria-label**

在第 462–475 行找到关闭按钮：

```tsx
<button ... onClick={() => navigate(-1)}>
  <IconClose />
</button>
```

改为：

```tsx
<button
  type="button"
  aria-label="关闭，返回上一页"
  onClick={() => navigate(-1)}
  ...
>
  <IconClose aria-hidden="true" />
</button>
```

- [ ] **Step 5：添加 Escape 键关闭 Modal**

在组件内添加 `useEffect`（放在现有 useEffect 之后）：

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') navigate(-1);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [navigate]);
```

- [ ] **Step 6：修复 catch 块静默降级**

在第 385–395 行找到 `handleSubmit`，在组件顶部添加 `uploadError` state：

```tsx
const [uploadError, setUploadError] = useState<string | null>(null);
```

将 catch 块改为：

```tsx
} catch (err) {
  console.error('Upload failed:', err);
  setUploadError('上传失败，请检查网络后重试');
  setUploading(false);
}
```

在提交按钮上方（第 509 行前）添加错误提示：

```tsx
{uploadError && (
  <p role="alert" style={{ color: 'var(--color-error)', fontSize: '14px', textAlign: 'center', marginBottom: '8px' }}>
    {uploadError}
  </p>
)}
```

- [ ] **Step 7：修复 hint 文字颜色对比度**

将第 154 行 hint 文字颜色 `#556071` 改为 `#4A5568`：

```tsx
style={{ color: '#4A5568', fontSize: '11px' }}
```

- [ ] **Step 8：将英文 "Click to replace" 改为中文**

在 file 已选中的状态下找到 hint 文字 `"Click to replace"`，改为 `"点击替换"`。

- [ ] **Step 9：验证**

访问 `/upload`，打开 Modal，测试：Tab 键能聚焦到 UploadZone，Escape 键能关闭 Modal，删除按钮触控区是否够大（用开发者工具检查）。

- [ ] **Step 10：提交**

```bash
git add frontend/src/pages/UploadPage.tsx
git commit -m "fix: UploadPage keyboard a11y, modal aria, catch error display, contrast fixes"
```

---

## Task 5：修复 LobbyPage — 响应式布局和无障碍

**目标：** 去掉固定 1280px，所有交互 div 改为 button，Modal 加焦点管理。

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`

- [ ] **Step 1：修复根容器固定宽度**

在第 487 行找到：

```tsx
<div className="w-[1280px] pl-48 relative bg-stone-50 inline-flex ...">
```

改为：

```tsx
<div className="w-full min-h-screen bg-stone-50 flex relative">
```

- [ ] **Step 2：修复侧边栏定位**

将侧边栏从 `absolute` 改为 `flex-shrink-0`，内容区加 `flex-1 min-w-0`。找到侧边栏根 div（约第 540 行），将 `absolute left-0` 改为正常 flex 子元素参与布局：

```tsx
<aside
  aria-label="侧边导航"
  className="w-48 flex-shrink-0 flex flex-col bg-stone-50 border-r border-stone-200 min-h-screen"
>
```

内容区 div 加 `flex-1 min-w-0 overflow-auto`。

- [ ] **Step 3：将 DoneCard 和 ListRow 的 div 改为 button**

找到 `DoneCard`（第 174–197 行）和 `ListRow`（第 212–254 行）组件，将外层 `<div onClick={onClick}>` 改为：

```tsx
// DoneCard
<button
  type="button"
  onClick={onClick}
  aria-label={`打开课程：${title}`}
  className="text-left w-full ... cursor-pointer"
>

// ListRow
<button
  type="button"
  onClick={onClick}
  aria-label={`打开课程：${title}`}
  className="text-left w-full flex items-center ..."
>
```

注意保留原有 Tailwind 类，仅添加 `text-left w-full`（因为 button 默认 text-center）。

- [ ] **Step 4：给 bell 和 user 图标按钮加 aria-label 和尺寸**

在第 593–598 行：

```tsx
<button type="button" aria-label="通知" className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-stone-100">
  <IconBell aria-hidden="true" />
</button>
<button type="button" aria-label="用户设置" className="w-11 h-11 flex items-center justify-center">
  <img src="..." alt="用户头像" className="w-8 h-8 rounded-full" />
</button>
```

- [ ] **Step 5：给 NewClassModal 加 aria 语义和 Escape 关闭**

在 `NewClassModal` 组件（第 400–475 行）的根 div 上加：

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  className="fixed inset-0 z-50 flex items-center justify-center"
>
```

给标题元素（"New Class" 文字）加 `id="modal-title"`。

在 `NewClassModal` 组件内添加 Escape 关闭：

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [onClose]);
```

- [ ] **Step 6：给关闭按钮加 aria-label**

在第 418 行：

```tsx
<button type="button" onClick={onClose} aria-label="关闭对话框" className="...">
  <IconModalClose aria-hidden="true" />
</button>
```

- [ ] **Step 7：修复 LIVE AI Courses 卡片**

在第 640–651 行，将 `<div onClick={() => navigate('/session/live')}>` 改为：

```tsx
<button
  type="button"
  onClick={() => navigate('/session/live')}
  aria-label="进入 LIVE AI Courses"
  className="w-full text-left cursor-pointer hover:bg-stone-200 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:outline-none rounded-lg"
>
```

- [ ] **Step 8：修复版权年份**

找到页脚版权文字 `© 2024`，改为 `© {new Date().getFullYear()}`。

- [ ] **Step 9：验证**

访问 `/`，在 1280px 以下窗口确认无横向滚动，Tab 键能聚焦到课程卡片，打开 New Class Modal 后 Escape 能关闭。

- [ ] **Step 10：提交**

```bash
git add frontend/src/pages/LobbyPage.tsx
git commit -m "fix: LobbyPage responsive layout, button semantics, modal aria, icon aria-labels"
```

---

## Task 6：修复 SessionPage — 响应式和无障碍

**目标：** 去掉固定 1519px，导航加语义，工具栏 aria-label，catch 错误处理。

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1：修复根容器固定宽度**

在第 160 行找到：

```tsx
style={{ width: '1519px', minHeight: '100vh' }}
```

改为：

```tsx
className="w-full min-h-screen flex flex-col"
style={{}}
```

- [ ] **Step 2：主内容区固定宽度**

在第 338 行找到 canvas 区域的 `width: '896px'`，改为：

```tsx
className="w-full max-w-4xl mx-auto"
style={{ /* 移除 width */ }}
```

对 `height: '1024px'`（第 203 行）改为 `h-[calc(100vh-4rem)]`。

- [ ] **Step 3：导航栏改为语义化 `<nav>`**

在第 173–180 行的导航链接区，外层改为：

```tsx
<nav aria-label="主导航" className="flex items-center gap-6">
  <Link to="/" className="text-sm hover:text-primary">Dashboard</Link>
  <Link to="/" aria-current="page" className="text-sm font-medium border-b-2 border-primary">Courses</Link>
  <Link to="/" className="text-sm hover:text-primary">Detailed Note</Link>
</nav>
```

- [ ] **Step 4：工具栏按钮加 aria-label**

在第 267–327 行找到工具栏所有 `<button>`，逐一加 `aria-label`：

```tsx
<button type="button" aria-label="下载幻灯片" className="p-2.5 rounded-2xl hover:bg-black/5 transition-all duration-150">
  <svg aria-hidden="true" .../>
</button>
<button type="button" aria-label="添加批注" className="p-2.5 ...">
  <svg aria-hidden="true" .../>
</button>
<button type="button" aria-label="上一页" className="p-2.5 ...">
  <svg aria-hidden="true" .../>
</button>
<button type="button" aria-label="下一页" className="p-2.5 ...">
  <svg aria-hidden="true" .../>
</button>
<button type="button" aria-label="缩小" className="p-2.5 ...">
  <svg aria-hidden="true" .../>
</button>
<button type="button" aria-label="放大" className="p-2.5 ...">
  <svg aria-hidden="true" .../>
</button>
```

同时将所有工具栏按钮的 `p-1` 改为 `p-2.5`（约 40px 触控区）。

- [ ] **Step 5：幻灯片缩略图 div 改为 button**

在第 227–249 行，将 `<div onClick={...}>` 改为：

```tsx
<button
  type="button"
  key={slide.id}
  onClick={() => handleSlideClick(slide.pageNum)}
  aria-label={`跳转到第 ${slide.pageNum} 张幻灯片`}
  aria-current={currentSlide === slide.pageNum ? 'true' : undefined}
  className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary"
>
```

- [ ] **Step 6：修复 handleGenerateNotes 的 catch 块**

在第 117–119 行找到 catch 块：

```tsx
} catch { navigate('/processing?session_id=mock-session-001') }
```

改为：

```tsx
} catch (err) {
  console.error('Generate notes failed:', err);
  // TODO: 显示 toast 错误提示
  alert('提交失败，请重试');
} finally {
  setSubmitting(false);
}
```

（使用 `alert` 作为临时方案，后续接入 toast 组件时替换）

- [ ] **Step 7：修复版权年份**

找到 `© 2024`，改为 `© {new Date().getFullYear()}`。

- [ ] **Step 8：验证**

访问 `/session`，在 1440px 宽度确认无横向滚动，Tab 键能聚焦到幻灯片缩略图和工具栏按钮。

- [ ] **Step 9：提交**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "fix: SessionPage responsive layout, nav semantics, toolbar aria-labels, catch error"
```

---

## Task 7：修复 NotesPage — aria 语义和功能修正

**目标：** pill toggle 加 aria，导航按钮加 aria-label，发送按钮功能对齐。

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1：pill toggle 加 aria 语义**

在第 440–480 行找到 pill toggle 的外层容器和两个选项，改为：

```tsx
<div
  role="group"
  aria-label="笔记模式"
  className="flex items-center ..."
>
  <button
    type="button"
    role="tab"
    aria-selected={noteMode === 'my'}
    onClick={() => setNoteMode('my')}
    className={`... ${noteMode === 'my' ? 'bg-white shadow-sm' : ''}`}
  >
    我的笔记
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={noteMode === 'ai'}
    onClick={() => setNoteMode('ai')}
    className={`... ${noteMode === 'ai' ? 'bg-white shadow-sm' : ''}`}
  >
    AI 笔记
  </button>
</div>
```

- [ ] **Step 2：上一页/下一页按钮加 aria-label 和最小尺寸**

在第 327–347 行找到两个导航按钮，改为：

```tsx
<button
  type="button"
  aria-label="上一页"
  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
  disabled={currentPage <= 1}
  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100 disabled:opacity-40"
>
  <svg aria-hidden="true" .../>
</button>

<button
  type="button"
  aria-label="下一页"
  onClick={() => setCurrentPage(p => p + 1)}
  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100"
>
  <svg aria-hidden="true" .../>
</button>
```

- [ ] **Step 3：铃铛按钮加 aria-label**

在第 231 行：

```tsx
<button type="button" aria-label="通知" className="min-w-[44px] min-h-[44px] flex items-center justify-center ...">
  <svg aria-hidden="true" .../>
</button>
```

- [ ] **Step 4：修正发送按钮功能**

在第 673–687 行，发送按钮当前 `onClick={handleCopyPage}`（复制功能），与旁边输入框语义不符。将发送按钮改为复制图标并加 tooltip，输入框单独给予保存逻辑：

```tsx
{/* 将发送按钮改为复制按钮，语义对齐 */}
<button
  type="button"
  aria-label="复制当前页笔记"
  onClick={handleCopyPage}
  title="复制当前页笔记到剪贴板"
  className="..."
>
  <svg aria-hidden="true" .../>  {/* 使用复制图标而非发送图标 */}
</button>
```

- [ ] **Step 5：侧边栏收起按钮加 aria-label**

在第 262–266 行：

```tsx
<button
  type="button"
  aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
  aria-expanded={!sidebarCollapsed}
  onClick={() => setSidebarCollapsed(c => !c)}
  className="min-w-[44px] min-h-[44px] flex items-center justify-center ..."
>
  <svg aria-hidden="true" .../>
</button>
```

- [ ] **Step 6：toast 加 aria-live**

在第 708–715 行找到 copyToast，加：

```tsx
{copyToast && (
  <div
    role="status"
    aria-live="polite"
    className="fixed bottom-4 right-4 ..."
  >
    已复制到剪贴板
  </div>
)}
```

- [ ] **Step 7：验证**

访问 `/notes/mock-session-001`，测试 Tab 键能聚焦上下页按钮和 pill toggle，复制按钮 tooltip 显示"复制当前页笔记"。

- [ ] **Step 8：提交**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "fix: NotesPage pill toggle aria, nav button aria-labels, send button semantics, toast aria"
```

---

## Task 8：修复 LiveSessionPage — 响应式和核心交互

**目标：** 去掉固定 1519px，输入框改为真实 textarea，Tab 切换绑定逻辑，图标 div 改为 button。

**Files:**
- Modify: `frontend/src/pages/LiveSessionPage.tsx`

- [ ] **Step 1：修复根容器固定宽度**

在第 108 行找到：

```tsx
<div style={{ width: '1519px' }} ...>
```

改为：

```tsx
<div className="w-full min-h-screen flex flex-col">
```

- [ ] **Step 2：修复 Header 固定宽度**

在第 113 行 Header `w-[1519px]` 改为 `w-full`。

- [ ] **Step 3：主内容区高度**

在第 146 行 `h-[1024px]` 改为 `h-[calc(100vh-4rem)]`。右侧面板 `h-[968px]` 改为 `h-full`。

- [ ] **Step 4：PPT Canvas 宽度**

在第 243 行 `w-[896px] max-w-[896px]` 改为 `w-full max-w-4xl mx-auto`。

- [ ] **Step 5：笔记输入框 div 改为 textarea**

在第 425–429 行找到假输入框，替换为：

```tsx
<textarea
  value={noteInput}
  onChange={(e) => setNoteInput(e.target.value)}
  placeholder="Type a note (Alt + N)..."
  aria-label="添加笔记"
  className="w-full h-24 p-3 resize-none bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
/>
```

- [ ] **Step 6：Tab 切换绑定 state**

在第 287–300 行找到 pill toggle，将两个选项绑定 onClick 和动态样式：

```tsx
<button
  type="button"
  role="tab"
  aria-selected={noteMode === 'my'}
  onClick={() => setNoteMode('my')}
  className={`px-3 py-1 text-sm rounded-md transition-all ${noteMode === 'my' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}
>
  My Notes
</button>
<button
  type="button"
  role="tab"
  aria-selected={noteMode === 'ai'}
  onClick={() => setNoteMode('ai')}
  className={`px-3 py-1 text-sm rounded-md transition-all ${noteMode === 'ai' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}
>
  AI Notes
</button>
```

- [ ] **Step 7：End Session 加确认对话框**

在第 83–86 行找到 `handleEndSession`，改为：

```tsx
const handleEndSession = useCallback(() => {
  if (window.confirm('确认结束录音？录音内容将被保存并跳转到笔记页。')) {
    setIsRecording(false);
    navigate(`/notes/${SESSION_ID}`);
  }
}, [navigate]);
```

- [ ] **Step 8：End Session 按钮改为 button**

找到 End Session 区域（第 335–343 行），确认外层是 `<button type="button" onClick={handleEndSession}>` 而非 div。若是 div，改为 button。

- [ ] **Step 9：导航链接改为语义化**

在第 122–129 行，将三个导航 div 改为 `<Link>` 或 `<button>`：

```tsx
<nav aria-label="主导航" className="flex items-center gap-6">
  <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">Dashboard</Link>
  <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">Courses</Link>
  <span aria-current="page" className="text-sm font-medium text-gray-900 border-b-2 border-gray-900">Detailed Note</span>
</nav>
```

- [ ] **Step 10：修复版权年份和 SESSION_ID**

版权年份：`© {new Date().getFullYear()} LIBERSTUDY EDITORIAL`

将模块级 `const SESSION_ID = ...` 移入组件用 `useRef`：

```tsx
const sessionIdRef = useRef(`session-${Date.now()}`);
const SESSION_ID = sessionIdRef.current;
```

- [ ] **Step 11：验证**

访问 `/session/live`，在 1440px 宽度确认无横向滚动，笔记区可以输入文字，Tab 切换能改变选中状态，End Session 弹出确认框。

- [ ] **Step 12：提交**

```bash
git add frontend/src/pages/LiveSessionPage.tsx
git commit -m "fix: LiveSessionPage responsive layout, textarea input, tab toggle logic, nav semantics"
```

---

## Task 9：最终验证

- [ ] **Step 1：全页面 Tab 键导航测试**

依次访问以下页面，按 Tab 键遍历所有可聚焦元素，确认没有焦点"跌入"背景内容：
- `/`（LobbyPage）
- `/upload`（UploadPage → 打开 Modal）
- `/processing`（ProcessingPage）
- `/notes/mock-session-001`（NotesPage）
- `/notes/detail/mock`（DetailedNotePage）
- `/session`（SessionPage）
- `/session/live`（LiveSessionPage）

- [ ] **Step 2：1280px 宽度测试**

在 Chrome DevTools 将视口设为 1280px，逐页确认无横向滚动条（SessionPage、LiveSessionPage、LobbyPage 是重点）。

- [ ] **Step 3：颜色一致性检查**

确认 ProcessingPage 的蓝色进度条（原 indigo）已改为与其他页面一致的暖色调（`bg-primary`）。

- [ ] **Step 4：最终提交**

```bash
git add -A
git commit -m "fix: final UI/UX review pass — responsive, a11y, semantic fixes across all 7 pages"
```

---

## 修复范围总结

| 问题类型 | 修复数量 | 覆盖页面 |
|----------|----------|----------|
| 固定像素宽度 → 响应式 | 3 | LobbyPage, SessionPage, LiveSessionPage |
| `<div onClick>` → `<button>` | 15+ | 全部页面 |
| 缺失 aria-label | 20+ | 全部页面 |
| Modal 无 aria/Escape 关闭 | 3 | LobbyPage, UploadPage, SessionPage |
| catch 块静默降级 | 2 | UploadPage, SessionPage |
| 功能性 bug | 3 | DetailedNotePage 导航, NotesPage 发送按钮, LiveSessionPage 输入框 |
| 颜色对比度/token | 1 | index.css + ProcessingPage |
| 版权年份 | 4+ | SessionPage, LiveSessionPage, LobbyPage, DetailedNotePage |
