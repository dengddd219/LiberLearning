import { type SearchResult } from '../hooks/useSearch'

interface SearchDropdownProps {
  noteResults: SearchResult[]
  pdfResults: SearchResult[]
  query: string
  onJumpToPage: (pageNum: number) => void
}

function highlightMatch(text: string, query: string) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#FAFF00', borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function SearchDropdown({
  noteResults,
  pdfResults,
  query,
  onJumpToPage,
}: SearchDropdownProps) {
  const isEmpty = noteResults.length === 0 && pdfResults.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        width: '360px',
        background: '#FAFAF8',
        border: '1px solid rgba(175,179,176,0.3)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 60,
        overflow: 'hidden',
        fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        maxHeight: '480px',
        overflowY: 'auto',
      }}
    >
      {isEmpty && (
        <div style={{ padding: '16px', fontSize: '13px', color: '#9B9A94', textAlign: 'center' }}>
          没有找到"{query}"
        </div>
      )}

      {/* PDF 侧结果 */}
      {pdfResults.length > 0 && (
        <section>
          <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 600, color: '#9B9A94', letterSpacing: '0.08em' }}>
            幻灯片文本 {pdfResults.length} 条
          </div>
          {pdfResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToPage(r.pageNum)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderTop: '1px solid rgba(175,179,176,0.15)',
              }}
              className="hover:bg-black/5"
            >
              <div style={{ fontSize: '11px', color: '#9B9A94', marginBottom: '2px' }}>
                第 {r.pageNum} 页 · 幻灯片
              </div>
              <div style={{ fontSize: '13px', color: '#1A1916', lineHeight: 1.5 }}>
                {highlightMatch(r.snippet, query)}
              </div>
            </button>
          ))}
        </section>
      )}

      {/* 笔记侧结果 */}
      {noteResults.length > 0 && (
        <section style={{ borderTop: pdfResults.length > 0 ? '1px solid rgba(175,179,176,0.3)' : undefined }}>
          <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 600, color: '#9B9A94', letterSpacing: '0.08em' }}>
            笔记 {noteResults.length} 条
          </div>
          {noteResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToPage(r.pageNum)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderTop: '1px solid rgba(175,179,176,0.15)',
              }}
              className="hover:bg-black/5"
            >
              <div style={{ fontSize: '11px', color: '#9B9A94', marginBottom: '2px' }}>
                第 {r.pageNum} 页 · {r.field === 'ai_comment' ? 'AI 注释' : '笔记要点'}
              </div>
              <div style={{ fontSize: '13px', color: '#1A1916', lineHeight: 1.5 }}>
                {highlightMatch(r.snippet, query)}
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
