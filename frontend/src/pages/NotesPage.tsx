import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import CanvasToolbar from '../components/CanvasToolbar'
import { getSession, retryPage, generateMyNote, askBullet } from '../lib/api'
import { useHighlights } from '../hooks/useHighlights'
import HighlightLayer from '../components/HighlightLayer'
import { useTextAnnotations } from '../hooks/useTextAnnotations'
import TextAnnotationLayer from '../components/TextAnnotationLayer'
import NewClassModal from '../components/NewClassModal'
import type { PptPage } from '../types/session'
import { useSessionEvents } from '../hooks/useSessionEvents'
import type { SSEEvent } from '../hooks/useSessionEvents'
import type { PageChatMessage, Bullet, AlignedSegment, PageData, SessionData } from '../lib/notesTypes'
import { C, FONT_SERIF, formatTime, injectNoteStyles, renderMd, stripBullet, withApiBase } from '../lib/notesUtils'
import { loadMyNote, loadPageChat, saveMyNote, savePageChat } from '../lib/notesDb'
import RevealText from '../components/notes/RevealText'
import LineByLineReveal from '../components/notes/LineByLineReveal'
import StreamingExpandText from '../components/notes/StreamingExpandText'
import InlineQA from '../components/notes/InlineQA'

// ─── IndexedDB：持久化（ask_history / my_notes / page_chat） ───
type NotesPerfRecord = {
  sessionId: string
  durationMs: number
  source: 'primary' | 'fallback' | 'failed'
  slide: number
  timestamp: string
}

function pushNotesPerf(record: NotesPerfRecord) {
  const w = window as Window & { __liberstudyNotesPerf?: NotesPerfRecord[] }
  w.__liberstudyNotesPerf = w.__liberstudyNotesPerf ?? []
  w.__liberstudyNotesPerf.push(record)
}

