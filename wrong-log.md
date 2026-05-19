# Wrong Log — Claude 踩坑记录

记录每次消耗大量 token 才解决的技术问题，供 `/wrong` 命令总结用。

---

## 2026-05-17 | TanStack Start 子路径部署全流程踩坑

**背景**：将会议助手 Demo 部署到 `https://liberstudy.xyz/meeting`，Nginx 反代到本机 8002 端口，Node.js SSR。

### 坑 1：router.tsx 缺少 basepath 导致路由全 404

**问题**：部署后访问 `/meeting/lobby` 返回 404，所有子路由均不可达。

**根因**：`createRouter()` 没有配置 `basepath: "/meeting"`，TanStack Router 默认以 `/` 为根，Nginx 把 `/meeting/` 前缀剥离后传给 Node，但 SSR 渲染时路由树匹配不到任何路径。

**修复**：在 `src/router.tsx` 的 `createRouter()` 中加 `basepath: "/meeting"`。

**启发**：子路径部署时，`basepath` 是第一个要配的东西，不是最后。先配好再构建，否则所有路由调试都是无效功。

---

### 坑 2：vite.config.ts 缺少 ROUTER_BASEPATH define 导致客户端路由失效

**问题**：SSR 首屏能渲染，但客户端 hydration 后点击链接跳转失效，或刷新后 404。

**根因**：TanStack Start 在客户端 bundle 里通过 `ROUTER_BASEPATH` 全局变量读取 basepath。如果 `vite.config.ts` 没有 `define: { ROUTER_BASEPATH: JSON.stringify("/meeting") }`，客户端 bundle 里这个变量是 `undefined`，客户端路由和 SSR 路由行为不一致。

**修复**：在 `vite.config.ts` 加 `define: { ROUTER_BASEPATH: JSON.stringify("/meeting") }`。

**启发**：TanStack Start 的 basepath 需要在**两个地方**同时配置：`router.tsx`（运行时）+ `vite.config.ts` define（构建时注入客户端 bundle）。漏一个就会出现 SSR/CSR 行为不一致的诡异问题。

---

### 坑 3：server.mjs 静态资源路径双重前缀

**问题**：页面加载后 JS/CSS 资源 404，浏览器请求的是 `/meeting/assets/xxx.js`，但 server.mjs 只处理 `/assets/` 前缀。

**根因**：Nginx `proxy_pass http://127.0.0.1:8002/` 末尾有斜杠，会把 `/meeting/` 前缀剥离后转发。但 TanStack Start 生成的 HTML 里静态资源引用是 `/meeting/assets/xxx.js`（带 basepath），Node 收到的请求路径就是 `/meeting/assets/xxx.js`，原始 server.mjs 只匹配 `/assets/` 开头，导致资源全部 404。

**修复**：在 server.mjs 静态文件处理逻辑里增加对 `/meeting/assets/` 的处理，将其 slice 掉 `/meeting` 前缀后再去 `dist/client` 目录查找文件：
```js
if (pathname.startsWith("/assets/")) {
  staticPath = pathname;
} else if (pathname.startsWith("/meeting/assets/")) {
  staticPath = pathname.slice("/meeting".length);
}
```

**启发**：Nginx 子路径反代时，`proxy_pass` 末尾斜杠决定前缀是否被剥离。有斜杠 = 剥离，无斜杠 = 保留。要在 server.mjs 里明确处理两种可能的路径形式，或者统一约定好 Nginx 是否剥离前缀。

---

### 坑 4：Nginx proxy_pass 末尾斜杠语义

**问题**：Nginx 配置 `location /meeting/` 时，`proxy_pass` 末尾有无斜杠行为完全不同，容易搞混。

**规则**：
- `proxy_pass http://127.0.0.1:8002/`（有斜杠）：`/meeting/lobby` → Node 收到 `/lobby`（前缀被剥离）
- `proxy_pass http://127.0.0.1:8002`（无斜杠）：`/meeting/lobby` → Node 收到 `/meeting/lobby`（前缀保留）

**本项目选择**：有斜杠（剥离前缀），Node 收到不带 `/meeting` 的路径，由 TanStack Router basepath 在框架层处理子路径语义。

**启发**：部署前先在纸上画清楚"Nginx 传给 Node 的 URL 是什么"，再决定 server.mjs 和 router basepath 怎么配。这个决策一旦定了，三处配置（Nginx、server.mjs、router）必须保持一致。

---

### 坑 5：systemd ExecStart Node 路径问题

**问题**：systemd 服务启动失败，`node: command not found`。

**根因**：Node.js 通过 nvm 安装时，可执行文件在 `/root/.nvm/versions/node/vXX.X.X/bin/node`，不在 `/usr/bin/node`。systemd 服务不加载用户 shell 的 PATH，所以找不到 `node`。

**修复**：`ExecStart` 改用绝对路径，或先 `which node` 确认路径再填入 service 文件。

**启发**：写 systemd service 时，所有命令都用绝对路径。`which node`、`which bun` 先查清楚再写，不要依赖 PATH。

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
