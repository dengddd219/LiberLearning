# Wrong Log — Claude 踩坑记录

记录每次消耗大量 token 才解决的技术问题，供 `/wrong` 命令总结用。

---

## 2026-04-07 | 文件编码 × Edit 工具

**问题**：修改 `LiberStudy-PRD.md` 中的中文内容，Edit 工具反复报 "String to replace not found"。

**根因**：文件是 UTF-8 编码，但 Windows 环境下 Read 工具返回的内容在工具内部传递时出现字节解码问题，导致 `old_string` 与文件实际字节不匹配。绕了一大圈试 GBK/GB18030/UTF-16 均失败，最终用 `python3` 以 `encoding='utf-8'` 直接读写才成功。

**启发**：在 Windows 上，当 Edit 工具对含中文的文件报"字符串未找到"时，不要反复重试——直接用 `python3` 脚本以明确编码读写文件，比猜测编码省 80% token。

---