// ─── AiBulletRow：点击展开时 ppt_text 向上抹去，然后 ppt_text + AI 解释全部逐项彩虹揭开 ───
function AiBulletRow({
  bullet,
  expanded,
  animationDone,
  onToggle,
  onAnimationDone,
  onTimestampClick,
  translationEnabled,
  translatedPptText,
  translatedAiComment,
  sessionId,
  pageNum,
  bulletIndex,
}: {
  bullet: Bullet
  expanded: boolean
  animationDone: boolean
  onToggle: () => void
  onAnimationDone: () => void
  onTimestampClick: (t: number) => void
  translationEnabled?: boolean
  translatedPptText?: string
  translatedAiComment?: string | null
  sessionId: string
  pageNum: number
  bulletIndex: number
}) {
  const { t } = useTranslation()
  const hasComment = !!bullet.ai_comment
  const indent = bullet.level * 16
  const isTitleLine = bulletIndex === 0
  const [hovered, setHovered] = useState(false)

  const [askOpen, setAskOpen] = useState(false)

  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set())
  // ppt_text 是否正在向上退场
  const [pptExiting, setPptExiting] = useState(false)
  // ppt_text swipe-up 完成，隐藏原始 ppt_text（由 reveal 版本接管）
  // animationDone=true 说明已经播过，直接初始化为 true 跳过退场层
  const [pptSwipedAway, setPptSwipedAway] = useState(animationDone)
  // ai 正文逐行揭开是否已触发
  const [startAiLineReveal, setStartAiLineReveal] = useState(false)


  // 展开/收起时控制退场和揭开动画
  useEffect(() => {
    if (!expanded) {
      // 收起：重置动画中间状态（animationDone=true 的不需要重置，下次展开直接走已完成分支）
      if (!animationDone) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRevealedSet(new Set())
        setPptExiting(false)
        setPptSwipedAway(false)
        setStartAiLineReveal(false)
      }
      return
    }
    if (animationDone) return

    const timers: number[] = []
    const after = (delay: number, fn: () => void) => {
      const t = window.setTimeout(fn, delay)
      timers.push(t)
      return t
    }

    // Phase 1：ppt_text 向上退场（swipe-up）
    setPptExiting(true)
    after(320, () => {
      // Phase 2：ppt_text 揭开，等 shimmer 固色
      setPptSwipedAway(true)
      setRevealedSet(new Set([0]))
      after(300, () => {
        // Phase 3：label 揭开
        setRevealedSet(new Set([0, 1]))
        after(250, () => {
          // Phase 4：ai 正文逐行揭开
          setStartAiLineReveal(true)
        })
      })
    })

    return () => timers.forEach(clearTimeout)
  }, [expanded, animationDone])

  const pptRevealed = revealedSet.has(0)
  const labelRevealed = revealedSet.has(1)
  const pptText = translationEnabled && translatedPptText ? translatedPptText : stripBullet(bullet.ppt_text)

  // 始终渲染同一套 DOM，避免 expanded 切换时销毁/重建节点导致闪烁
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        paddingLeft: indent,
        paddingRight: '6px',
        paddingTop: '4px',
        paddingBottom: '4px',
        borderRadius: '6px',
        background: hovered ? 'rgba(175,179,176,0.12)' : 'transparent',
        transition: 'background 120ms',
        marginLeft: -6,
        marginRight: -6,
      }}
    >
      {/* ppt_text 行：收起时是可点击 button，展开动画期间 swipe-up 退场，退场完成后由 reveal 版本接管 */}
      <div style={{ position: 'relative' }}>
        {/* 退场层：始终存在，expanded+pptExiting 时播 swipe-up，pptSwipedAway 后隐藏 */}
        <button
          type="button"
          onClick={() => { if (hasComment) onToggle() }}
          className="text-left w-full"
          style={{
            background: 'none', border: 'none', padding: '4px 0',
            cursor: hasComment ? 'pointer' : 'default',
            display: pptSwipedAway ? 'none' : 'flex',
            alignItems: 'flex-start', gap: '8px', userSelect: 'text',
            width: '100%',
            ...(pptExiting ? { animation: 'swipe-up 0.32s ease-in forwards' } : {}),
          }}
        >
          <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
            {bullet.level === 0 ? '' : '•'}
          </span>
          <span style={{
            fontSize: isTitleLine ? '15px' : '14px',
            color: '#292929', lineHeight: '1.625',
            fontWeight: isTitleLine ? '700' : '400',
            opacity: !expanded
              ? (translationEnabled && !translatedPptText ? 0.4 : (hasComment ? 1 : 0.5))
              : 1,
            transition: 'opacity 0.2s',
          }}>
            {pptText}
          </span>
          {!expanded && hasComment && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
              style={{ flexShrink: 0, marginTop: '4px', color: '#D0CFC5' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>

        {/* reveal 层：swipe-up 完成后接管显示 */}
        {pptSwipedAway && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0' }}>
            <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
              {bullet.level === 0 ? '' : '•'}
            </span>
            <p style={{ fontSize: isTitleLine ? '15px' : '14px', lineHeight: '1.625', fontWeight: isTitleLine ? '700' : '400', margin: 0, minHeight: '1.4em' }}>
              {animationDone
                ? <span style={{ color: '#292929' }}>{pptText}</span>
                : <RevealText revealed={pptRevealed} muted={false} highlight={false}>{pptText}</RevealText>
              }
            </p>
          </div>
        )}
      </div>

      {/* AI 解释区域 — label 揭开后才挂载 */}
      {hasComment && (animationDone || labelRevealed) && (
        <div style={{ marginLeft: '18px', paddingLeft: '14px', borderLeft: '2px solid rgba(85,96,113,0.2)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '1.4em' }}>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'inline', transform: 'translateY(1px)' }}>
                <path d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z" fill="#72726E" />
              </svg>
            </RevealText>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E', textTransform: 'uppercase' }}>
                AI Clarification
              </span>
            </RevealText>
            {bullet.timestamp_start >= 0 && (
              <RevealText revealed={labelRevealed} muted={false} highlight={false}>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onTimestampClick(bullet.timestamp_start) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '9px', color: '#D0CFC5', fontWeight: '700', padding: 0, marginLeft: '4px' }}>
                  {String(Math.floor(bullet.timestamp_start / 60)).padStart(2, '0')}:
                  {String(Math.floor(bullet.timestamp_start % 60)).padStart(2, '0')}
                </button>
              </RevealText>
            )}
          </div>
          <div style={{
            opacity: translationEnabled && !translatedAiComment ? 0.4 : 1,
            transition: 'opacity 0.2s',
            position: 'relative',
          }}>
            {translationEnabled && translatedAiComment
              ? <p style={{ fontSize: '14px', lineHeight: '1.625', fontWeight: '400', margin: 0, userSelect: 'text', color: '#72726E' }}>{translatedAiComment}</p>
              : animationDone
                ? <p style={{ fontSize: '14px', lineHeight: '1.625', fontWeight: '400', margin: 0, userSelect: 'text', color: '#72726E' }}>{bullet.ai_comment}</p>
                : <LineByLineReveal
                    text={bullet.ai_comment as string}
                    startReveal={startAiLineReveal}
                    onDone={onAnimationDone}
                  />
            }
          </div>

          {/* 针对此条提问 — 在 AI 解释区内部 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button
              type="button"
              onClick={() => setAskOpen(v => !v)}
              style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                border: `1px solid ${C.secondary}`,
                background: askOpen ? C.secondary : 'transparent',
                color: askOpen ? '#fff' : C.secondary,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '5px',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {askOpen ? t('notes_bullet_collapse') : t('notes_bullet_ask')}
            </button>
          </div>

          {/* InlineQA 展开区 */}
          {askOpen && (
            <InlineQA
              sessionId={sessionId}
              pageNum={pageNum}
              bulletIndex={bulletIndex}
              bulletText={bullet.ppt_text}
              bulletAiComment={bullet.ai_comment ?? ''}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function NotesPage() {
  injectNoteStyles()
  const { sessionId } = useParams<{ sessionId: string }>()
  const { openTab } = useTabs()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<'my' | 'ai' | 'transcript'>('ai')

  type PagePhase = 'upload' | 'processing' | 'ready'
  const isNewSession = !sessionId || sessionId === 'new'
  const location = useLocation()
  const initialPhase: PagePhase = location.state?.phase === 'processing' ? 'processing' : isNewSession ? 'upload' : 'ready'
  const [pagePhase, setPagePhase] = useState<PagePhase>(initialPhase)
  const [processingSessionId, setProcessingSessionId] = useState<string | undefined>(isNewSession ? undefined : sessionId)
  const navigate = useNavigate()
  const activeSessionId = session?.session_id || processingSessionId || (!isNewSession ? sessionId : undefined)

  const [transcriptJustDone, setTranscriptJustDone] = useState(false)
  const [aiNotesJustDone, setAiNotesJustDone] = useState(false)
  const [revealedPages, setRevealedPages] = useState<Set<number>>(new Set())
  const [pptPageCount, setPptPageCount] = useState<number>(0)
  const lastPipelineTickMsRef = useRef<number>(Date.now())
  const [pipelineSyncLagging, setPipelineSyncLagging] = useState(false)

  const handleSSEEvent = useCallback(async (event: SSEEvent) => {
    const sid = processingSessionId
    if (!sid) return
    lastPipelineTickMsRef.current = Date.now()
    if (pipelineSyncLagging) setPipelineSyncLagging(false)

    if (event.event === 'error') {
      setError(typeof event.message === 'string' ? event.message : '处理失败')
      setPagePhase('ready')
      return
    }

    try {
      const data = await getSession(sid)
      setSession(data as SessionData)
      if (loading) setLoading(false)
    } catch { /* ignore fetch errors */ }

    if (event.event === 'ppt_parsed') {
      const eventData = event.data as { num_pages?: number } | undefined
      setLoading(false)
      if ((eventData?.num_pages ?? 0) > 0) setPptPageCount(eventData!.num_pages!)
    }

    if (event.event === 'asr_done') {
      setTranscriptJustDone(true)
    }

    if (event.event === 'page_ready' && typeof event.page_num === 'number') {
      setRevealedPages(prev => new Set(prev).add(event.page_num as number))
    }

    if (event.event === 'all_done') {
      setPagePhase('ready')
      setAiNotesJustDone(true)
      setTimeout(() => setAiNotesJustDone(false), 1500)
    }
  }, [processingSessionId, loading, pipelineSyncLagging])

  useSessionEvents(processingSessionId, pagePhase === 'processing', handleSSEEvent)

  useEffect(() => {
    if (pagePhase !== 'processing' || !processingSessionId) return
    const timer = setInterval(async () => {
      const idleMs = Date.now() - lastPipelineTickMsRef.current
      if (idleMs > 15000) setPipelineSyncLagging(true)
      try {
        const data = await getSession(processingSessionId) as SessionData & { error?: string }
        setSession(data as SessionData)
        if (data.status === 'ready' || data.status === 'partial_ready') {
          setPagePhase('ready')
          setPipelineSyncLagging(false)
          lastPipelineTickMsRef.current = Date.now()
        } else if (data.status === 'error') {
          setError(data.error ?? '处理失败')
          setPagePhase('ready')
          setPipelineSyncLagging(false)
          lastPipelineTickMsRef.current = Date.now()
        }
      } catch {
        // keep waiting; lag hint will tell user we are retrying state sync
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [pagePhase, processingSessionId])

  const handleUploadSuccess = useCallback((newSessionId: string, pages: PptPage[]) => {
    setProcessingSessionId(newSessionId)
    setPagePhase('processing')
    setLoading(false)
    navigate(`/notes/${newSessionId}`, { replace: true, state: { phase: 'processing' } })
    if (pages.length > 0) {
      const tempSession: SessionData = {
        session_id: newSessionId,
        status: 'processing',
        ppt_filename: '',
        audio_url: '',
        total_duration: 0,
        pages: pages.map((p) => ({
          page_num: p.page_num,
          status: 'processing',
          pdf_url: p.pdf_url ?? '',
          pdf_page_num: p.pdf_page_num,
          thumbnail_url: p.thumbnail_url ?? undefined,
          ppt_text: p.ppt_text,
          page_start_time: 0,
          page_end_time: 0,
          alignment_confidence: 0,
          active_notes: null,
          passive_notes: null,
          page_supplement: null,
        })),
      }
      setPptPageCount(pages.length)
      setSession(tempSession)
    } else {
      setLoading(true)
    }
  }, [navigate])

  const [playingSegIdx, setPlayingSegIdx] = useState<number | null>(null)
  const [playProgress, setPlayProgress] = useState(0) // 0–1，当前播放段进度
  const segStartRef = useRef<number | null>(null)
  const segEndRef = useRef<number | null>(null)
  const segTimeUpdateRef = useRef<(() => void) | null>(null)
  const [transcriptClickCount, setTranscriptClickCount] = useState<number>(() => {
    return parseInt(localStorage.getItem('liberstudy_transcript_clicks') ?? '0', 10)
  })
  const [retrying, setRetrying] = useState<number | null>(null)
  const [navVisible, setNavVisible] = useState(false)

  // Toolbar state
  const [activeTool, setActiveTool] = useState<'none' | 'highlight' | 'eraser' | 'text'>('none')
  const [highlightColor, setHighlightColor] = useState('#FAFF00')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageInputValue, setPageInputValue] = useState('1')

  // 跨页持久化的展开状态：pageNum → Set<bulletIndex>
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  // 记录哪些 bullet 的 shimmer 动画已播完，跨页持久化，切回来直接显示文本
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const prevPageRef = useRef<number>(1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const wheelTimeoutRef = useRef<number | null>(null)
  const wheelAccumRef = useRef(0)
  const currentPageRef = useRef(currentPage)
  const totalPagesRef = useRef(session?.pages.length ?? 1)

  // Highlight tool state
  const pageContainerRef = useRef<HTMLDivElement | null>(null)
  const { addHighlight, removeHighlight, highlightsForPage } = useHighlights(sessionId ?? '')
  const { addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage } = useTextAnnotations(sessionId ?? '')

  // Translation state
  const { enabled: translationEnabled, setEnabled: setTranslationEnabled, targetLang, setTargetLang, translate, t } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, {
    bullets: string[]
    aiComments: (string | null)[]
    supplement: string | null
    aiExpansion: string | null
  }>>(new Map())

  // Provider 切换（AI Notes 顶部）
  const provider = '中转站' as const

  // My Notes：key=pageNum，值为文本（从 IndexedDB 加载，onChange 时 debounce 保存）
  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const myNoteSaveTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const getMyNoteText = (page: number) => myNoteTexts.get(page) ?? ''

  const handleMyNoteChange = useCallback((page: number, text: string) => {
    setMyNoteTexts(prev => { const m = new Map(prev); m.set(page, text); return m })
    // debounce 500ms 保存
    const timers = myNoteSaveTimerRef.current
    const old = timers.get(page)
    if (old) clearTimeout(old)
    const t = setTimeout(() => {
      if (sessionId) saveMyNote(sessionId, page, text)
      timers.delete(page)
    }, 500)
    timers.set(page, t)
  }, [sessionId])

  // 切换页面时从 IndexedDB 加载 my note
  useEffect(() => {
    if (!sessionId) return
    loadMyNote(sessionId, currentPage).then(text => {
      setMyNoteTexts(prev => {
        if (prev.has(currentPage)) return prev
        const m = new Map(prev); m.set(currentPage, text); return m
      })
    })
  }, [sessionId, currentPage])

  // AI 扩写状态：idle | expanding（扩写中）| expanded（扩写完成）
  type MyNoteExpandState = { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }
  const [myNoteExpandStates, setMyNoteExpandStates] = useState<Map<number, MyNoteExpandState>>(new Map())

  const getMyNoteExpandState = (page: number): MyNoteExpandState =>
    myNoteExpandStates.get(page) ?? { userNote: '', aiText: '', status: 'idle' }

  const patchMyNoteExpandState = useCallback((page: number, patch: Partial<MyNoteExpandState>) =>
    setMyNoteExpandStates(prev => {
      const current = prev.get(page) ?? { userNote: '', aiText: '', status: 'idle' as const }
      const next = new Map(prev)
      next.set(page, { ...current, ...patch })
      return next
    }), [])

  // Page-level chat（My Notes / AI Notes 底部共用，key=pageNum）
  const [pageChatMessages, setPageChatMessages] = useState<Map<number, PageChatMessage[]>>(new Map())
  const [pageChatInput, setPageChatInput] = useState('')
  const [pageChatStreaming, setPageChatStreaming] = useState(false)
  const [pageChatStreamingText, setPageChatStreamingText] = useState('')
  const pageChatBottomRef = useRef<HTMLDivElement>(null)

  // Drawer phase: 'closed' | 'input' | 'full'
  const [drawerPhase, setDrawerPhase] = useState<'closed' | 'input' | 'full'>('closed')
  const [drawerHeightPx, setDrawerHeightPx] = useState<number | null>(null) // null = use default %
  const [drawerModel, setDrawerModel] = useState('Auto')
  const [drawerModelDDOpen, setDrawerModelDDOpen] = useState(false)
  const drawerModelBtnRef = useRef<HTMLButtonElement>(null)
  const firstSlidePerfRef = useRef<{ startMs: number; reported: boolean; sessionId: string }>({
    startMs: 0,
    reported: false,
    sessionId: '',
  })

  useEffect(() => {
    if (!drawerModelDDOpen) return
    const handler = (e: MouseEvent) => {
      if (drawerModelBtnRef.current?.contains(e.target as Node)) return
      setDrawerModelDDOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [drawerModelDDOpen])

  useEffect(() => {
    const sid = sessionId ?? 'new'
    firstSlidePerfRef.current = {
      startMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      reported: false,
      sessionId: sid,
    }
    console.info(`[Perf][Notes] enter session=${sid}`)
  }, [sessionId])

  // 切换页面时收回抽屉
  const drawerPrevPageRef = useRef(currentPage)
  useEffect(() => {
    if (drawerPrevPageRef.current !== currentPage) {
      setDrawerPhase('closed')
      setDrawerHeightPx(null)
      setPageChatInput('')
      drawerPrevPageRef.current = currentPage
    }
  }, [currentPage])

  const getPageChat = (page: number): PageChatMessage[] => pageChatMessages.get(page) ?? []

  // 切换页面时加载 page chat
  useEffect(() => {
    if (!sessionId) return
    loadPageChat(sessionId, currentPage).then(msgs => {
      setPageChatMessages(prev => {
        if (prev.has(currentPage)) return prev
        const m = new Map(prev); m.set(currentPage, msgs); return m
      })
    })
  }, [sessionId, currentPage])

  useEffect(() => {
    pageChatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pageChatMessages, pageChatStreamingText])

  const handlePageChatSend = useCallback(async () => {
    const q = pageChatInput.trim()
    if (!q || pageChatStreaming || !activeSessionId) return
    const userMsg: PageChatMessage = { role: 'user', content: q, timestamp: Date.now() }
    const currentMsgs = pageChatMessages.get(currentPage) ?? []
    const newMsgs = [...currentMsgs, userMsg]
    setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, newMsgs); return m })
    setPageChatInput('')
    setPageChatStreaming(true)
    setPageChatStreamingText('')

    try {
      const pageData = session?.pages.find(p => p.page_num === currentPage)
      const context = [
        getMyNoteText(currentPage) ? `用户笔记：${getMyNoteText(currentPage)}` : '',
        pageData?.passive_notes?.bullets?.map(b => b.ppt_text).join('\n') ?? '',
      ].filter(Boolean).join('\n\n')

      let full = ''
      await askBullet(activeSessionId, currentPage, -1, context, '', q, drawerModel === 'Auto' ? '中转站' : drawerModel, (chunk) => {
        full += chunk
        setPageChatStreamingText(full)
      })
      const aiMsg: PageChatMessage = { role: 'ai', content: full, timestamp: Date.now() }
      const finalMsgs = [...newMsgs, aiMsg]
      setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, finalMsgs); return m })
      await savePageChat(activeSessionId, currentPage, finalMsgs)
    } catch (err) {
      const errMsg: PageChatMessage = { role: 'ai', content: `出错了：${err instanceof Error ? err.message : '未知错误'}`, timestamp: Date.now() }
      const finalMsgs = [...newMsgs, errMsg]
      setPageChatMessages(prev => { const m = new Map(prev); m.set(currentPage, finalMsgs); return m })
      await savePageChat(activeSessionId, currentPage, finalMsgs)
    } finally {
      setPageChatStreaming(false)
      setPageChatStreamingText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageChatInput, pageChatStreaming, activeSessionId, currentPage, pageChatMessages, session, myNoteTexts])

  // Resizable panel state
  const [notesPanelWidth, setNotesPanelWidth] = useState(500)
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(320)

  // Canvas display width in pixels
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(800)

  useEffect(() => {
    if (!canvasAreaRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(Math.max(400, entry.contentRect.width - 48))
      }
    })
    ro.observe(canvasAreaRef.current)
    return () => ro.disconnect()
  }, [])

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true
    resizeStartXRef.current = e.clientX
    resizeStartWidthRef.current = notesPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = resizeStartXRef.current - ev.clientX
      setNotesPanelWidth(Math.max(100, resizeStartWidthRef.current + delta))
    }

    const onMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [notesPanelWidth])

  // NotesPage 挂载时锁定 body 滚动，防止触摸板带动整页上下滚
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    if (!sessionId || sessionId === 'new') return
    getSession(sessionId)
      .then((data) => {
        setSession(data as SessionData)
        if ((data as SessionData).pages?.length) {
          setPptPageCount((data as SessionData).pages.length)
        }
        openTab({ sessionId: sessionId!, label: (data as SessionData).ppt_filename ?? sessionId! })
        setLoading(false)
        if ((data as SessionData).status === 'processing') {
          setPagePhase('processing')
          setProcessingSessionId(sessionId)
        }
      })
      .catch(() => { setError('无法加载笔记数据'); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Wheel翻页 handler（用 passive:false 原生监听才能 preventDefault）
  const handleWheelRef = useRef<(e: WheelEvent) => void>((e) => {
    // 横向滑动为主时不翻页
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    e.preventDefault()
    e.stopPropagation()

    // 累积 deltaY，超过阈值才翻页（兼容触摸板小增量和鼠标大增量）
    // deltaMode=1 是行模式（鼠标），乘以 40 转换为像素
    const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
    wheelAccumRef.current += delta

    const THRESHOLD = 50
    if (Math.abs(wheelAccumRef.current) < THRESHOLD) return

    const direction = wheelAccumRef.current > 0 ? 1 : -1
    wheelAccumRef.current = 0

    if (wheelTimeoutRef.current) return
    if (direction === 1 && currentPageRef.current < totalPagesRef.current) {
      setCurrentPage(p => p + 1)
    } else if (direction === -1 && currentPageRef.current > 1) {
      setCurrentPage(p => p - 1)
    }
    wheelTimeoutRef.current = window.setTimeout(() => {
      wheelTimeoutRef.current = null
      wheelAccumRef.current = 0
    }, 400)
  })

  // 在 window 捕获阶段监听 wheel，检查事件是否发生在 canvas 区域内
  // 原因：useEffect([]) 运行时 loading 尚未结束，canvasAreaRef.current 为 null，
  // 导致事件永远无法注册。改用 window 级监听 + 区域检测规避此问题。
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const el = canvasAreaRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) return
      handleWheelRef.current(e)
    }
    window.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handler, { capture: true })
  }, [])

  // Keep wheel ref pages in sync
  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    totalPagesRef.current = session?.pages.length ?? 1
  }, [session?.pages.length])

  // 键盘翻页
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        setCurrentPage(p => Math.min(p + 1, session?.pages.length ?? 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        setCurrentPage(p => Math.max(p - 1, 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session?.pages.length])

  // 页码输入框同步 currentPage
  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  const handleTimestampClick = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds
      audioRef.current.play()
    }
  }, [])

  const handleSegmentPlay = useCallback((seg: AlignedSegment, idx: number) => {
    const audio = audioRef.current
    if (!audio) return

    // 点击正在播放的行 → 停止
    if (playingSegIdx === idx) {
      audio.pause()
      segEndRef.current = null
      segStartRef.current = null
      if (segTimeUpdateRef.current) {
        audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
        segTimeUpdateRef.current = null
      }
      setPlayingSegIdx(null)
      setPlayProgress(0)
      return
    }

    // 切换到新行前清除旧监听
    if (segTimeUpdateRef.current) {
      audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
      segTimeUpdateRef.current = null
    }

    // 记录点击次数（最多记到 3，超过后不再更新）
    setTranscriptClickCount((prev) => {
      const next = Math.min(prev + 1, 3)
      localStorage.setItem('liberstudy_transcript_clicks', String(next))
      return next
    })

    segEndRef.current = seg.end
    segStartRef.current = seg.start
    setPlayingSegIdx(idx)
    setPlayProgress(0)
    audio.currentTime = seg.start
    audio.play()

    const onTimeUpdate = () => {
      const start = segStartRef.current!
      const end = segEndRef.current!
      const duration = end - start
      if (duration > 0) {
        setPlayProgress(Math.min((audio.currentTime - start) / duration, 1))
      }
      if (segEndRef.current !== null && audio.currentTime >= segEndRef.current) {
        audio.pause()
        segEndRef.current = null
        segStartRef.current = null
        segTimeUpdateRef.current = null
        setPlayingSegIdx(null)
        setPlayProgress(0)
        audio.removeEventListener('timeupdate', onTimeUpdate)
      }
    }
    segTimeUpdateRef.current = onTimeUpdate
    audio.addEventListener('timeupdate', onTimeUpdate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingSegIdx])

  const handleExpandMyNote = useCallback(async (pageNum: number) => {
    if (!activeSessionId) return
    const userNote = myNoteTexts.get(pageNum) ?? ''
    if (!userNote.trim()) return
    const pptText = session?.pages.find(p => p.page_num === pageNum)?.ppt_text ?? ''
    patchMyNoteExpandState(pageNum, { userNote, aiText: '', status: 'expanding' })
    try {
      await generateMyNote(activeSessionId, pageNum, userNote, pptText, provider, (chunk) => {
        setMyNoteExpandStates(prev => {
          const current = prev.get(pageNum)
          if (!current) return prev
          const next = new Map(prev)
          next.set(pageNum, { ...current, aiText: current.aiText + chunk })
          return next
        })
      })
      patchMyNoteExpandState(pageNum, { status: 'expanded' })
    } catch {
      patchMyNoteExpandState(pageNum, { status: 'idle' })
    }
  }, [activeSessionId, session, provider, myNoteTexts, patchMyNoteExpandState])

  const handleRetryPage = useCallback(async (pageNum: number) => {
    if (!activeSessionId || retrying !== null) return
    setRetrying(pageNum)
    try {
      await retryPage(activeSessionId, pageNum)
      const data = await getSession(activeSessionId)
      setSession(data as SessionData)
    } catch {
      // keep current state
    } finally {
      setRetrying(null)
    }
  }, [activeSessionId, retrying])

  const translatePage = useCallback(async (pageNum: number) => {
    if (!session) return
    const page = session.pages.find((p) => p.page_num === pageNum)
    if (!page) return

    const bullets = page.passive_notes?.bullets ?? []
    const supplement = page.page_supplement?.content ?? null
    const aiExpansion = page.active_notes?.ai_expansion ?? null

    const [translatedBullets, translatedAiComments, translatedSupplement, translatedAiExpansion] =
      await Promise.all([
        Promise.all(bullets.map((b) => translate(b.ppt_text))),
        Promise.all(bullets.map((b) => (b.ai_comment ? translate(b.ai_comment) : Promise.resolve(null)))),
        supplement ? translate(supplement) : Promise.resolve(null),
        aiExpansion ? translate(aiExpansion) : Promise.resolve(null),
      ])

    setTranslatedTexts((prev) => {
      const next = new Map(prev)
      next.set(pageNum, {
        bullets: translatedBullets,
        aiComments: translatedAiComments,
        supplement: translatedSupplement,
        aiExpansion: translatedAiExpansion,
      })
      return next
    })
  }, [session, translate])

  // 翻译已开启时，翻页自动翻译新页
  useEffect(() => {
    if (translationEnabled && session) {
      translatePage(currentPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, translationEnabled, session])

  // 切页时把上一页所有展开中的 bullet 标记为动画完成，跳回来直接显示文本
  useEffect(() => {
    const prevPage = prevPageRef.current
    if (prevPage === currentPage) return
    const expanded = expandedBullets.get(prevPage)
    if (expanded && expanded.size > 0) {
      setAnimatedBullets(prev => {
        const next = new Map(prev)
        const pageSet = new Set(next.get(prevPage) ?? [])
        expanded.forEach(i => pageSet.add(i))
        next.set(prevPage, pageSet)
        return next
      })
    }
    prevPageRef.current = currentPage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])

  const currentPageData = session?.pages.find((p) => p.page_num === currentPage)
  const totalPages = session?.pages.length ?? pptPageCount

  const navPages: Array<{ page_num: number; thumbnail_url?: string; pdf_page_num: number }> =
    session?.pages?.map((p) => ({
      page_num: p.page_num,
      thumbnail_url: p.thumbnail_url,
      pdf_page_num: p.pdf_page_num,
    })) ??
    Array.from({ length: pptPageCount }, (_, i) => ({
      page_num: i + 1,
      pdf_page_num: i + 1,
    }))

  const buildSessionSlideUrl = (pageNum: number): string | null =>
    activeSessionId ? `${API_BASE}/api/sessions/${activeSessionId}/slide/${pageNum}.png` : null

  const primarySlideUrl: string | null = currentPageData
    ? (withApiBase(currentPageData.thumbnail_url) ?? buildSessionSlideUrl(currentPageData.pdf_page_num))
    : pptPageCount > 0
      ? buildSessionSlideUrl(currentPage)
      : null

  const fallbackSlideUrl: string | null = currentPageData
    ? buildSessionSlideUrl(currentPageData.pdf_page_num)
    : buildSessionSlideUrl(currentPage)

  const draftOutlineLines: string[] = (currentPageData?.ppt_text ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed) return []
      if (!trimmed.includes('•')) return [trimmed]
      return trimmed
        .split('•')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `• ${part}`)
    })

  const [resolvedSlideUrl, setResolvedSlideUrl] = useState<string | null>(null)
  useEffect(() => {
    setResolvedSlideUrl(primarySlideUrl)
  }, [primarySlideUrl])

  const reportFirstSlidePaint = useCallback((source: 'primary' | 'fallback' | 'failed') => {
    const perf = firstSlidePerfRef.current
    if (perf.reported) return
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const durationMs = now - perf.startMs
    perf.reported = true
    const record: NotesPerfRecord = {
      sessionId: perf.sessionId,
      durationMs,
      source,
      slide: currentPage,
      timestamp: new Date().toISOString(),
    }
    pushNotesPerf(record)
    console.info(`[Perf][Notes] first-slide-painted source=${source} duration=${durationMs.toFixed(1)}ms slide=${currentPage} session=${perf.sessionId}`)
  }, [currentPage])

  useEffect(() => {
    if (!resolvedSlideUrl && pagePhase !== 'processing') {
      reportFirstSlidePaint('failed')
    }
  }, [resolvedSlideUrl, pagePhase, reportFirstSlidePaint])

  if (loading && pagePhase === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: C.muted }}>{t('notes_loading')}</p>
        </div>
      </div>
    )
  }

  if ((error || !session) && pagePhase === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <p className="text-sm mb-4" style={{ color: C.secondary }}>{error ?? t('notes_unknown_error')}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer transition-all duration-150"
            style={{ background: C.sidebar, color: C.fg }}
          >
            {t('notes_retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: FONT_SERIF }}>

      {/* Main body (below TopAppBar) */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '40px' }}>

        {/* Left slide nav: click-toggle */}
        {navVisible && (
          <aside
            className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{ width: '200px', background: C.sidebar, borderRight: '1px solid rgba(175,179,176,0.1)', zIndex: 15 }}
          >
            <div
              className="flex items-center justify-between flex-shrink-0 px-4"
              style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
            >
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.secondary }}>{t('notes_toc')}</span>
              <button type="button" onClick={() => setNavVisible(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.secondary }}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} onWheel={(e) => e.stopPropagation()}>
              {navPages.map((page) => {
                const isActive = page.page_num === currentPage
                return (
                  <button
                    type="button"
                    key={page.page_num}
                    onClick={() => setCurrentPage(page.page_num)}
                    aria-label={`跳转到第 ${page.page_num} 张幻灯片`}
                    aria-current={isActive ? 'true' : undefined}
                    className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center w-full border-none p-0"
                    style={{ height: '80px', borderRadius: '6px', background: C.divider, boxShadow: isActive ? '0px 0px 0px 2px rgba(95,94,94,1)' : '0 1px 3px rgba(0,0,0,0.08)', opacity: isActive ? 1 : 0.7 }}
                  >
                    <img
                      src={withApiBase(page.thumbnail_url) ?? (buildSessionSlideUrl(page.pdf_page_num) ?? '')}
                      alt={`第${page.page_num}页`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                      onError={(e) => {
                        const fallback = buildSessionSlideUrl(page.pdf_page_num)
                        if (!fallback) return
                        if (e.currentTarget.dataset.fallbackApplied === '1') {
                          e.currentTarget.style.opacity = '0'
                          return
                        }
                        e.currentTarget.dataset.fallbackApplied = '1'
                        e.currentTarget.src = fallback
                      }}
                    />
                    <span className="absolute top-1 left-1.5 flex items-center justify-center" style={{ background: C.fg, color: C.white, fontSize: '8px', fontWeight: '700', borderRadius: '3px', padding: '1px 5px', minWidth: '16px' }}>
                      {page.page_num}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        {/* Center: PPT Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: C.bg }}>

          {/* Toolbar */}
          <CanvasToolbar
            navVisible={navVisible}
            onNavToggle={() => setNavVisible((v) => !v)}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onHighlightColorChange={setHighlightColor}
            translationEnabled={translationEnabled}
            popoverOpen={popoverOpen}
            onPopoverToggle={() => setPopoverOpen((v) => !v)}
            targetLang={targetLang}
            onTargetLangChange={setTargetLang}
            onTranslate={() => { setTranslationEnabled(true); setPopoverOpen(false); translatePage(currentPage) }}
            onShowOriginal={() => { setTranslationEnabled(false); setPopoverOpen(false) }}
            onClosePopover={() => setPopoverOpen(false)}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            currentPage={currentPage}
            totalPages={totalPages}
            pageInputValue={pageInputValue}
            onPageInputChange={setPageInputValue}
            onPageInputCommit={() => {
              const n = parseInt(pageInputValue, 10)
              if (!isNaN(n) && n >= 1 && n <= totalPages) setCurrentPage(n)
              else setPageInputValue(String(currentPage))
            }}
            onPrevPage={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
            onNextPage={() => currentPage < totalPages && setCurrentPage(currentPage + 1)}
            searchOpen={searchOpen}
            onSearchToggle={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery('') }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          {/* Canvas area — single page with wheel navigation */}
          <div
            ref={canvasAreaRef}
            className="flex-1 flex items-center justify-center"
            style={{
              background: 'rgba(232,231,226,0.6)',
              overflowX: zoomLevel > 100 ? 'auto' : 'hidden',
              overflowY: 'hidden',
              touchAction: 'none',
            }}
          >
            {!resolvedSlideUrl && pagePhase === 'processing' && (
              <div style={{ width: Math.round(canvasWidth * zoomLevel / 100), maxWidth: '100%', aspectRatio: '16/9', borderRadius: '8px', background: C.white, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
                <span style={{ fontSize: '12px', color: C.muted }}>{t('notes_loading')}</span>
              </div>
            )}
            {!resolvedSlideUrl && pagePhase !== 'processing' && (
              <div style={{ width: Math.round(canvasWidth * zoomLevel / 100), maxWidth: '100%', aspectRatio: '16/9', borderRadius: '8px', background: C.white, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '12px', color: C.muted }}>当前页图片加载失败</span>
              </div>
            )}
            {resolvedSlideUrl && (() => {
              return (
                <div
                  className="relative"
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                >
                  <div
                    ref={pageContainerRef}
                    className="relative rounded-lg overflow-hidden"
                    style={{
                      background: C.white,
                      boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                    }}
                  >
                    <img
                      key={resolvedSlideUrl}
                      src={resolvedSlideUrl}
                      alt=""
                      style={{ width: Math.round(canvasWidth * zoomLevel / 100), maxWidth: '100%', maxHeight: '80vh', display: 'block', objectFit: 'contain' }}
                      onLoad={() => {
                        if (resolvedSlideUrl === fallbackSlideUrl) {
                          reportFirstSlidePaint('fallback')
                        } else {
                          reportFirstSlidePaint('primary')
                        }
                      }}
                      onError={() => {
                        if (fallbackSlideUrl && resolvedSlideUrl !== fallbackSlideUrl) {
                          setResolvedSlideUrl(fallbackSlideUrl)
                        } else {
                          setResolvedSlideUrl(null)
                        }
                      }}
                    />
                    {/* Highlight layer */}
                    <HighlightLayer
                      pageContainerRef={pageContainerRef}
                      pageNum={currentPage}
                      highlights={highlightsForPage(currentPage)}
                      highlightToolActive={activeTool === 'highlight'}
                      eraserToolActive={activeTool === 'eraser'}
                      highlightColor={highlightColor}
                      onAdd={(rec) => addHighlight({ ...rec, sessionId: sessionId ?? '' })}
                      onRemove={removeHighlight}
                    />
                    {/* Text annotation layer */}
                    <TextAnnotationLayer
                      annotations={annotationsForPage(currentPage)}
                      textToolActive={activeTool === 'text'}
                      onPlaceAnnotation={(x, y) => addAnnotation(currentPage, x, y)}
                      onUpdate={updateAnnotation}
                      onRemove={removeAnnotation}
                    />
                    {/* Slide label bottom-right */}
                    <div
                      className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
                    >
                      SLIDE {String(currentPage).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </main>

        {/* Resizer */}
        <div
          onMouseDown={handleResizerMouseDown}
          className="flex-shrink-0 flex items-center justify-center"
          style={{
            width: '8px',
            cursor: 'col-resize',
            background: 'transparent',
            position: 'relative',
            zIndex: 10,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.06)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
        >
          <div style={{ width: '1px', height: '100%', background: 'rgba(175,179,176,0.2)' }} />
        </div>

        {/* Right panel: Notes */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: `${notesPanelWidth}px`, background: C.white, position: 'relative' }}
        >
          {/* Tab bar */}
          <div
            className="flex-shrink-0 flex items-end"
            style={{ padding: '14px 18px 0', borderBottom: `1px solid ${C.divider}`, gap: 0 }}
          >
            {(['my', 'ai', 'transcript'] as const).map((mode) => {
              const label = mode === 'my' ? t('notes_my_tab') : mode === 'ai' ? t('notes_ai_tab') : t('notes_transcript_tab')
              const active = noteMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setNoteMode(mode); if (mode === 'transcript') setTranscriptJustDone(false) }}
                  style={{
                    padding: '6px 16px 10px',
                    fontSize: '13px',
                    fontWeight: active ? '700' : '500',
                    color: active ? C.fg : C.muted,
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${active ? '#798C00' : 'transparent'}`,
                    marginBottom: '-1px',
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  {mode === 'transcript' && pagePhase === 'processing' && !session?.pages?.some(p => (p.aligned_segments?.length ?? 0) > 0) && (
                    <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#EC4899', verticalAlign: 'middle' }} />
                  )}
                  {mode === 'transcript' && transcriptJustDone && (
                    <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
                  )}
                  {mode === 'ai' && pagePhase === 'processing' && session?.pages?.some(p => !p.passive_notes?.bullets?.length) && (
                    <span className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin" style={{ borderWidth: '1.5px', borderColor: '#D0CFC5', borderTopColor: '#8B5CF6', verticalAlign: 'middle' }} />
                  )}
                  {mode === 'ai' && aiNotesJustDone && (
                    <span style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}>✓</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Notes content area */}
          <div className="flex-1 overflow-y-auto px-6 pb-4" onWheel={(e) => e.stopPropagation()}>

            {noteMode === 'my' ? (() => {
              const myText = getMyNoteText(currentPage)

              return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {/* 始终可见的 textarea，像 Word 打字 */}
                  <textarea
                    value={myText}
                    onChange={e => handleMyNoteChange(currentPage, e.target.value)}
                    placeholder={t('notes_my_placeholder')}
                    style={{
                      flex: 1, width: '100%', resize: 'none', border: 'none', outline: 'none',
                      background: 'transparent', color: C.fg, fontSize: '13px',
                      lineHeight: '1.7', fontFamily: 'inherit', minHeight: '200px',
                      boxSizing: 'border-box', padding: '0', paddingTop: '12px',
                    }}
                  />

                </div>
              )
            })() : noteMode === 'ai' ? (
              /* AI Notes mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* My Notes 块 — AI Notes 区域顶部 */}
                {(() => {
                  const myText = getMyNoteText(currentPage)
                  const expandState = getMyNoteExpandState(currentPage)
                  const hasMyNote = myText.trim().length > 0
                  const isExpanding = expandState.status === 'expanding'
                  const isExpanded = expandState.status === 'expanded'
                  const pptAnnotations = annotationsForPage(currentPage).filter(a => a.text.trim())

                  if (!hasMyNote && !isExpanded && pptAnnotations.length === 0) return null

                  return (
                    <div style={{ paddingTop: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em', color: '#72726E' }}>{t('notes_my_notes_heading')}</span>
                        {hasMyNote && (
                          <button
                            type="button"
                            onClick={() => handleExpandMyNote(currentPage)}
                            disabled={isExpanding}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '2px 8px', borderRadius: '4px',
                              border: `1px solid ${isExpanding ? '#6366f1' : C.divider}`,
                              background: isExpanding ? 'rgba(99,102,241,0.08)' : 'transparent',
                              color: isExpanding ? '#6366f1' : C.muted,
                              fontSize: '11px', fontWeight: '500', cursor: isExpanding ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                                fill={isExpanding ? '#6366f1' : '#72726E'} />
                            </svg>
                            {isExpanding ? t('notes_expanding') : t('notes_expand')}
                          </button>
                        )}
                      </div>

                      {/* 用户笔记原文（黑色） */}
                      {hasMyNote && (
                        <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}>
                          {myText}
                        </p>
                      )}

                      {/* PPT 批注（只读展示） */}
                      {pptAnnotations.length > 0 && (
                        <div style={{ marginTop: hasMyNote ? '10px' : '0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', color: C.muted }}>{t('notes_annotation_label')}</span>
                          {pptAnnotations.map(a => (
                            <p key={a.id} style={{
                              fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0,
                              padding: '6px 10px', borderRadius: '6px', background: C.sidebar,
                              whiteSpace: 'pre-wrap',
                            }}>
                              {a.text}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* AI 扩写流式展示（灰色） */}
                      {(isExpanding || isExpanded) && expandState.aiText && (
                        <div
                          style={{
                            marginTop: '10px',
                            paddingLeft: '14px',
                            borderLeft: '2px solid rgba(85,96,113,0.2)',
                          }}
                        >
                          {isExpanding ? (
                            <div
                              style={{ fontSize: '13px', color: '#72726E', lineHeight: '1.7' }}
                            >
                              {renderMd(expandState.aiText)}
                              <span style={{ opacity: 0.5 }}>▋</span>
                            </div>
                          ) : (
                            <StreamingExpandText text={expandState.aiText} />
                          )}
                        </div>
                      )}

                      {/* 分隔线 — My Notes 与 AI Notes 分开 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', marginBottom: '4px' }}>
                        <div style={{ flex: 1, height: '1px', background: C.divider }} />
                        <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted, whiteSpace: 'nowrap' }}>
                          AI NOTES
                        </span>
                        <div style={{ flex: 1, height: '1px', background: C.divider }} />
                      </div>
                    </div>
                  )
                })()}

                {/* Active notes (user note + AI expansion) — 原始 session 数据 */}
                {currentPageData?.active_notes ? (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        ACTIVE ANNOTATION
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ fontSize: '11px', color: '#D0CFC5', fontWeight: '500' }}>
                        {formatTime(currentPageData.page_start_time)}
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                    </div>
                    <p style={{ fontSize: '14px', color: C.fg, fontWeight: '500', lineHeight: '1.6', marginBottom: '12px' }}>
                      {currentPageData.active_notes.user_note}
                    </p>
                    {/* AI clarification block */}
                    <div style={{ borderLeft: '2px solid rgba(85,96,113,0.2)', paddingLeft: '16px' }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                            fill="#72726E"
                          />
                        </svg>
                        <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em', color: C.secondary, textTransform: 'uppercase' }}>
                          AI Clarification
                        </span>
                      </div>
                      <p style={{ fontSize: '14px', color: C.fg, lineHeight: '1.6',
                        opacity: translationEnabled && !translatedTexts.get(currentPage)?.aiExpansion ? 0.4 : 1,
                        transition: 'opacity 0.2s',
                      }}>
                        {translationEnabled && translatedTexts.get(currentPage)?.aiExpansion
                          ? translatedTexts.get(currentPage)!.aiExpansion!
                          : currentPageData.active_notes.ai_expansion}
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Passive notes — error state */}
                {currentPageData?.passive_notes?.error && (
                  <div
                    className="rounded-lg p-4"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#B45309' }}>
                        笔记生成失败
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#92400E', lineHeight: '1.5', marginBottom: '8px' }}>
                      {currentPageData.passive_notes.error}
                    </p>
                    <button
                      onClick={() => handleRetryPage(currentPageData.page_num)}
                      disabled={retrying === currentPageData.page_num}
                      className="text-xs px-3 py-1.5 rounded cursor-pointer transition-all duration-150 disabled:opacity-50"
                      style={{
                        background: '#F59E0B',
                        color: C.white,
                        border: 'none',
                        fontWeight: '500',
                      }}
                    >
                      {retrying === currentPageData.page_num ? '重新生成中…' : '重新生成'}
                    </button>
                  </div>
                )}

                {/* PPT bullets + AI 解释（点击展开，打字机） */}
                {currentPageData?.passive_notes?.bullets && currentPageData.passive_notes.bullets.length > 0 && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.1em', color: '#777C79', textTransform: 'uppercase' }}>
                        AI Notes
                      </span>
                    </div>
                    <div
                      className={revealedPages.has(currentPage) ? 'ai-bullet-reveal' : ''}
                      style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                    >
                      {currentPageData.passive_notes.bullets.map((bullet, i) => (
                        <AiBulletRow
                          key={`${currentPage}-${i}`}
                          bullet={bullet}
                          expanded={expandedBullets.get(currentPage)?.has(i) ?? false}
                          animationDone={animatedBullets.get(currentPage)?.has(i) ?? false}
                          onToggle={() => {
                            setExpandedBullets(prev => {
                              const next = new Map(prev)
                              const pageSet = new Set(next.get(currentPage) ?? [])
                              if (pageSet.has(i)) pageSet.delete(i)
                              else pageSet.add(i)
                              next.set(currentPage, pageSet)
                              return next
                            })
                          }}
                          onAnimationDone={() => {
                            setAnimatedBullets(prev => {
                              const next = new Map(prev)
                              const pageSet = new Set(next.get(currentPage) ?? [])
                              pageSet.add(i)
                              next.set(currentPage, pageSet)
                              return next
                            })
                          }}
                          onTimestampClick={handleTimestampClick}
                          translationEnabled={translationEnabled}
                          translatedPptText={translatedTexts.get(currentPage)?.bullets[i]}
                          translatedAiComment={translatedTexts.get(currentPage)?.aiComments[i]}
                          sessionId={activeSessionId ?? ''}
                          pageNum={currentPage}
                          bulletIndex={i}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Processing placeholder: show ppt_text as grey text */}
                {pagePhase === 'processing' && !currentPageData?.passive_notes && currentPageData?.ppt_text && (
                  <div className="ai-bullet-placeholder" style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {draftOutlineLines.map((line, i) => {
                      const isBullet = line.startsWith('• ')
                      if (!isBullet) {
                        return (
                          <div key={`draft-h-${i}`} style={{ fontSize: '13px', lineHeight: '1.5', color: '#8C8F8D', fontWeight: 600, marginTop: i === 0 ? 0 : 4 }}>
                            {line}
                          </div>
                        )
                      }
                      return (
                        <div key={`draft-b-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ color: '#AFB3B0', marginTop: '2px' }}>•</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', lineHeight: '1.7', color: C.muted }}>{line.slice(2)}</div>
                            <div style={{ marginTop: '4px', height: '6px', width: `${70 + ((i * 13) % 25)}%`, borderRadius: '999px', background: 'rgba(175,179,176,0.18)' }} />
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                      <span className="inline-block w-3 h-3 border-2 border-transparent rounded-full animate-spin" style={{ borderColor: '#D0CFC5', borderTopColor: '#8B5CF6' }} />
                      <span style={{ fontSize: '11px', color: C.muted }}>AI 正在生成笔记...</span>
                    </div>
                  </div>
                )}

                {/* No data at all */}
                {!currentPageData?.active_notes && !currentPageData?.passive_notes?.error && (!currentPageData?.passive_notes || currentPageData.passive_notes.bullets.length === 0) && !(pagePhase === 'processing' && currentPageData?.ppt_text) && (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>{t('notes_no_ai_notes')}</p>
                  </div>
                )}

                {/* Page supplement (off-slide content) */}
                {currentPageData?.page_supplement && (
                  <div>
                    <div className="mb-3">
                      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                        {t('notes_off_slide')}
                      </span>
                    </div>
                    <div
                      className="rounded-lg p-3"
                      style={{ background: 'rgba(85,96,113,0.05)', border: '1px solid rgba(85,96,113,0.1)' }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => handleTimestampClick(currentPageData.page_supplement!.timestamp_start)}
                          className="text-xs cursor-pointer transition-all duration-150 hover:opacity-70"
                          style={{ color: '#D0CFC5', background: 'none', border: 'none', padding: 0 }}
                        >
                          {formatTime(currentPageData.page_supplement.timestamp_start)} - {formatTime(currentPageData.page_supplement.timestamp_end)}
                        </button>
                      </div>
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6',
                        opacity: translationEnabled && !translatedTexts.get(currentPage)?.supplement ? 0.4 : 1,
                        transition: 'opacity 0.2s',
                      }}>
                        {translationEnabled && translatedTexts.get(currentPage)?.supplement
                          ? translatedTexts.get(currentPage)!.supplement!
                          : currentPageData.page_supplement.content}
                      </p>
                    </div>
                  </div>
                )}

              </div>
            ) : noteMode === 'transcript' ? (
              /* Transcript mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div className="mb-3" style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '20px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}>
                    TRANSCRIPT
                  </span>
                  {transcriptClickCount < 2 && (
                    <span style={{ fontSize: '10px', color: C.muted, opacity: 0.7 }}>
                      点击句子播放，再次点击停止
                    </span>
                  )}
                </div>
                {currentPageData?.aligned_segments && currentPageData.aligned_segments.length > 0 ? (
                  currentPageData.aligned_segments.map((seg, i) => (
                    <div
                      key={i}
                      onClick={() => handleSegmentPlay(seg, i)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '10px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        background: playingSegIdx === i ? 'rgba(85,107,47,0.08)' : 'transparent',
                        transition: 'background 120ms',
                        borderLeft: playingSegIdx === i ? '2px solid #6B7F3A' : '2px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (playingSegIdx !== i) (e.currentTarget as HTMLDivElement).style.background = 'rgba(175,179,176,0.12)'
                      }}
                      onMouseLeave={(e) => {
                        if (playingSegIdx !== i) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                      }}
                    >
                      {/* 时间戳胶囊：播放时从左向右绿色填充，文字跟随变白 */}
                      {playingSegIdx === i ? (
                        <span
                          style={{
                            flexShrink: 0,
                            position: 'relative',
                            display: 'inline-flex',
                            alignItems: 'center',
                            fontSize: '11px',
                            fontWeight: '600',
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: '36px',
                            height: '20px',
                            alignSelf: 'flex-start',
                            marginTop: '2px',
                            borderRadius: '999px',
                            border: '1.5px solid #6B7F3A',
                            padding: '0 6px',
                            overflow: 'hidden',
                          }}
                        >
                          {/* 绿色填充背景 */}
                          <span
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, bottom: 0,
                              width: `${playProgress * 100}%`,
                              background: '#6B7F3A',
                              transition: 'width 80ms linear',
                              borderRadius: '999px',
                            }}
                          />
                          {/* 底层：绿色文字（填充区右侧可见） */}
                          <span style={{ position: 'relative', color: '#6B7F3A', zIndex: 1 }}>
                            {formatTime(seg.start)}
                          </span>
                          {/* 顶层：白色文字，clip 到填充宽度内 */}
                          <span
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, bottom: 0, right: 0,
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: '6px',
                              color: 'white',
                              fontSize: '11px',
                              fontWeight: '600',
                              fontVariantNumeric: 'tabular-nums',
                              clipPath: `inset(0 ${(1 - playProgress) * 100}% 0 0)`,
                              transition: 'clip-path 80ms linear',
                              zIndex: 2,
                              pointerEvents: 'none',
                            }}
                          >
                            {formatTime(seg.start)}
                          </span>
                        </span>
                      ) : (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '11px',
                            color: '#D0CFC5',
                            fontWeight: '600',
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: '36px',
                            marginTop: '2px',
                            lineHeight: 1.6,
                          }}
                        >
                          {formatTime(seg.start)}
                        </span>
                      )}
                      <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0, flex: 1 }}>
                        {seg.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p style={{ fontSize: '13px', color: C.muted }}>{t('notes_no_transcript')}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Bottom: drawer chat (My Notes / AI Notes) */}
          {noteMode !== 'transcript' && (() => {
            const pageChat = getPageChat(currentPage)
            const drawerHeight = drawerPhase === 'full'
              ? (drawerHeightPx != null ? `${drawerHeightPx}px` : '80%')
              : drawerPhase === 'input' ? '210px' : '0px'
            const models = [
              { id: 'Auto', label: 'Auto（中转站）', logo: '✦', cls: 'logo-auto' },
              { id: '中转站', label: '中转站', logo: '✦', cls: 'logo-claude' },
              { id: '通义千问', label: '通义千问', logo: 'Q', cls: 'logo-qwen' },
              { id: 'DeepSeek', label: 'DeepSeek', logo: 'D', cls: 'logo-deepseek' },
              { id: '豆包', label: '豆包', logo: 'B', cls: 'logo-doubao' },
            ]
            return (
              <>
                {/* Overlay: click to collapse drawer — relative to <aside> */}
                {drawerPhase !== 'closed' && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0,
                      bottom: drawerHeight,
                      zIndex: 25,
                      cursor: 'default',
                    }}
                    onClick={() => { setDrawerModelDDOpen(false); setDrawerPhase('closed') }}
                  />
                )}

                {/* Drawer panel — relative to <aside> */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0, right: 0, bottom: 0,
                    background: C.white,
                    borderRadius: '14px 14px 0 0',
                    boxShadow: drawerPhase !== 'closed' ? `0 -1px 0 ${C.divider}, 0 -10px 36px rgba(0,0,0,0.07)` : 'none',
                    zIndex: 30,
                    height: drawerHeight,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'height 0.42s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.2s ease',
                  }}
                >
                  {/* Drag handle — resize drawer height */}
                  <div
                    style={{
                      flexShrink: 0, height: '14px', cursor: 'ns-resize',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const startY = e.clientY
                      const aside = e.currentTarget.closest('aside') as HTMLElement | null
                      const asideH = aside?.getBoundingClientRect().height ?? 600
                      const startH = drawerHeightPx ?? (asideH * 0.8)
                      const onMove = (ev: MouseEvent) => {
                        const delta = startY - ev.clientY
                        const next = Math.min(Math.max(startH + delta, 180), asideH - 52)
                        setDrawerHeightPx(next)
                      }
                      const onUp = () => {
                        document.removeEventListener('mousemove', onMove)
                        document.removeEventListener('mouseup', onUp)
                      }
                      document.addEventListener('mousemove', onMove)
                      document.addEventListener('mouseup', onUp)
                    }}
                  >
                    <div style={{
                      width: '32px', height: '3px', borderRadius: '2px',
                      background: '#D0CFC5',
                    }} />
                  </div>
                  {/* Drawer top bar */}
                  <div style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px 9px',
                    borderBottom: `1px solid ${C.divider}`,
                    opacity: drawerPhase !== 'closed' ? 1 : 0,
                    transition: 'opacity 0.18s ease 0.1s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: '600', color: C.fg }}>
                      AI Chat
                      <span style={{
                        fontSize: '10px', fontWeight: '600', color: C.secondary,
                        background: C.sidebar, border: `1px solid ${C.divider}`,
                        borderRadius: '4px', padding: '1px 6px',
                      }}>
                        Page {currentPage}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDrawerPhase('closed') }}
                      style={{
                        width: '26px', height: '26px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', background: 'transparent', cursor: 'pointer', color: C.secondary,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>

                  {/* Chat history (only in full phase) */}
                  <div
                    ref={pageChatBottomRef}
                    style={{
                      flex: 1, overflowY: 'auto', padding: '12px 14px',
                      display: 'flex', flexDirection: 'column', gap: '8px',
                      opacity: drawerPhase === 'full' ? 1 : 0,
                      transition: 'opacity 0.22s ease',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {pageChat.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '86%', padding: '7px 11px', fontSize: '13px', lineHeight: '1.55',
                          borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          background: msg.role === 'user' ? C.fg : C.sidebar,
                          color: msg.role === 'user' ? C.white : C.fg,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {pageChatStreaming && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{
                          maxWidth: '86%', padding: '7px 11px', fontSize: '13px', lineHeight: '1.55',
                          borderRadius: '12px 12px 12px 2px', background: C.sidebar, color: C.fg, whiteSpace: 'pre-wrap',
                        }}>
                          {pageChatStreamingText
                            ? <>{pageChatStreamingText}<span style={{ opacity: 0.5 }}>▋</span></>
                            : <span style={{ opacity: 0.5 }}>正在思考<span style={{ display: 'inline-block', animation: 'ellipsis 1.2s steps(3, end) infinite', width: '1.5em', overflow: 'hidden', verticalAlign: 'bottom' }}>...</span></span>
                          }
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input area */}
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '10px 14px 14px',
                      opacity: drawerPhase !== 'closed' ? 1 : 0,
                      transform: drawerPhase !== 'closed' ? 'translateY(0)' : 'translateY(5px)',
                      transition: 'opacity 0.2s ease 0.14s, transform 0.2s ease 0.14s',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Context tag */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      background: C.sidebar, border: `1px solid ${C.divider}`,
                      borderRadius: '5px', padding: '2px 7px', fontSize: '11px', color: C.secondary,
                      marginBottom: '7px',
                    }}>
                      📄 Page {currentPage}
                    </div>

                    {/* Input box */}
                    <div style={{
                      border: `1.5px solid ${C.divider}`,
                      borderRadius: '10px',
                      padding: '8px 11px 6px',
                    }}>
                      <textarea
                        rows={1}
                        value={pageChatInput}
                        onChange={e => setPageChatInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            if (pageChatInput.trim()) {
                              setDrawerPhase('full')
                              handlePageChatSend()
                            }
                          }
                        }}
                        placeholder={t('notes_page_chat_placeholder')}
                        style={{
                          width: '100%', resize: 'none', border: 'none', outline: 'none',
                          background: 'transparent', fontSize: '13px', lineHeight: '1.5',
                          color: C.fg, fontFamily: 'inherit', maxHeight: '80px', overflowY: 'auto',
                          caretColor: '#798C00', display: 'block', minHeight: '34px',
                        }}
                      />

                      {/* Toolbar */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        paddingTop: '6px', borderTop: `1px solid ${C.divider}`, marginTop: '4px',
                      }}>
                        {/* Left: model picker */}
                        <div style={{ position: 'relative' }}>
                          <button
                            ref={drawerModelBtnRef}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDrawerModelDDOpen(v => !v) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                              color: C.secondary, background: C.sidebar, border: `1px solid ${C.divider}`,
                              cursor: 'pointer',
                            }}
                          >
                            {drawerModel}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>
                          {drawerModelDDOpen && (() => {
                            const rect = drawerModelBtnRef.current?.getBoundingClientRect()
                            return createPortal(
                              <div
                                onClick={e => e.stopPropagation()}
                                style={{
                                  position: 'fixed',
                                  bottom: rect ? window.innerHeight - rect.top + 6 : 'auto',
                                  left: rect ? rect.left : 0,
                                  width: '220px', background: C.white,
                                  borderRadius: '10px',
                                  boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
                                  padding: '5px 0', zIndex: 9999,
                                }}
                              >
                              {models.map((m, idx) => (
                                <div key={m.id}>
                                  {idx === 1 && <div style={{ height: '1px', background: C.divider, margin: '3px 0' }} />}
                                  <div
                                    style={{
                                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                      padding: '8px 12px', cursor: 'pointer',
                                    }}
                                    onClick={() => { setDrawerModel(m.id); setDrawerModelDDOpen(false) }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.sidebar}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                      <div style={{
                                        width: '20px', height: '20px', borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: m.cls === 'logo-qwen' || m.cls === 'logo-deepseek' || m.cls === 'logo-doubao' ? '9px' : '11px',
                                        fontWeight: '700', color: '#fff',
                                        background: m.cls === 'logo-auto'
                                          ? 'linear-gradient(135deg,#EAE9E0,#D0CFC5)'
                                          : m.cls === 'logo-claude' ? '#d97757'
                                          : m.cls === 'logo-qwen' ? '#5B8FF9'
                                          : m.cls === 'logo-deepseek' ? '#2563EB'
                                          : m.cls === 'logo-doubao' ? '#1DB954'
                                          : '#798C00',
                                        ...(m.cls === 'logo-auto' ? { color: '#798C00' } : {}),
                                      }}>
                                        {m.logo}
                                      </div>
                                      <span style={{ fontSize: '13px', color: C.fg }}>
                                        {m.label}
                                        {idx > 0 && (
                                          <span style={{
                                            fontSize: '10px', color: '#798C00',
                                            background: 'rgba(121,140,0,0.10)',
                                            borderRadius: '4px', padding: '1px 5px', marginLeft: '5px', fontWeight: '500',
                                          }}>Beta</span>
                                        )}
                                      </span>
                                    </div>
                                    {drawerModel === m.id && (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#798C00" strokeWidth="2.5" strokeLinecap="round">
                                        <polyline points="20 6 9 17 4 12"/>
                                      </svg>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            , document.body)
                          })()}
                        </div>

                        {/* Right: mic + send */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button type="button" style={{
                            width: '26px', height: '26px', borderRadius: '5px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted,
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <rect x="9" y="2" width="6" height="11" rx="3"/>
                              <path d="M5 10a7 7 0 0 0 14 0"/>
                              <line x1="12" y1="19" x2="12" y2="22"/>
                              <line x1="9" y1="22" x2="15" y2="22"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (pageChatInput.trim()) {
                                setDrawerPhase('full')
                                handlePageChatSend()
                              }
                            }}
                            disabled={pageChatStreaming || !pageChatInput.trim()}
                            style={{
                              width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                              background: pageChatStreaming || !pageChatInput.trim() ? C.muted : '#798C00',
                              color: C.white,
                              cursor: pageChatStreaming || !pageChatInput.trim() ? 'default' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'background 0.15s',
                            }}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Collapsed capsule — bottom bar, always in flow */}
                <div
                  style={{
                    flexShrink: 0,
                    borderTop: `1px solid ${C.divider}`,
                    padding: '10px 14px 16px',
                    opacity: drawerPhase === 'closed' ? 1 : 0,
                    pointerEvents: drawerPhase === 'closed' ? 'auto' : 'none',
                    transition: 'opacity 0.15s ease',
                  }}
                >
                  <div
                    onClick={() => setDrawerPhase('input')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '9px',
                      background: C.sidebar, border: `1px solid ${C.divider}`,
                      borderRadius: '14px', padding: '9px 14px', cursor: 'text',
                    }}
                  >
                    <div style={{
                      width: '17px', height: '17px', borderRadius: '50%', flexShrink: 0,
                      background: 'conic-gradient(from 0deg, #798C00, #b5c833, #798C00)',
                    }} />
                    <span style={{ fontSize: '13px', color: C.muted }}>Ask AI about this page…</span>
                  </div>
                </div>
              </>
            )
          })()}
        </aside>
      </div>

      {/* Global Footer */}
      <footer
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          height: '40px',
          background: C.bg,
          borderTop: '1px solid rgba(175,179,176,0.1)',
          color: '#D0CFC5',
          fontSize: '11px',
        }}
      >
        LiberStudy · {new Date().getFullYear()}
      </footer>

      {/* Audio player (hidden, driven by timestamp clicks) */}
      {session?.audio_url && (
        <audio ref={audioRef} src={`${API_BASE}${session.audio_url}`} preload="metadata" style={{ display: 'none' }} />
      )}

      {/* Processing progress bar — bottom-left, shown while pipeline is running */}
      {pagePhase === 'processing' && session && (() => {
        const progress = (session as SessionData & { progress?: { step: string; percent: number } | null }).progress
        const stepLabels: Record<string, string> = {
          converting: '音频处理中',
          transcribing: '转录中',
          aligning: '语义对齐中',
          generating: '生成笔记中',
          parsing_ppt: 'PPT 解析中',
          uploading: '上传中',
        }
        const label = progress ? (stepLabels[progress.step] ?? progress.step) : '处理中'
        const percent = progress?.percent ?? 0
        return (
          <div style={{
            position: 'fixed', bottom: '20px', left: '20px', zIndex: 60,
            background: 'rgba(41,41,41,0.92)', borderRadius: '10px',
            padding: '10px 14px', minWidth: '200px', backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: '#D0CFC5', fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: '11px', color: '#72726E' }}>{percent}%</span>
            </div>
            <div style={{ height: '3px', background: 'rgba(255,255,255,0.12)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: '#2D6A4F', borderRadius: '2px', transition: 'width 0.4s ease' }} />
            </div>
            {pipelineSyncLagging && (
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#AFB3B0' }}>
                网络波动，正在重试同步状态...
              </div>
            )}
          </div>
        )
      })()}

      {/* Upload overlay — shown when no session yet */}
      {pagePhase === 'upload' && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 50, backgroundColor: 'rgba(20, 24, 22, 0.6)' }}>
          <NewClassModal onUploadSuccess={handleUploadSuccess} onClose={() => navigate('/')} />
        </div>
      )}
    </div>
  )
}
