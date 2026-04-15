# NotesPage PPT 展示模式改版设计

**日期**：2026-04-15
**状态**：已确认
**涉及文件**：前端 `frontend/src/pages/NotesPage.tsx`（仅 2 个文件）

---

## 1. 问题背景

当前 NotesPage 中间 PPT 展示区域采用**垂直滚动多页**模式（所有页面渲染成列表，靠 IntersectionObserver 追踪哪页可见比例最大）。此模式存在两个问题：

1. **对齐歧义**：当两张 PPT 各显示 50% 时，IntersectionObserver 的 `mostVisible` 判断会产生跳动，导致右侧 Transcript / 笔记与"用户实际在看的那一页"不一致。
2. **体验割裂**：滚动阅读与"课中实时翻 PPT"的认知模型不匹配。

---

## 2. 改动目标

将中间 PPT 展示区域改为**单页放映模式**，每次只渲染一张 PPT，currentPage 精确控制，右侧 Transcript / 笔记稳定对齐到当前页。

---

## 3. 改动范围

| 模块 | 改动？ | 说明 |
|------|--------|------|
| 左侧缩略图导航 | 是（交互） | 默认收起，hover 展开，不撑开右侧宽度 |
| 中间 PPT 画布 | **是（核心）** | 多页滚动 → 单页展示 |
| Toolbar（翻页按钮/页码） | 否 | 逻辑完全不变 |
| 右侧笔记面板（My/AI/Transcript 三 Tab） | 是（数据过滤） | 改为 currentPage 精确过滤 |
| 音频播放器 | 否 | 保持不变 |
| 导出/复制功能 | 否 | 保持不变 |
| PassiveNotes 组件 | 否 | 数据结构不变，只需上层传对 currentPage 对应的数据 |
| TopBar / SessionPage 等其他页面 | 否 | 完全不动 |

涉及文件：
- `frontend/src/pages/NotesPage.tsx` — 核心改动
- `frontend/src/components/PassiveNotes.tsx` — 无需改动

---

## 4. 设计详情

### 4.1 中间 PPT 画布：单页展示

**改动前**（L566-620）：
```tsx
// 渲染所有页，vertical scroll
<div className="flex flex-col items-center gap-8">
  {session.pages.map((page) => (
    <div key={page.page_num} data-page={page.page_num} ref={...}>
      <Document file={...}><Page pageNumber={page.pdf_page_num} /></Document>
    </div>
  ))}
</div>
// IntersectionObserver 追踪 most visible
```

**改动后**：
```tsx
// 只渲染一页，overflow:hidden
const currentPageData = session.pages.find(p => p.page_num === currentPage)

<div
  ref={canvasAreaRef}
  className="flex-1 overflow-hidden"
  onWheel={handleWheel}
>
  <div className="w-full h-full flex items-center justify-center p-8">
    {currentPageData && (
      <Document file={pdfUrl} loading={...}>
        <Page
          pageNumber={currentPageData.pdf_page_num}
          width={canvasWidth}
        />
      </Document>
    )}
  </div>
</div>
```

关键点：
- `overflow: hidden` 彻底禁止画布区域垂直滚动
- 单个 `<Page>` 渲染，宽高自适应居中
- wheel 事件阻止默认行为（`preventDefault`）

### 4.2 翻页交互

**三种翻页方式并存：**

| 方式 | 实现 |
|------|------|
| 滚轮 | 监听 canvas 的 `wheel` 事件，deltaY > 0 → 下一页，deltaY < 0 → 上一页；300ms 防抖合并连续快速滚动 |
| 键盘 | `ArrowUp` / `ArrowDown`（或 `PageUp` / `PageDown`），事件监听加在 canvas 容器上 |
| Toolbar 按钮 | 现有的 `<` `>` 按钮，逻辑不变 |

```tsx
// wheel 防抖参考实现
const wheelTimeoutRef = useRef<number | null>(null)
const lastDeltaRef = useRef<number>(0)

const handleWheel = useCallback((e: WheelEvent) => {
  e.preventDefault()
  if (wheelTimeoutRef.current) return
  const direction = e.deltaY > 0 ? 1 : -1
  if (direction === 1 && currentPage < totalPages) setCurrentPage(p => p + 1)
  else if (direction === -1 && currentPage > 1) setCurrentPage(p => p - 1)
  wheelTimeoutRef.current = window.setTimeout(() => {
    wheelTimeoutRef.current = null
  }, 300)
}, [currentPage, totalPages])
```

