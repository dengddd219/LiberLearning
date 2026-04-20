import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import { useState, useEffect, useCallback, useRef } from 'react'
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
import type { PageChatMessage, AlignedSegment, SessionData } from '../lib/notesTypes'
import { C, FONT_SERIF, injectNoteStyles, withApiBase } from '../lib/notesUtils'
import { loadMyNote, loadPageChat, saveMyNote, savePageChat } from '../lib/notesDb'
import NotesPanel from '../components/notes/NotesPanel'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

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

  // Drawer phase: 'closed' | 'input' | 'full'
  const [drawerPhase, setDrawerPhase] = useState<'closed' | 'input' | 'full'>('closed')
  const [drawerHeightPx, setDrawerHeightPx] = useState<number | null>(null) // null = use default %
  const [drawerModel, setDrawerModel] = useState('Auto')
  const [drawerModelDDOpen, setDrawerModelDDOpen] = useState(false)
  const firstSlidePerfRef = useRef<{ startMs: number; reported: boolean; sessionId: string }>({
    startMs: 0,
    reported: false,
    sessionId: '',
  })

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
        <NotesPanel
          sessionId={activeSessionId ?? ''}
          currentPage={currentPage}
          pageData={currentPageData ?? null}
          notesPanelWidth={notesPanelWidth}
          noteMode={noteMode}
          onNoteModeChange={(mode) => {
            setNoteMode(mode)
            if (mode === 'transcript') setTranscriptJustDone(false)
          }}
          getMyNoteText={getMyNoteText}
          onMyNoteChange={handleMyNoteChange}
          myNoteExpandState={getMyNoteExpandState(currentPage)}
          onExpandMyNote={handleExpandMyNote}
          annotations={annotationsForPage(currentPage).filter((annotation) => annotation.text.trim())}
          expandedBullets={expandedBullets.get(currentPage) ?? new Set()}
          animatedBullets={animatedBullets.get(currentPage) ?? new Set()}
          onBulletToggle={(bulletIndex) => {
            setExpandedBullets((prev) => {
              const next = new Map(prev)
              const pageSet = new Set(next.get(currentPage) ?? [])
              if (pageSet.has(bulletIndex)) pageSet.delete(bulletIndex)
              else pageSet.add(bulletIndex)
              next.set(currentPage, pageSet)
              return next
            })
          }}
          onBulletAnimationDone={(bulletIndex) => {
            setAnimatedBullets((prev) => {
              const next = new Map(prev)
              const pageSet = new Set(next.get(currentPage) ?? [])
              pageSet.add(bulletIndex)
              next.set(currentPage, pageSet)
              return next
            })
          }}
          pageRevealed={revealedPages.has(currentPage)}
          onTimestampClick={handleTimestampClick}
          onSegmentPlay={handleSegmentPlay}
          playingSegIdx={playingSegIdx}
          playProgress={playProgress}
          transcriptClickCount={transcriptClickCount}
          translationEnabled={translationEnabled}
          translatedPage={translatedTexts.get(currentPage)}
          retrying={retrying}
          onRetryPage={handleRetryPage}
          pageChat={pageChatMessages.get(currentPage) ?? []}
          pageChatInput={pageChatInput}
          onPageChatInputChange={setPageChatInput}
          pageChatStreaming={pageChatStreaming}
          pageChatStreamingText={pageChatStreamingText}
          onPageChatSend={handlePageChatSend}
          drawerPhase={drawerPhase}
          onDrawerPhaseChange={setDrawerPhase}
          drawerHeightPx={drawerHeightPx}
          onDrawerHeightChange={setDrawerHeightPx}
          drawerModel={drawerModel}
          onDrawerModelChange={setDrawerModel}
          drawerModelDDOpen={drawerModelDDOpen}
          onDrawerModelDDOpenChange={setDrawerModelDDOpen}
          pagePhase={pagePhase}
          transcriptJustDone={transcriptJustDone}
          aiNotesJustDone={aiNotesJustDone}
          hasAnyAlignedSegments={session?.pages?.some((page) => (page.aligned_segments?.length ?? 0) > 0) ?? false}
          hasPendingAiNotes={session?.pages?.some((page) => !page.passive_notes?.bullets?.length) ?? false}
          draftOutlineLines={draftOutlineLines}
        />
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
