import { useMemo } from 'react'

export interface SearchResult {
  pageNum: number
  type: 'note' | 'pdf'
  snippet: string
  field: string
}

interface PageData {
  page_num: number
  ppt_text: string
  passive_notes: { bullets: { ppt_text: string; ai_comment: string | null }[] } | null
}

function extractSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 60)
  const start = Math.max(0, idx - 20)
  const end = Math.min(text.length, idx + query.length + 40)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function useSearch(query: string, pages: PageData[]) {
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()

    const out: SearchResult[] = []

    pages.forEach((page) => {
      // 搜笔记：ppt_text（来自 ppt_text 字段）
      if (page.ppt_text?.toLowerCase().includes(q)) {
        out.push({
          pageNum: page.page_num,
          type: 'pdf',
          snippet: extractSnippet(page.ppt_text, query),
          field: 'ppt_text',
        })
      }

      // 搜笔记：bullet ppt_text + ai_comment
      page.passive_notes?.bullets.forEach((b) => {
        if (b.ppt_text?.toLowerCase().includes(q)) {
          out.push({
            pageNum: page.page_num,
            type: 'note',
            snippet: extractSnippet(b.ppt_text, query),
            field: 'ppt_text',
          })
        }
        if (b.ai_comment?.toLowerCase().includes(q)) {
          out.push({
            pageNum: page.page_num,
            type: 'note',
            snippet: extractSnippet(b.ai_comment!, query),
            field: 'ai_comment',
          })
        }
      })
    })

    // 去重（同一页同一 type 只保留第一个）
    const seen = new Set<string>()
    return out.filter((r) => {
      const key = `${r.pageNum}:${r.type}:${r.field}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [query, pages])

  const noteResults = useMemo(() => results.filter((r) => r.type === 'note'), [results])
  const pdfResults = useMemo(() => results.filter((r) => r.type === 'pdf'), [results])

  return { noteResults, pdfResults, hasResults: results.length > 0 }
}