### 4.3 左侧导航：默认收起 + hover 展开

**布局结构**：
```
┌─────────────────────────────────────────────────────────┐
│ Left Hover Zone (8px) │ PPT Canvas │ Notes Panel        │
│ [Absolute Nav 200px]  │ (flex:1)   │ (320px resizable)  │
└─────────────────────────────────────────────────────────┘
```

**实现**：
```tsx
const [navVisible, setNavVisible] = useState(false)

<div
  className="relative flex-shrink-0"
  onMouseEnter={() => setNavVisible(true)}
  onMouseLeave={() => setNavVisible(false)}
>
  {/* 触发条：8px 宽，始终可见 */}
  <div className="w-2 bg-[#3D3B35] rounded-l-lg" />

  {/* 导航面板：position:absolute 叠加，不撑开右侧 */}
  <aside
    style={{
      position: 'absolute',
      top: 0, left: 0, bottom: 0,
      width: navVisible ? '200px' : '0px',
      opacity: navVisible ? 1 : 0,
      transition: 'width 200ms ease, opacity 200ms ease',
      overflow: 'hidden',
      zIndex: 15,
    }}
    className="bg-[#E8E7E2] rounded-l-lg"
  >
    {/* 缩略图列表（复用现有代码） */}
    {session.pages.map((page) => (
      <button
        key={page.page_num}
        onClick={() => {
          setCurrentPage(page.page_num)
          setNavVisible(false)
        }}
        aria-current={page.page_num === currentPage ? 'true' : undefined}
        className={cn(
          'w-full rounded-md overflow-hidden mb-3 transition-all',
          page.page_num === currentPage
            ? 'ring-2 ring-[#3D3B35] opacity-100'
            : 'opacity-70 hover:opacity-100'
        )}
      >
        <img src={thumbnailUrl} alt={`Page ${page.page_num}`} loading="lazy" />
      </button>
    ))}
  </aside>
</div>
```

关键点：
- `position: absolute` 让导航叠加在画布左侧，**不改变**中间 + 右侧两栏宽度
- 200ms ease 过渡动画（width + opacity）
- 点击缩略图：跳页 + 收回导航
- Toolbar 中已有的"展开侧边栏"按钮保留，作为 hover 的互补手段

### 4.4 右侧笔记面板：currentPage 精确过滤

三个 Tab（My Notes / AI Notes / Transcript）的数据源均通过 `currentPage` 精确过滤：

- **My Notes**：取 `session.pages[currentPage].active_notes`
- **AI Notes**：取 `session.pages[currentPage].passive_notes`（含 Bullet 列表 + pageSupplement）
- **Transcript**：取 `session.pages[currentPage].aligned_segments`（当前页的 ASR 段落）

所有 Tab 均只显示当前页数据，不再出现跨页歧义。

### 4.5 IntersectionObserver 移除

原有的 IntersectionObserver 追踪逻辑（L289-307）**整体删除**：
- `pageRefs` Map 不再需要
- `scrollToPage` state 不再需要（或降级为无用的保留字段，但建议直接删除相关代码）

### 4.6 PDF 预加载（可选优化）

翻页时预先加载相邻页，减少闪白：
```tsx
// currentPage 变化时预加载 ±1 页
useEffect(() => {
  [-1, 0, 1].forEach(offset => {
    const target = currentPage + offset
    if (target >= 1 && target <= totalPages) {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'fetch'
      link.href = getPagePdfUrl(target)
      document.head.appendChild(link)
    }
  })
}, [currentPage])
```

此为可选优化，不影响核心功能。

---

## 5. UI 风格

**完全沿用现有配置，不引入任何新的设计系统：**
- 颜色常量：`C` 对象（NotesPage.tsx L45-54）
- 字体：`FONT_SERIF`（L44）
- 间距/圆角/阴影：复用现有值
- Tailwind 工具类：复用现有模式

---

## 6. 实现自检

- [x] 只改动 NotesPage.tsx + PassiveNotes.tsx（不变）
- [x] 不引入新依赖
- [x] 保持 UI 风格一致
- [x] 三种翻页方式并存
- [x] hover nav 不撑开右侧宽度
- [x] 右侧三 Tab 均 currentPage 精确过滤
- [x] IntersectionObserver 代码删除

---

## 7. 待用户确认后实施

（实施前需再次确认此规格）
