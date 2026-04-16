import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSession } from '../lib/api'

interface Bullet { text: string; ai_comment: string; timestamp_start: number; timestamp_end: number }
interface PageData {
  page_num: number
  ppt_text: string
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[] } | null
  page_supplement: { content: string } | null
}
interface SessionData {
  session_id: string
  status: string
  ppt_filename: string
  total_duration: number
  pages: PageData[]
}

// ─── 读取 IndexedDB my_notes ───
const DB_NAME = 'liberstudy_ask'
const MY_NOTES_STORE = 'my_notes'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('ask_history')) db.createObjectStore('ask_history')
      if (!db.objectStoreNames.contains(MY_NOTES_STORE)) db.createObjectStore(MY_NOTES_STORE)
      if (!db.objectStoreNames.contains('page_chat')) db.createObjectStore('page_chat')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadAllMyNotes(sessionId: string, pageNums: number[]): Promise<Map<number, string>> {
  const db = await openDB()
  const result = new Map<number, string>()
  await Promise.all(pageNums.map(pageNum =>
    new Promise<void>((res) => {
      const tx = db.transaction(MY_NOTES_STORE, 'readonly')
      const req = tx.objectStore(MY_NOTES_STORE).get(`${sessionId}:${pageNum}`)
      req.onsuccess = () => { result.set(pageNum, req.result?.text ?? ''); res() }
      req.onerror = () => res()
    })
  ))
  return result
}

// ─── 读取 localStorage text annotations ───
function loadAnnotationsForSession(sessionId: string): Map<number, string[]> {
  const result = new Map<number, string[]>()
  try {
    const all = JSON.parse(localStorage.getItem('liberstudy:text-annotations') ?? '[]') as Array<{
      id: string; sessionId: string; pageNum: number; text: string
    }>
    for (const a of all) {
      if (a.sessionId === sessionId && a.text.trim()) {
        const arr = result.get(a.pageNum) ?? []
        arr.push(a.text)
        result.set(a.pageNum, arr)
      }
    }
  } catch { /* ignore */ }
  return result
}

