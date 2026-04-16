# Wrong Log — Claude 踩坑记录

记录每次消耗大量 token 才解决的技术问题，供 `/wrong` 命令总结用。

---

## 2026-04-07 | 文件编码 × Edit 工具

**问题**：修改 `LiberStudy-PRD.md` 中的中文内容，Edit 工具反复报 "String to replace not found"。

**根因**：文件是 UTF-8 编码，但 Windows 环境下 Read 工具返回的内容在工具内部传递时出现字节解码问题，导致 `old_string` 与文件实际字节不匹配。绕了一大圈试 GBK/GB18030/UTF-16 均失败，最终用 `python3` 以 `encoding='utf-8'` 直接读写才成功。

**启发**：在 Windows 上，当 Edit 工具对含中文的文件报"字符串未找到"时，不要反复重试——直接用 `python3` 脚本以明确编码读写文件，比猜测编码省 80% token。

---

## 2026-04-10 | 单文件 Streamlit 测试平台过度膨胀

**问题**：`test_app.py` 随功能迭代累积到 1000+ 行，新增 UI（Judge、语义分组）无处安放，阅读和定位功能极慢，debug 也困难。

**根因**：每次迭代都往同一文件追加代码，没有及时拆分。Streamlit 应用容易陷入"全局脚本"陷阱，因为它本来就是从上到下执行的。

**启发**：当测试平台 UI 超过 300 行时就要拆包。拆法：每个 tab/功能块对应一个 `test_ui/xxx.py` 模块，主入口只做 sidebar + tab 路由（目标 &lt; 80 行）。新功能先建模块，不往主文件追加。

---

## 2026-04-16 | React wheel 事件在 loading 后 DOM 延迟挂载导致监听失效

**问题**：NotesPage 的 PPT 画布区域无法通过滚轮 / 触摸板翻页，但又不能引发整页滚动。多次修复均无效。

**尝试过的无效修复**：
1. 给 `canvasAreaRef` 容器加 `overflowY: 'hidden'` + `touchAction: 'none'`
2. 在 `canvasAreaRef` 上用 `{ passive: false }` 注册原生 wheel 监听
3. 将监听改为捕获阶段 `{ passive: false, capture: true }`

**根因**：`useEffect(() => { el.addEventListener... }, [])` 的空依赖让它只在组件挂载后运行一次。但组件挂载时处于 `loading` 状态，直接 `return` 了 loading UI，canvas 区域的 DOM **根本不存在**，`canvasAreaRef.current === null`，`if (!el) return` 直接退出，事件**永远没注册上**。之后 loading 完成、canvas 出现，effect 不再重跑。

**正确修复**：改为在 `window` 上注册捕获阶段监听（`window.addEventListener('wheel', handler, { passive: false, capture: true })`），在 handler 内部动态读取 `canvasAreaRef.current` 并用 `el.contains(e.target)` 判断事件是否发生在画布区域内，不在则跳过。

**启发**：`useEffect(fn, [])` 注册 DOM 事件时，若目标 DOM 在 loading/条件渲染中延迟出现，ref 在 effect 运行时为 `null`，监听永远不生效。遇到"事件监听不工作"时，**首先检查 effect 运行时目标 DOM 是否已存在**，而不是反复调整 `passive` / `capture` 参数。

---
