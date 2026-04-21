# LobbyPage 多选批量删除 — 设计规格

**日期**: 2026-04-21  
**范围**: `frontend/src/pages/LobbyPage.tsx` 仅此一个文件

---

## 1. 需求摘要

在笔记卡片的三点菜单中添加"选择多个"入口，进入多选模式后支持勾选多张卡片，通过底部浮动操作条批量删除。

---

## 2. 交互流程

```
点三点菜单 → 「选择多个」
    ↓
进入 selectionMode（触发卡片自动预选中）
    ↓
卡片/行左上角显示勾选框，其他卡片可继续点选
    ↓
底部浮动操作条：「已选 N 个」 + 「取消」 + 「删除 N 个」
    ↓
点「删除 N 个」→ window.confirm → 批量调 deleteSession API → 退出 selectionMode
点「取消」→ 退出 selectionMode，清空选中
```

---

## 3. 状态设计

在 `LobbyPage` 组件中新增两个状态：

```ts
const [selectionMode, setSelectionMode] = useState(false)
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
```

**进入多选模式**：
```ts
function enterSelection(initialId: string) {
  setSelectionMode(true)
  setSelectedIds(new Set([initialId]))
}
```

**退出多选模式**：
```ts
function exitSelection() {
  setSelectionMode(false)
  setSelectedIds(new Set())
}
```

**切换单个选中态**：
```ts
function toggleSelect(id: string) {
  setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}
```

---

## 4. ContextMenu 变化

`DoneCard` 和 `ListRow` 的 ContextMenu actions 最前面新增一项：

```ts
{ label: '选择多个', color: '#292929', action: () => onEnterSelection(card.id) }
```

两个组件的 props 各新增：
- `selectionMode: boolean`
- `isSelected: boolean`
- `onToggleSelect: () => void`
- `onEnterSelection: () => void`

`selectionMode=true` 时，卡片点击整体变为切换选中，不再导航。

---

## 5. DoneCard 变化（网格视图）

`selectionMode=true` 时：
- 卡片左上角（`position: absolute, top: 12px, left: 12px, zIndex: 10`）显示 16×16 圆形勾选框
- 选中：背景 `#798C00`，白色对勾 SVG
- 未选中：白色背景，`1px solid #D0CFC5` 边框
- 整张卡片的 `onClick` 改为 `onToggleSelect`（不再 navigate）
- 三点菜单在 selectionMode 下仍然显示（用于追加选择更多，或退出选择）

**视觉细节**：
- 选中卡片加 `outline: 2px solid #798C00`，圆角保持 `32px`
- hover 效果保持不变

---

## 6. ListRow 变化（列表视图）

`selectionMode=true` 时：
- 缩略图区域左侧（`w-40 px-6 py-7` 区域内）替换为勾选框+缩略图组合，或在缩略图前插入勾选框列
- 整行点击改为 `onToggleSelect`
- 选中行背景：`rgba(121,140,0,0.05)`

---

## 7. 底部浮动操作条（BulkActionBar）

**条件渲染**：`selectionMode && selectedIds.size > 0`

**位置**：Main Area（`flex-1 min-w-0 overflow-y-auto`）的 `position: sticky; bottom: 0`，宽度跟随 Main Area。

**布局**：
```
[已选 N 个]   ----flex-1 空白----   [取消]  [删除 N 个]
```

**样式**：
- 背景：`rgba(255,255,255,0.92)` + `backdrop-filter: blur(12px)`
- 顶部：`1px solid #E3E3DA`
- padding：`16px 48px`（与主内容 px-12 对齐）
- 「取消」：ghost 按钮，`border: 1px solid #E3E3DA`，圆角 pill
- 「删除 N 个」：红色实心按钮，`background: #D94F3D`，圆角 pill

**删除逻辑**：
```ts
async function handleBulkDelete() {
  const count = selectedIds.size
  if (!window.confirm(`确认删除这 ${count} 条记录？`)) return
  await Promise.allSettled([...selectedIds].map(id => deleteSession(id)))
  setSessions(prev => prev.filter(s => !selectedIds.has(s.id)))
  setSessionFolderMap(prev => {
    const next = { ...prev }
    selectedIds.forEach(id => delete next[id])
    return next
  })
  exitSelection()
}
```

`Promise.allSettled` 保证部分失败不阻断，全部尝试完毕后统一退出选择模式。

---

## 8. GridView / ListTable 传参变化

`GridView` 和 `ListTable` 需要接收：
- `selectionMode: boolean`
- `selectedIds: Set<string>`
- `onToggleSelect: (id: string) => void`
- `onEnterSelection: (id: string) => void`

这两个组件将这些 props 透传给 `DoneCard` / `ListRow`。

---

## 9. 不变范围

- 侧边栏 `SidebarFolderTree`：不变
- `ProcessingCard`：不变（processing 状态的卡片不参与多选）
- 排序、文件夹筛选逻辑：不变
- `ListTable` header 行：不变
- `SettingsPanel`：不变
- 单条删除 `handleDelete`：不变

---

## 10. 文件影响

| 文件 | 改动类型 |
|------|----------|
| `frontend/src/pages/LobbyPage.tsx` | 唯一修改文件；新增 state、BulkActionBar 组件、修改 DoneCard/ListRow/GridView/ListTable props |

---

## 11. 验收标准

1. 点 DoneCard 三点菜单 →「选择多个」→ 进入多选模式，当前卡片预选中
2. 点其他卡片切换选中态，勾选框视觉正确
3. 底部操作条实时显示选中数量
4. 「取消」退出多选，卡片恢复正常点击行为（navigate）
5. 「删除 N 个」→ confirm → 批量删除 → 卡片从列表消失 → 操作条消失
6. 列表视图（ListRow）同样支持以上所有行为
7. Processing 状态的卡片不出现勾选框