export default function DetailedNotePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const [pptAnnotations, setPptAnnotations] = useState<Map<number, string[]>>(new Map())

  useEffect(() => {
    if (!sessionId) return
    getSession(sessionId)
      .then(async (data) => {
        const s = data as SessionData
        setSession(s)
        const pageNums = s.pages.map(p => p.page_num)
        const [notes, annotations] = await Promise.all([
          loadAllMyNotes(sessionId, pageNums),
          Promise.resolve(loadAnnotationsForSession(sessionId)),
        ])
        setMyNoteTexts(notes)
        setPptAnnotations(annotations)
        setLoading(false)
      })
      .catch(() => { setError('无法加载笔记数据'); setLoading(false) })
  }, [sessionId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F7F7F2' }}>
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#798C00', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F7F7F2' }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: '#72726E' }}>{error ?? '未知错误'}</p>
          <button onClick={() => navigate('/')} className="text-sm px-4 py-2 rounded-lg cursor-pointer" style={{ background: '#F2F2EC', color: '#292929' }}>
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#F7F7F2', fontFamily: 'Inter, sans-serif', paddingTop: '64px' }}>
      <div className="flex" style={{ minHeight: 'calc(100vh - 64px - 40px)' }}>

        {/* Left sidebar */}
        <aside
          className="flex-shrink-0 flex flex-col"
          style={{
            width: '200px',
            background: '#F2F2EC',
            borderRight: '1px solid #E3E3DA',
            position: 'sticky',
            top: '64px',
            height: 'calc(100vh - 64px)',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center px-4" style={{ height: '48px', borderBottom: '1px solid #E3E3DA' }}>
            <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: '#72726E' }}>
              NAVIGATION
            </span>
          </div>
          <div className="p-3" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150 w-full text-left hover:bg-black/5"
              style={{ color: '#72726E' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回
            </button>
            {(noteMode === 'my'
              ? session.pages.filter(p => (myNoteTexts.get(p.page_num) ?? '').trim() || (pptAnnotations.get(p.page_num) ?? []).length > 0)
              : session.pages
            ).map((page) => (
              <button
                key={page.page_num}
                onClick={() => document.getElementById(`page-${page.page_num}`)?.scrollIntoView({ behavior: 'smooth' })}
                className="px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150 w-full text-left hover:bg-black/5"
                style={{ color: '#72726E', lineHeight: '1.4' }}
              >
                第 {page.page_num} 页
              </button>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto px-16 py-12" style={{ maxWidth: '800px' }}>

            {/* Pill toggle */}
            <div className="flex items-center justify-between mb-8">
              <div className="inline-flex rounded-full p-0.5" style={{ background: 'rgba(227,227,218,0.4)' }}>
                {(['my', 'ai'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setNoteMode(mode)}
                    className="px-4 py-1 rounded-full text-sm cursor-pointer transition-all duration-150"
                    style={{
                      background: noteMode === mode ? '#FFFFFF' : 'transparent',
                      color: noteMode === mode ? '#292929' : '#72726E',
                      fontWeight: noteMode === mode ? '500' : '400',
                      boxShadow: noteMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    {mode === 'my' ? 'My Notes' : 'AI Notes'}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <h1
              className="mb-2"
              style={{ fontSize: '36px', fontWeight: '700', color: '#292929', lineHeight: '1.2', letterSpacing: '-0.02em' }}
            >
              {session.ppt_filename}
            </h1>
            <p className="mb-10" style={{ fontSize: '12px', color: '#D0CFC5' }}>
              Session {session.session_id} · {session.pages.length} 页 · {Math.floor(session.total_duration / 60)} 分钟
            </p>

            {/* Content */}
            {noteMode === 'my' ? (() => {
              const pagesWithContent = session.pages.filter(p =>
                (myNoteTexts.get(p.page_num) ?? '').trim() ||
                (pptAnnotations.get(p.page_num) ?? []).length > 0
              )
              if (pagesWithContent.length === 0) {
                return (
                  <div className="py-8 text-center" style={{ color: '#D0CFC5', fontSize: '14px' }}>
                    该课程暂无用户笔记
                  </div>
                )
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  {pagesWithContent.map(page => {
                    const myText = myNoteTexts.get(page.page_num) ?? ''
                    const annotations = pptAnnotations.get(page.page_num) ?? []
                    return (
                      <div key={page.page_num} id={`page-${page.page_num}`}>
                        <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#72726E', marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid #E3E3DA' }}>
                          第 {page.page_num} 页
                        </h3>
                        {myText.trim() && (
                          <p style={{ fontSize: '15px', color: '#292929', lineHeight: '1.8', marginBottom: annotations.length > 0 ? '12px' : '0', whiteSpace: 'pre-wrap' }}>
                            {myText}
                          </p>
                        )}
                        {annotations.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', color: '#D0CFC5' }}>PPT 批注</span>
                            {annotations.map((text, i) => (
                              <p key={i} style={{
                                fontSize: '14px', color: '#292929', lineHeight: '1.7', margin: 0,
                                padding: '8px 12px', borderRadius: '6px', background: '#F2F2EC', border: '1px solid #E3E3DA', whiteSpace: 'pre-wrap',
                              }}>
                                {text}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })() : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                {session.pages.map((page) => (
                  <div key={page.page_num} id={`page-${page.page_num}`}>
                    {/* Page heading */}
                    <h3
                      style={{
                        fontSize: '18px',
                        fontWeight: '700',
                        color: '#292929',
                        marginBottom: '12px',
                        paddingBottom: '8px',
                        borderBottom: '1px solid #E3E3DA',
                      }}
                    >
                      第 {page.page_num} 页
                      {page.ppt_text && (
                        <span style={{ fontSize: '13px', fontWeight: '400', color: '#72726E', marginLeft: '12px' }}>
                          {page.ppt_text.split('\n')[0]?.slice(0, 60)}
                        </span>
                      )}
                    </h3>

                    {/* Active notes (user annotation + AI expansion) */}
                    {page.active_notes && (
                      <div
                        className="rounded-lg p-4 mb-4"
                        style={{ background: '#F2F2EC', border: '1px solid #E3E3DA' }}
                      >
                        <p style={{ fontSize: '14px', color: '#292929', fontWeight: '500', lineHeight: '1.7', marginBottom: '8px' }}>
                          {page.active_notes.user_note}
                        </p>
                        <div style={{ borderLeft: '2px solid #E3E3DA', paddingLeft: '12px' }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                            <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E' }}>
                              AI CLARIFICATION
                            </span>
                          </div>
                          <p style={{ fontSize: '14px', color: '#292929', lineHeight: '1.7' }}>
                            {page.active_notes.ai_expansion}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Passive notes bullets */}
                    {page.passive_notes?.bullets && page.passive_notes.bullets.length > 0 && (
                      <ul style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingLeft: '4px' }}>
                        {page.passive_notes.bullets.map((bullet, j) => (
                          <li key={j} className="flex items-start gap-3">
                            <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: '#72726E' }} />
                            <div>
                              <span style={{ fontSize: '15px', color: '#292929', lineHeight: '1.7' }}>
                                {bullet.text}
                              </span>
                              {bullet.ai_comment && (
                                <p style={{ fontSize: '13px', color: '#72726E', lineHeight: '1.6', marginTop: '4px' }}>
                                  {bullet.ai_comment}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Page supplement */}
                    {page.page_supplement && (
                      <div
                        className="rounded-lg p-4 mt-4"
                        style={{ background: '#F2F2EC', border: '1px solid #E3E3DA', borderLeft: '3px solid #D0CFC5' }}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E' }}>
                            OFF-SLIDE CONTENT
                          </span>
                        </div>
                        <p style={{ fontSize: '14px', color: '#292929', lineHeight: '1.7' }}>
                          {page.page_supplement.content}
                        </p>
                      </div>
                    )}

                    {/* Empty state */}
                    {!page.active_notes && (!page.passive_notes?.bullets || page.passive_notes.bullets.length === 0) && !page.page_supplement && (
                      <p style={{ fontSize: '13px', color: '#D0CFC5', fontStyle: 'italic' }}>暂无笔记数据</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ height: '80px' }} />
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer
        className="flex items-center justify-center"
        style={{ height: '40px', background: '#F2F2EC', borderTop: '1px solid #E3E3DA', color: '#D0CFC5', fontSize: '11px' }}
      >
        LiberStudy · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
