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
