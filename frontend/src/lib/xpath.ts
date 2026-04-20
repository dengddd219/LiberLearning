/** 从 root 到 node 生成 XPath 字符串（仅处理文本节点和元素节点） */
export function getXPath(node: Node, root: Node): string {
  const parts: string[] = []
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.TEXT_NODE) {
      // 找出是父元素的第几个文本节点（1-based）
      const parent: Node = current.parentNode!
      let idx = 0
      for (const child of Array.from(parent.childNodes) as Node[]) {
        if (child.nodeType === Node.TEXT_NODE) idx++
        if (child === current) break
      }
      parts.unshift(`text()[${idx}]`)
      current = parent
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element
      const tag = el.tagName.toLowerCase()
      // 找出是同名兄弟中的第几个（1-based）
      let idx = 1
      let sibling = el.previousElementSibling
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) idx++
        sibling = sibling.previousElementSibling
      }
      parts.unshift(`${tag}[${idx}]`)
      current = el.parentNode
    } else {
      break
    }
  }
  return parts.join('/')
}

/** 根据 XPath 从 root 查找节点 */
export function resolveXPath(xpath: string, root: Node): Node | null {
  const parts = xpath.split('/')
  let current: Node | null = root
  for (const part of parts) {
    if (!current) return null
    const textMatch = part.match(/^text\(\)\[(\d+)\]$/)
    const elemMatch = part.match(/^([a-z]+)\[(\d+)\]$/)
    if (textMatch) {
      const idx = parseInt(textMatch[1])
      let count = 0
      let found: Node | null = null
      for (const child of Array.from(current.childNodes) as Node[]) {
        if (child.nodeType === Node.TEXT_NODE) {
          count++
          if (count === idx) { found = child; break }
        }
      }
      current = found
    } else if (elemMatch) {
      const [, tag, idxStr] = elemMatch
      const idx = parseInt(idxStr)
      let count = 0
      let found: Node | null = null
      for (const child of Array.from(current.childNodes) as Node[]) {
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === tag) {
          count++
          if (count === idx) { found = child; break }
        }
      }
      current = found
    }
  }
  return current
}
