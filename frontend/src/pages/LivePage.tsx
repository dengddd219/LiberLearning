import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CanvasToolbar from '../components/CanvasToolbar'
import HighlightLayer from '../components/HighlightLayer'
import TextAnnotationLayer from '../components/TextAnnotationLayer'
import NotesPanel from '../components/notes/NotesPanel'
import { useHighlights } from '../hooks/useHighlights'
import { useTextAnnotations } from '../hooks/useTextAnnotations'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import {
  askBullet,
  createLiveSession,
  generateMyNote,
  getSession,
  liveAsk,
  retryPage,
  updateLiveSessionState,
  uploadFiles,
  uploadPpt,
} from '../lib/api'
import { loadMyNote, loadPageChat, saveMyNote, savePageChat } from '../lib/notesDb'
import type { AlignedSegment, PageChatMessage, SessionData } from '../lib/notesTypes'
import { C, FONT_SERIF, injectNoteStyles, withApiBase } from '../lib/notesUtils'
import type { PptPage } from '../types/session'

type WsStatus = 'idle' | 'connecting' | 'live' | 'paused' | 'stopped' | 'processing' | 'done'
type NoteMode = 'my' | 'ai' | 'transcript'
type DrawerPhase = 'closed' | 'input' | 'full'
type MyNoteExpandState = { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }
type TranslatedPageTexts = {
  bullets: string[]
  aiComments: (string | null)[]
  supplement: string | null
  aiExpansion: string | null
}

type LiveTranscriptSegment = {
  text: string
  timestamp: number
  pageNum: number
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const WS_BASE =
  API_BASE.replace(/^http/, 'ws') ||
  (typeof window !== 'undefined'
    ? import.meta.env.DEV
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000`
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

// 把 "MM:SS" 时间字符串转为秒数
function parseTimeSec(t: string): number {
  const [mm, ss] = t.split(':').map(Number)
  return (mm ?? 0) * 60 + (ss ?? 0)
}

// 解析 bullet 行里的时间戳：`- [MM:SS–MM:SS] 内容` → { bulletText, startSec, endSec }
function parseBulletLine(line: string): { bulletText: string; startSec: number | null; endSec: number | null } {
  const tsMatch = line.slice(2).match(/^\[(\d{2}:\d{2})[–\-](\d{2}:\d{2})\]\s*(.+)/)
  if (tsMatch) {
    return {
      startSec: parseTimeSec(tsMatch[1]),
      endSec: parseTimeSec(tsMatch[2]),
      bulletText: tsMatch[3].trim(),
    }
  }
  return { bulletText: line.slice(2), startSec: null, endSec: null }
}

// 预处理每行，提前标注其所属 page
type RenderedLine =
  | { kind: 'h3'; text: string; key: number }
  | { kind: 'bullet'; bulletText: string; startSec: number | null; endSec: number | null; page: number | null; key: number }
  | { kind: 'blank'; key: number }
  | { kind: 'p'; text: string; key: number }

function preprocessLines(text: string): RenderedLine[] {
  const lines = text.split('\n')
  const result: RenderedLine[] = []
  let currentPage: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const pageMatch = line.match(/^##\s*第(\d+)页/)
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10)
      result.push({ kind: 'h3', text: line.replace(/^##\s*/, ''), key: i })
    } else if (line.startsWith('## ')) {
      result.push({ kind: 'h3', text: line.replace(/^##\s*/, ''), key: i })
    } else if (line.startsWith('- ')) {
      const { bulletText, startSec, endSec } = parseBulletLine(line)
      result.push({ kind: 'bullet', bulletText, startSec, endSec, page: currentPage, key: i })
    } else if (!line.trim()) {
      result.push({ kind: 'blank', key: i })
    } else {
      result.push({ kind: 'p', text: line, key: i })
    }
  }
  return result
}

function AiNotesRenderer({
  text,
  sessionId,
  onDetailedNote,
}: {
  text: string
  sessionId: string | null
  onDetailedNote: (line: string, pageNum: number | null, startSec: number | null, endSec: number | null) => void
}) {
  const renderedLines = preprocessLines(text)

  return (
    <div style={{ lineHeight: 1.8 }}>
      {renderedLines.map((item) => {
        if (item.kind === 'h3') {
          return (
            <h3 key={item.key} style={{ fontSize: 15, fontWeight: 700, marginTop: 20, marginBottom: 8, color: '#2F3331' }}>
              {item.text}
            </h3>
          )
        }
        if (item.kind === 'bullet') {
          return (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 6,
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
                const icon = e.currentTarget.querySelector<HTMLElement>('.detail-icon')
                if (icon) icon.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                const icon = e.currentTarget.querySelector<HTMLElement>('.detail-icon')
                if (icon) icon.style.opacity = '0'
              }}
            >
              <span style={{ color: '#798C00', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>•</span>
              <span style={{ flex: 1, color: '#2F3331', fontSize: 14 }}>
                {item.startSec !== null && (
                  <span style={{ fontSize: 10, color: '#AFB3B0', marginRight: 6 }}>
                    {`[${Math.floor(item.startSec/60).toString().padStart(2,'0')}:${(item.startSec%60).toString().padStart(2,'0')}–${Math.floor((item.endSec??0)/60).toString().padStart(2,'0')}:${((item.endSec??0)%60).toString().padStart(2,'0')}]`}
                  </span>
                )}
                {item.bulletText}
              </span>
              {sessionId && (
                <button
                  type="button"
                  className="detail-icon"
                  onClick={() => onDetailedNote(item.bulletText, item.page, item.startSec, item.endSec)}
                  style={{
                    opacity: 0,
                    transition: 'opacity 0.15s',
                    flexShrink: 0,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: 4,
                    color: '#798C00',
                    fontSize: 14,
                  }}
                  title="查看详细解释"
                >
                  🔍
                </button>
              )}
            </div>
          )
        }
        if (item.kind === 'blank') return <div key={item.key} style={{ height: 8 }} />
        return <p key={item.key} style={{ color: '#2F3331', fontSize: 14, marginBottom: 4 }}>{(item as { text: string }).text}</p>
      })}
    </div>
  )
}

function buildDraftOutlineLines(pptText: string): string[] {
  return pptText
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
}

function normalizePanelWsStatus(wsStatus: WsStatus): 'idle' | 'connecting' | 'live' | 'stopped' {
  if (wsStatus === 'processing' || wsStatus === 'done' || wsStatus === 'stopped') return 'stopped'
  if (wsStatus === 'paused') return 'live'
  return wsStatus
}

const LIVE_PPT_DRAFT_PREFIX = 'liberstudy:live-ppt-draft:'

function loadLivePptDraft(sessionId: string): { pptId: string | null; pptFilename: string | null; pages: PptPage[] } | null {
  try {
    const raw = localStorage.getItem(`${LIVE_PPT_DRAFT_PREFIX}${sessionId}`)
    if (!raw) return null
    return JSON.parse(raw) as { pptId: string | null; pptFilename: string | null; pages: PptPage[] }
  } catch {
    return null
  }
}

function saveLivePptDraft(sessionId: string, payload: { pptId: string | null; pptFilename: string | null; pages: PptPage[] }) {
  localStorage.setItem(`${LIVE_PPT_DRAFT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export default function LivePage() {
  injectNoteStyles()

  const [searchParams] = useSearchParams()
  const { openTab } = useTabs()
  const {
    enabled: translationEnabled,
    translate,
    targetLang,
    setEnabled: setTranslationEnabled,
    setTargetLang,
    t,
  } = useTranslation()

  const requestedSessionId = searchParams.get('session') || searchParams.get('sessionId')
  const createNewSession = searchParams.get('new') === '1' || !requestedSessionId
  // 用 ref 固定初始值，防止 searchParams 变化导致 effect 重跑、cancelled=true
  const createNewSessionRef = useRef(createNewSession)
  const requestedSessionIdRef = useRef(requestedSessionId)

  const [draftSessionId, setDraftSessionId] = useState<string | null>(requestedSessionId && createNewSession ? null : requestedSessionId)
  const [processedSessionId, setProcessedSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [initializingSession, setInitializingSession] = useState(createNewSession || !!requestedSessionId)
  const [error, setError] = useState<string | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  const [wsStatus, setWsStatus] = useState<WsStatus>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const processingPollTimeoutRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)

  const [subtitleLines, setSubtitleLines] = useState<string[]>([])
  const [subtitleVisible, setSubtitleVisible] = useState(false)
  const subtitleHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [liveTranscriptSegments, setLiveTranscriptSegments] = useState<LiveTranscriptSegment[]>([])

  const [pptFile, setPptFile] = useState<File | null>(null)
  const [pptId, setPptId] = useState<string | null>(null)
  const [pptPages, setPptPages] = useState<PptPage[]>([])
  const [pptUploading, setPptUploading] = useState(false)
  const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
  const [localPdfPageCount, setLocalPdfPageCount] = useState(0)
  const [processingProgress, setProcessingProgress] = useState(0)

  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<NoteMode>('my')
  const [navVisible, setNavVisible] = useState(true)
  const [notesPanelWidth, setNotesPanelWidth] = useState(500)
  const [activeTool, setActiveTool] = useState<'none' | 'highlight' | 'eraser' | 'text'>('none')
  const [highlightColor, setHighlightColor] = useState('#FAFF00')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageInputValue, setPageInputValue] = useState('1')
  const [popoverOpen, setPopoverOpen] = useState(false)

  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const myNoteSaveTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const [myNoteExpandStates, setMyNoteExpandStates] = useState<Map<number, MyNoteExpandState>>(new Map())
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [translatedTexts, setTranslatedTexts] = useState<Map<number, TranslatedPageTexts>>(new Map())

  const [pageChatMessages, setPageChatMessages] = useState<Map<number, PageChatMessage[]>>(new Map())
  const [pageChatInput, setPageChatInput] = useState('')
  const [pageChatStreaming, setPageChatStreaming] = useState(false)
  const [pageChatStreamingText, setPageChatStreamingText] = useState('')
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>('closed')
  const [drawerHeightPx, setDrawerHeightPx] = useState<number | null>(null)
  const [drawerModel, setDrawerModel] = useState('Auto')
  const [drawerModelDDOpen, setDrawerModelDDOpen] = useState(false)

  const [playingSegIdx, setPlayingSegIdx] = useState<number | null>(null)
  const [playProgress, setPlayProgress] = useState(0)
  const [transcriptClickCount, setTranscriptClickCount] = useState<number>(() => {
    return parseInt(localStorage.getItem('liberstudy_transcript_clicks') ?? '0', 10)
  })
  const [retrying, setRetrying] = useState<number | null>(null)
  const [resolvedSlideUrl, setResolvedSlideUrl] = useState<string | null>(null)

  const [liveBackendSessionId, setLiveBackendSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<
    'idle' | 'live' | 'stopped' | 'finalizing' | 'done'
  >('idle')
  const [postClassTranscript, setPostClassTranscript] = useState<
    Array<{ text: string; page: number | null; seq: number }>
  >([])
  const [allMyNotesList, setAllMyNotesList] = useState<{ page: number; text: string }[]>([])
  const [aiNotesText, setAiNotesText] = useState('')
  const [aiNotesStreaming, setAiNotesStreaming] = useState(false)
  const [detailedNoteOpen, setDetailedNoteOpen] = useState(false)
  const [detailedNoteText, setDetailedNoteText] = useState('')
  const [detailedNoteStreaming, setDetailedNoteStreaming] = useState(false)
  const [detailedNoteSource, setDetailedNoteSource] = useState('')
  const [detailedNotePageNum, setDetailedNotePageNum] = useState<number | null>(null)
  const [notesFullscreen, setNotesFullscreen] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const segStartRef = useRef<number | null>(null)
  const segEndRef = useRef<number | null>(null)
  const segTimeUpdateRef = useRef<(() => void) | null>(null)
  const prevPageRef = useRef<number>(1)
  const currentPageRef = useRef(currentPage)
  const totalPagesRef = useRef(1)
  const wheelTimeoutRef = useRef<number | null>(null)
  const wheelAccumRef = useRef(0)
  const pageContainerRef = useRef<HTMLDivElement | null>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(800)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(500)
  const drawerPrevPageRef = useRef(currentPage)

  const notesSessionId = draftSessionId ?? (session?.status === 'live' ? session.session_id : null) ?? requestedSessionId ?? null
  const slideSessionId =
    processedSessionId ?? (session && session.status !== 'live' ? session.session_id : null)
  const panelSessionId = processedSessionId ?? notesSessionId ?? 'live-unbound'
  const { addHighlight, removeHighlight, highlightsForPage } = useHighlights(notesSessionId ?? '')
  const { addAnnotation, updateAnnotation, removeAnnotation, annotationsForPage } = useTextAnnotations(notesSessionId ?? '')

  const pageSource = session?.pages && session.pages.length > 0 ? session.pages : pptPages
  const activePageData = session?.pages.find((page) => page.page_num === currentPage) ?? null
  const hasPpt = pageSource.length > 0 || !!localPdfUrl
  const draftPage = pptPages.find((page) => page.page_num === currentPage) ?? null
  const totalPages = pageSource.length
  const isLiveMode = wsStatus !== 'done'
  const pagePhase: 'upload' | 'processing' | 'ready' = wsStatus === 'processing' ? 'processing' : 'ready'

  // 全屏笔记由用户手动点按钮控制，不自动切换

  const getMyNoteText = useCallback((pageNum: number) => myNoteTexts.get(pageNum) ?? '', [myNoteTexts])

  const getMyNoteExpandState = useCallback((pageNum: number): MyNoteExpandState => {
    return myNoteExpandStates.get(pageNum) ?? { userNote: '', aiText: '', status: 'idle' }
  }, [myNoteExpandStates])

  const patchMyNoteExpandState = useCallback((pageNum: number, patch: Partial<MyNoteExpandState>) => {
    setMyNoteExpandStates((prev) => {
      const current = prev.get(pageNum) ?? { userNote: '', aiText: '', status: 'idle' as const }
      const next = new Map(prev)
      next.set(pageNum, { ...current, ...patch })
      return next
    })
  }, [])

  const clearProcessingPoll = useCallback(() => {
    if (processingPollTimeoutRef.current !== null) {
      window.clearTimeout(processingPollTimeoutRef.current)
      processingPollTimeoutRef.current = null
    }
  }, [])

  const stopSegmentPlayback = useCallback(() => {
    const audio = audioRef.current
    if (audio && segTimeUpdateRef.current) {
      audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
    }
    audio?.pause()
    segTimeUpdateRef.current = null
    segStartRef.current = null
    segEndRef.current = null
    setPlayingSegIdx(null)
    setPlayProgress(0)
  }, [])

  const cleanupRecordingResources = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }

    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // ignore recorder shutdown errors
      }
    }

    const stream = mediaStreamRef.current ?? recorder?.stream ?? null
    mediaStreamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const flushPendingMyNotes = useCallback(async () => {
    const timers = myNoteSaveTimerRef.current
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()

    if (!notesSessionId) return
    await Promise.all(
      Array.from(myNoteTexts.entries()).map(([pageNum, text]) => saveMyNote(notesSessionId, pageNum, text)),
    )
  }, [myNoteTexts, notesSessionId])

  const applySessionData = useCallback((sessionId: string, data: SessionData, options?: { keepCurrentPage?: boolean }) => {
    if (data.status === 'live') {
      setDraftSessionId(sessionId)
    } else {
      setProcessedSessionId(sessionId)
    }

    setSession(data)
    setError(null)

    if (data.pages.length > 0) {
      setCurrentPage((prev) => {
        if (options?.keepCurrentPage && data.pages.some((page) => page.page_num === prev)) {
          return prev
        }
        return data.pages[0].page_num
      })
    }

    if (data.progress) {
      setProcessingProgress(data.progress.percent)
    }

    if (data.status === 'processing') {
      setWsStatus('processing')
      setNoteMode('transcript')
    } else if (data.status === 'ready' || data.status === 'partial_ready') {
      setWsStatus('done')
      setNoteMode('ai')
    } else {
      setWsStatus('idle')
      setNoteMode('my')
    }
  }, [])

  const pollProcessedSession = useCallback(async (sessionId: string) => {
    clearProcessingPoll()

    try {
      const data = await getSession(sessionId) as SessionData
      if (unmountedRef.current) return

      if (data.status === 'error') {
        setError('处理失败，请稍后重试')
        setWsStatus('stopped')
        return
      }

      applySessionData(sessionId, data, { keepCurrentPage: true })

      if (data.status === 'ready' || data.status === 'partial_ready') {
        return
      }

      processingPollTimeoutRef.current = window.setTimeout(() => {
        void pollProcessedSession(sessionId)
      }, 3000)
    } catch (pollError) {
      if (!unmountedRef.current) {
        setError(pollError instanceof Error ? pollError.message : '处理状态同步失败')
        setWsStatus('stopped')
      }
    }
  }, [applySessionData, clearProcessingPoll])

  const translatePage = useCallback(async (pageNum: number) => {
    if (!session || translatedTexts.has(pageNum)) return

    const page = session.pages.find((item) => item.page_num === pageNum)
    if (!page) return

    const bullets = page.passive_notes?.bullets ?? []
    const supplement = page.page_supplement?.content ?? null
    const aiExpansion = page.active_notes?.ai_expansion ?? null

    const [translatedBullets, translatedAiComments, translatedSupplement, translatedAiExpansion] =
      await Promise.all([
        Promise.all(bullets.map((bullet) => translate(bullet.ppt_text))),
        Promise.all(bullets.map((bullet) => (bullet.ai_comment ? translate(bullet.ai_comment) : Promise.resolve(null)))),
        supplement ? translate(supplement) : Promise.resolve(null),
        aiExpansion ? translate(aiExpansion) : Promise.resolve(null),
      ])

    if (unmountedRef.current) return

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
  }, [session, translate, translatedTexts])

  const handleMyNoteChange = useCallback((pageNum: number, text: string) => {
    setMyNoteTexts((prev) => {
      const next = new Map(prev)
      next.set(pageNum, text)
      return next
    })

    const existingTimer = myNoteSaveTimerRef.current.get(pageNum)
    if (existingTimer) clearTimeout(existingTimer)

    const nextTimer = setTimeout(() => {
      if (!notesSessionId) return
      void saveMyNote(notesSessionId, pageNum, text)
      myNoteSaveTimerRef.current.delete(pageNum)
    }, 500)

    myNoteSaveTimerRef.current.set(pageNum, nextTimer)
  }, [notesSessionId])

  const handlePageChatSend = useCallback(async () => {
    const question = pageChatInput.trim()
    if (!question || pageChatStreaming) return

    const userMessage: PageChatMessage = {
      role: 'user',
      content: question,
      timestamp: Date.now(),
    }

    const currentMessages = pageChatMessages.get(currentPage) ?? []
    const nextMessages = [...currentMessages, userMessage]
    setPageChatMessages((prev) => {
      const next = new Map(prev)
      next.set(currentPage, nextMessages)
      return next
    })
    setPageChatInput('')

    if (!processedSessionId) {
      setPageChatStreaming(true)
      setPageChatStreamingText('')

      try {
        const latestTimestamp = liveTranscriptSegments[liveTranscriptSegments.length - 1]?.timestamp ?? 0
        const recentTranscript = liveTranscriptSegments.filter((segment) => latestTimestamp - segment.timestamp <= 180)
        const currentAnnotations = annotationsForPage(currentPage)
          .map((annotation) => annotation.text.trim())
          .filter(Boolean)

        let full = ''
        await liveAsk({
          session_id: notesSessionId ?? 'live-unbound',
          question,
          current_page: currentPage,
          current_page_ppt_text: activePageData?.ppt_text ?? draftPage?.ppt_text ?? '',
          current_page_notes: getMyNoteText(currentPage),
          current_page_annotations: currentAnnotations,
          recent_transcript: recentTranscript.map((segment) => ({
            text: segment.text,
            timestamp: segment.timestamp,
            page_num: segment.pageNum,
          })),
          model: drawerModel,
        }, (chunk) => {
          full += chunk
          setPageChatStreamingText(full)
        })

        const aiMessage: PageChatMessage = {
          role: 'ai',
          content: full || '我暂时没有拿到足够的实时转录，只能等再多一点上下文后继续回答。',
          timestamp: Date.now(),
        }
        const messagesWithReply = [...nextMessages, aiMessage]
        setPageChatMessages((prev) => {
          const next = new Map(prev)
          next.set(currentPage, messagesWithReply)
          return next
        })
        if (notesSessionId) await savePageChat(notesSessionId, currentPage, messagesWithReply)
      } catch (chatError) {
        const aiMessage: PageChatMessage = {
          role: 'ai',
          content: `出错了：${chatError instanceof Error ? chatError.message : '未知错误'}`,
          timestamp: Date.now(),
        }
        const messagesWithReply = [...nextMessages, aiMessage]
        setPageChatMessages((prev) => {
          const next = new Map(prev)
          next.set(currentPage, messagesWithReply)
          return next
        })
        if (notesSessionId) await savePageChat(notesSessionId, currentPage, messagesWithReply)
      } finally {
        setPageChatStreaming(false)
        setPageChatStreamingText('')
      }
      return
    }

    setPageChatStreaming(true)
    setPageChatStreamingText('')

    try {
      const pageData = session?.pages.find((page) => page.page_num === currentPage)
      const context = [
        getMyNoteText(currentPage) ? `用户笔记：${getMyNoteText(currentPage)}` : '',
        pageData?.passive_notes?.bullets?.map((bullet) => bullet.ppt_text).join('\n') ?? '',
      ].filter(Boolean).join('\n\n')

      let full = ''
      await askBullet(
        processedSessionId,
        currentPage,
        -1,
        context,
        '',
        question,
        drawerModel === 'Auto' ? '中转站' : drawerModel,
        (chunk) => {
          full += chunk
          setPageChatStreamingText(full)
        },
      )

      const aiMessage: PageChatMessage = {
        role: 'ai',
        content: full,
        timestamp: Date.now(),
      }
      const messagesWithReply = [...nextMessages, aiMessage]
      setPageChatMessages((prev) => {
        const next = new Map(prev)
        next.set(currentPage, messagesWithReply)
        return next
      })
      if (notesSessionId) await savePageChat(notesSessionId, currentPage, messagesWithReply)
    } catch (chatError) {
      const aiMessage: PageChatMessage = {
        role: 'ai',
        content: `出错了：${chatError instanceof Error ? chatError.message : '未知错误'}`,
        timestamp: Date.now(),
      }
      const messagesWithReply = [...nextMessages, aiMessage]
      setPageChatMessages((prev) => {
        const next = new Map(prev)
        next.set(currentPage, messagesWithReply)
        return next
      })
      if (notesSessionId) await savePageChat(notesSessionId, currentPage, messagesWithReply)
    } finally {
      setPageChatStreaming(false)
      setPageChatStreamingText('')
    }
  }, [
    currentPage,
    drawerModel,
    getMyNoteText,
    draftPage?.ppt_text,
    activePageData?.ppt_text,
    annotationsForPage,
    liveTranscriptSegments,
    notesSessionId,
    pageChatInput,
    pageChatMessages,
    pageChatStreaming,
    processedSessionId,
    session,
  ])

  const handleExpandMyNote = useCallback(async (pageNum: number) => {
    if (!processedSessionId) return

    const userNote = myNoteTexts.get(pageNum) ?? ''
    if (!userNote.trim()) return

    const pptText = session?.pages.find((page) => page.page_num === pageNum)?.ppt_text ?? ''
    patchMyNoteExpandState(pageNum, { userNote, aiText: '', status: 'expanding' })

    try {
      await generateMyNote(processedSessionId, pageNum, userNote, pptText, '中转站', (chunk) => {
        setMyNoteExpandStates((prev) => {
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
  }, [myNoteTexts, patchMyNoteExpandState, processedSessionId, session])

  const handleRetryPage = useCallback(async (pageNum: number) => {
    if (!processedSessionId || retrying !== null) return

    setRetrying(pageNum)
    try {
      await retryPage(processedSessionId, pageNum)
      const data = await getSession(processedSessionId)
      setSession(data as SessionData)
    } finally {
      setRetrying(null)
    }
  }, [processedSessionId, retrying])

  const handleTimestampClick = useCallback((seconds: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = seconds
    void audioRef.current.play()
  }, [])

  const handleSegmentPlay = useCallback((segment: AlignedSegment, index: number) => {
    const audio = audioRef.current
    if (!audio) return

    if (playingSegIdx === index) {
      stopSegmentPlayback()
      return
    }

    if (segTimeUpdateRef.current) {
      audio.removeEventListener('timeupdate', segTimeUpdateRef.current)
      segTimeUpdateRef.current = null
    }

    setTranscriptClickCount((prev) => {
      const next = Math.min(prev + 1, 3)
      localStorage.setItem('liberstudy_transcript_clicks', String(next))
      return next
    })

    segStartRef.current = segment.start
    segEndRef.current = segment.end
    setPlayingSegIdx(index)
    setPlayProgress(0)
    audio.currentTime = segment.start
    void audio.play()

    const onTimeUpdate = () => {
      const start = segStartRef.current ?? 0
      const end = segEndRef.current ?? 0
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
  }, [playingSegIdx, stopSegmentPlayback])

  const handleUploadPpt = useCallback(async (file: File) => {
    setPptFile(file)
    setInitError(null)

    // PDF：立刻本地显示，无需等后端
    if (file.name.toLowerCase().endsWith('.pdf')) {
      if (localPdfUrl) URL.revokeObjectURL(localPdfUrl)
      const objectUrl = URL.createObjectURL(file)
      setLocalPdfUrl(objectUrl)
      setCurrentPage(1)
      // 异步读页数
      import('pdfjs-dist').then(({ getDocument, GlobalWorkerOptions }) => {
        GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        getDocument(objectUrl).promise.then((doc) => setLocalPdfPageCount(doc.numPages)).catch(() => {})
      })
    }

    setPptUploading(true)
    try {
      const result = await uploadPpt(file)
      if (unmountedRef.current) return
      setPptId(result.ppt_id)
      setPptPages(result.pages)
      // 后端处理完成，释放本地 PDF objectURL
      setLocalPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
      setCurrentPage(1)
      setNavVisible(true)
      if (notesSessionId) {
        saveLivePptDraft(notesSessionId, {
          pptId: result.ppt_id,
          pptFilename: file.name,
          pages: result.pages,
        })
        void updateLiveSessionState(notesSessionId, {
          ppt_id: result.ppt_id,
          ppt_filename: file.name,
          pages: result.pages,
        })
      }
      setSession((prev) => {
        if (!prev || prev.status !== 'live') return prev
        return {
          ...prev,
          ppt_filename: file.name,
          pages: result.pages.map((page) => ({
            page_num: page.page_num,
            status: 'live',
            pdf_url: page.pdf_url ?? '',
            pdf_page_num: page.pdf_page_num,
            thumbnail_url: page.thumbnail_url ?? undefined,
            ppt_text: page.ppt_text,
            page_start_time: 0,
            page_end_time: 0,
            alignment_confidence: 0,
            active_notes: null,
            passive_notes: null,
            page_supplement: null,
            aligned_segments: [],
          })),
          progress: {
            step: prev.progress?.step ?? 'live',
            percent: prev.progress?.percent ?? 0,
            ppt_id: result.ppt_id,
            live_transcript: prev.progress?.live_transcript ?? [],
          },
        }
      })
    } catch (uploadError) {
      if (unmountedRef.current) return
      setInitError(uploadError instanceof Error ? uploadError.message : '上传 PPT 失败')
    } finally {
      if (!unmountedRef.current) setPptUploading(false)
    }
  }, [notesSessionId, localPdfUrl])

  const startRecording = useCallback(async () => {
    setWsStatus('connecting')
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      // 创建服务端 live session（如果尚未创建）
      let backendSid = liveBackendSessionId
      if (!backendSid) {
        try {
          const startRes = await fetch(`${API_BASE}/api/live/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ppt_id: pptId ?? null, language: 'zh' }),
          })
          const startData = await startRes.json() as { session_id: string; status: string }
          backendSid = startData.session_id
          setLiveBackendSessionId(backendSid)
        } catch {
          // session/start 失败不影响录音继续
        }
      }
      setSessionStatus('live')
      const ws = new WebSocket(
        backendSid
          ? `${WS_BASE}/api/ws/live-asr?session_id=${backendSid}`
          : `${WS_BASE}/api/ws/live-asr`
      )
      wsRef.current = ws

      ws.onopen = () => {
        setWsStatus('live')
        openTab({
          sessionId: draftSessionId ?? notesSessionId ?? 'live-unbound',
          label: 'Live Session',
          path: draftSessionId ? `/live?session=${draftSessionId}` : '/live?new=1',
        })

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
        const recorder = new MediaRecorder(stream, { mimeType })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) return
          audioChunksRef.current.push(event.data)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(event.data)
          }
        }

        recorder.start(250)
      }

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as
          | { error: string }
          | { text: string; is_final: boolean; timestamp: number }

        if ('error' in message) {
          setWsStatus('stopped')
          return
        }

        if (message.is_final) {
          setSubtitleLines((prev) => {
            const next = [...prev.filter((line) => line !== '…'), message.text]
            return next.length > 50 ? next.slice(next.length - 50) : next
          })
          setLiveTranscriptSegments((prev) => {
            const next = [...prev, { text: message.text, timestamp: message.timestamp, pageNum: currentPageRef.current }]
            return next.length > 200 ? next.slice(next.length - 200) : next
          })
          setSubtitleVisible(true)
          if (subtitleHideTimerRef.current) clearTimeout(subtitleHideTimerRef.current)
          subtitleHideTimerRef.current = setTimeout(() => setSubtitleVisible(false), 2500)
          return
        }

        setSubtitleLines((prev) => {
          const base = prev[prev.length - 1] === '…' ? prev.slice(0, -1) : prev
          return [...base, message.text || '…']
        })
        setSubtitleVisible(true)
        if (subtitleHideTimerRef.current) clearTimeout(subtitleHideTimerRef.current)
        subtitleHideTimerRef.current = setTimeout(() => setSubtitleVisible(false), 2500)
      }

      ws.onerror = () => setWsStatus('stopped')
      ws.onclose = () => {
        setWsStatus((prev) => (prev === 'processing' || prev === 'done' ? prev : 'stopped'))
      }
    } catch {
      cleanupRecordingResources()
      setWsStatus('idle')
    }
  }, [cleanupRecordingResources, draftSessionId, liveBackendSessionId, notesSessionId, openTab, pptId])

  const pauseRecording = useCallback(() => {
    mediaRecorderRef.current?.pause()
    setWsStatus('paused')
  }, [])

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume()
    setWsStatus('live')
  }, [])

  const stopRecording = useCallback(async () => {
    await flushPendingMyNotes()
    clearProcessingPoll()

    const recorder = mediaRecorderRef.current
    const stream = recorder?.stream

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }

    stream?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    wsRef.current?.close()
    setWsStatus('processing')
    setNoteMode('transcript')

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })

    try {
      const result = await uploadFiles(
        pptFile ?? undefined,
        audioFile,
        'zh',
        undefined,
        pptId ?? undefined,
        notesSessionId ?? undefined,
      )
      const nextSessionId = result.session_id
      setProcessedSessionId(nextSessionId)
      await pollProcessedSession(nextSessionId)
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : '结束录音后处理失败')
      setWsStatus('stopped')
    }
  }, [clearProcessingPoll, flushPendingMyNotes, notesSessionId, pollProcessedSession, pptFile, pptId])

  const handleEndClass = useCallback(async () => {
    await flushPendingMyNotes()
    clearProcessingPoll()

    const recorder = mediaRecorderRef.current
    const stream = recorder?.stream
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    stream?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    wsRef.current?.close()

    if (liveBackendSessionId) {
      try {
        await fetch(`${API_BASE}/api/live/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: liveBackendSessionId,
            ppt_pages: pptPages.length > 0
              ? pptPages.map(p => ({ page_num: p.page_num, ppt_text: p.ppt_text ?? '' }))
              : null,
          }),
        })
      } catch { /* ignore */ }
    }

    setWsStatus('stopped')
    setSessionStatus('stopped')
    setNoteMode('my')

    if (liveBackendSessionId) {
      try {
        const res = await fetch(`${API_BASE}/api/live/state/${liveBackendSessionId}`)
        const data = await res.json() as {
          transcript: Array<{ text: string; page: number | null; seq: number }>
        }
        setPostClassTranscript(data.transcript ?? [])
      } catch { /* ignore */ }
    }

    if (pptPages.length > 0) {
      const sid = notesSessionId ?? liveBackendSessionId ?? 'live-unbound'
      const collected = await Promise.all(
        pptPages.map(async (p) => ({
          page: p.page_num,
          text: await loadMyNote(sid, p.page_num).catch(() => ''),
        }))
      )
      setAllMyNotesList(collected)
    } else {
      const collected = Array.from(myNoteTexts.entries())
        .map(([pageNum, text]) => ({ page: pageNum, text }))
        .filter(item => item.text.trim())
      setAllMyNotesList(collected)
    }
  }, [
    clearProcessingPoll, flushPendingMyNotes, liveBackendSessionId,
    myNoteTexts, notesSessionId, pptPages,
  ])

  const handleGenerateNotes = useCallback(async () => {
    if (!liveBackendSessionId || sessionStatus !== 'stopped') return
    setSessionStatus('finalizing')
    setAiNotesText('')
    setAiNotesStreaming(true)
    setNoteMode('ai')

    const pptPagesPayload = pptPages.map(p => ({
      page_num: p.page_num,
      ppt_text: p.ppt_text ?? '',
    }))
    const myNotesPayload = allMyNotesList.filter(n => n.text.trim())

    try {
      const res = await fetch(`${API_BASE}/api/live/finalize-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: liveBackendSessionId,
          ppt_pages: pptPagesPayload.length > 0 ? pptPagesPayload : null,
          my_notes: myNotesPayload.length > 0 ? myNotesPayload : null,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error('finalize-stream failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let outerDone = false
      while (!outerDone) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { outerDone = true; break }
          let parsed: { text?: string; error?: string }
          try {
            parsed = JSON.parse(payload)
          } catch { continue }
          if (parsed.error) throw new Error(parsed.error)
          if (parsed.text) {
            setAiNotesText(prev => prev + parsed.text)
          }
        }
      }

      setSessionStatus('done')
      setAiNotesText(prev => {
        if (liveBackendSessionId) localStorage.setItem(`liberstudy:live-ai-notes:${liveBackendSessionId}`, prev)
        return prev
      })
    } catch {
      setSessionStatus('stopped')
    } finally {
      setAiNotesStreaming(false)
    }
  }, [liveBackendSessionId, sessionStatus, pptPages, allMyNotesList])

  const handleOpenDetailedNote = useCallback(async (
    lineText: string,
    pageNum: number | null,
    startSec: number | null,
    endSec: number | null,
  ) => {
    if (!liveBackendSessionId) return
    setDetailedNoteSource(lineText)
    setDetailedNotePageNum(pageNum)
    setDetailedNoteText('')
    setDetailedNoteStreaming(true)
    setDetailedNoteOpen(true)

    try {
      const res = await fetch(`${API_BASE}/api/live/detailed-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: liveBackendSessionId,
          line_text: lineText,
          page_num: pageNum,
          start_sec: startSec,
          end_sec: endSec,
        }),
      })

      if (!res.ok || !res.body) throw new Error('detailed-note failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let outerDone = false
      while (!outerDone) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { outerDone = true; break }
          let parsed: { text?: string; error?: string }
          try {
            parsed = JSON.parse(payload)
          } catch { continue }
          if (parsed.error) break
          if (parsed.text) setDetailedNoteText(prev => prev + parsed.text)
        }
      }
    } catch { /* ignore */ } finally {
      setDetailedNoteStreaming(false)
    }
  }, [liveBackendSessionId])

  const draftOutlineLines = buildDraftOutlineLines(activePageData?.ppt_text ?? draftPage?.ppt_text ?? '')

  const navPages: Array<{ page_num: number; thumbnail_url?: string | null; pdf_page_num: number }> =
    pageSource.length > 0
      ? pageSource.map((page) => ({
          page_num: page.page_num,
          thumbnail_url: page.thumbnail_url,
          pdf_page_num: page.pdf_page_num,
        }))
      : localPdfUrl && localPdfPageCount > 0
        ? Array.from({ length: localPdfPageCount }, (_, i) => ({
            page_num: i + 1,
            thumbnail_url: null,
            pdf_page_num: i + 1,
          }))
        : []

  const buildSessionSlideUrl = useCallback((pageNum: number): string | null => {
    return slideSessionId ? `${API_BASE}/api/sessions/${slideSessionId}/slide/${pageNum}.png` : null
  }, [slideSessionId])

  const primarySlideUrl =
    withApiBase(activePageData?.thumbnail_url) ??
    withApiBase(draftPage?.thumbnail_url) ??
    (activePageData ? buildSessionSlideUrl(activePageData.pdf_page_num) : buildSessionSlideUrl(currentPage))
  const fallbackSlideUrl = activePageData ? buildSessionSlideUrl(activePageData.pdf_page_num) : buildSessionSlideUrl(currentPage)

  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    if (!liveBackendSessionId || sessionStatus !== 'live') return
    fetch(`${API_BASE}/api/live/page-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: liveBackendSessionId,
        current_page: currentPage,
        timestamp_ms: Date.now(),
      }),
    }).catch(() => {})
  }, [currentPage, liveBackendSessionId, sessionStatus])

  useEffect(() => {
    totalPagesRef.current = Math.max(totalPages, 1)
  }, [totalPages])

  useEffect(() => {
    if (!canvasAreaRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(Math.max(400, entry.contentRect.width - 48))
      }
    })
    observer.observe(canvasAreaRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (drawerPrevPageRef.current !== currentPage) {
      setDrawerPhase('closed')
      setDrawerHeightPx(null)
      setPageChatInput('')
      drawerPrevPageRef.current = currentPage
    }
  }, [currentPage])

  useEffect(() => {
    let cancelled = false
    unmountedRef.current = false  // StrictMode re-mount 时重置
    setInitError(null)
    console.log('[LivePage] init effect run, createNewSession=', createNewSessionRef.current, 'requestedSessionId=', requestedSessionIdRef.current)

    if (createNewSessionRef.current) {
      console.log('[LivePage] calling createLiveSession...')
      createLiveSession()
        .then(({ session_id }) => {
          console.log('[LivePage] createLiveSession done, session_id=', session_id, 'cancelled=', cancelled, 'unmounted=', unmountedRef.current)
          if (cancelled || unmountedRef.current) return
          setDraftSessionId(session_id)
          openTab({ sessionId: session_id, label: 'Live Session', path: `/live?session=${session_id}` })
          setInitializingSession(false)
        })
        .catch((createError) => {
          console.log('[LivePage] createLiveSession error', createError, 'cancelled=', cancelled)
          if (cancelled || unmountedRef.current) return
          setInitError(createError instanceof Error ? createError.message : '初始化 Live 会话失败')
          setInitializingSession(false)
        })
      return () => {
        cancelled = true
      }
    }

    if (!requestedSessionIdRef.current) {
      setInitializingSession(false)
      return () => {
        cancelled = true
      }
    }

    getSession(requestedSessionIdRef.current)
      .then((data) => {
        if (cancelled || unmountedRef.current) return
        const typedData = data as SessionData
        openTab({
          sessionId: requestedSessionIdRef.current!,
          label: typedData.ppt_filename || 'Live Session',
          path: `/live?session=${requestedSessionIdRef.current}`,
        })
        applySessionData(requestedSessionIdRef.current!, typedData)
        const sid = requestedSessionIdRef.current!
        if (typedData.status === 'done' || typedData.status === 'stopped') {
          setSessionStatus(typedData.status as 'stopped' | 'done')
          setWsStatus('stopped')
          setLiveBackendSessionId(sid)
          const cached = localStorage.getItem(`liberstudy:live-ai-notes:${sid}`)
          if (cached) setAiNotesText(cached)
          fetch(`${API_BASE}/api/live/state/${sid}`)
            .then(r => r.json())
            .then(state => {
              if (!cancelled && !unmountedRef.current && state.transcript) {
                setPostClassTranscript(state.transcript)
              }
            })
            .catch(() => {})
        }
        if (typedData.status === 'processing') {
          void pollProcessedSession(requestedSessionIdRef.current!)
        }
      })
      .catch((loadError) => {
        if (cancelled || unmountedRef.current) return
        setError(loadError instanceof Error ? loadError.message : '加载 Live Session 失败')
      })
      .finally(() => {
        if (!cancelled && !unmountedRef.current) setInitializingSession(false)
      })

    return () => {
      cancelled = true
    }
  }, [applySessionData, openTab, pollProcessedSession])

  useEffect(() => {
    if (!notesSessionId) return
    if (session?.status === 'live') {
      const progress = session.progress
      if (progress?.ppt_id) {
        setPptId(progress.ppt_id)
      }
      if ((progress?.live_transcript?.length ?? 0) > 0) {
        const restored = progress!.live_transcript!.map((segment) => ({
          text: segment.text,
          timestamp: segment.timestamp,
          pageNum: segment.page_num ?? currentPage,
        }))
        setLiveTranscriptSegments(restored)
        setSubtitleLines(restored.slice(-2).map((segment) => segment.text))
      }
    }

    const draft = loadLivePptDraft(notesSessionId)
    if (!draft) return
    if (!session?.pages?.length) {
      setPptId((current) => current ?? draft.pptId)
      setPptPages(draft.pages)
    }
  }, [currentPage, notesSessionId, session])

  useEffect(() => {
    if (!notesSessionId || !session || session.status !== 'live') return
    const timer = window.setTimeout(() => {
      void updateLiveSessionState(notesSessionId, {
        live_transcript: liveTranscriptSegments.map((segment) => ({
          text: segment.text,
          timestamp: segment.timestamp,
          page_num: segment.pageNum,
        })),
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [liveTranscriptSegments, notesSessionId, session])

  useEffect(() => {
    if (!notesSessionId) return
    loadMyNote(notesSessionId, currentPage).then((text) => {
      if (unmountedRef.current) return
      setMyNoteTexts((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, text)
        return next
      })
    })
  }, [currentPage, notesSessionId])

  useEffect(() => {
    if (!notesSessionId) return
    loadPageChat(notesSessionId, currentPage).then((messages) => {
      if (unmountedRef.current) return
      setPageChatMessages((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, messages)
        return next
      })
    })
  }, [currentPage, notesSessionId])

  useEffect(() => {
    if (translationEnabled && session) {
      void translatePage(currentPage)
    }
  }, [currentPage, session, translatePage, translationEnabled])

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), Math.max(totalPages, 1)))
  }, [totalPages])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      unmountedRef.current = true
      clearProcessingPoll()
      myNoteSaveTimerRef.current.forEach((timer) => clearTimeout(timer))
      myNoteSaveTimerRef.current.clear()
      if (subtitleHideTimerRef.current) clearTimeout(subtitleHideTimerRef.current)
      void flushPendingMyNotes()
      stopSegmentPlayback()
      cleanupRecordingResources()
      document.body.style.overflow = previousOverflow
    }
  }, [clearProcessingPoll, cleanupRecordingResources, flushPendingMyNotes, stopSegmentPlayback])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const timers = myNoteSaveTimerRef.current
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      if (!notesSessionId) return
      Array.from(myNoteTexts.entries()).forEach(([pageNum, text]) => {
        void saveMyNote(notesSessionId, pageNum, text)
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [myNoteTexts, notesSessionId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (totalPages <= 1) return
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        setCurrentPage((prev) => Math.min(prev + 1, totalPages))
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        setCurrentPage((prev) => Math.max(prev - 1, 1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [totalPages])

  useEffect(() => {
    const handler = (event: WheelEvent) => {
      const canvas = canvasAreaRef.current
      if (!canvas || !canvas.contains(event.target as Node) || totalPages <= 1) return
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      event.preventDefault()
      event.stopPropagation()

      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
      wheelAccumRef.current += delta

      if (Math.abs(wheelAccumRef.current) < 50) return

      const direction = wheelAccumRef.current > 0 ? 1 : -1
      wheelAccumRef.current = 0

      if (wheelTimeoutRef.current) return
      if (direction === 1 && currentPageRef.current < totalPagesRef.current) {
        setCurrentPage((prev) => prev + 1)
      } else if (direction === -1 && currentPageRef.current > 1) {
        setCurrentPage((prev) => prev - 1)
      }

      wheelTimeoutRef.current = window.setTimeout(() => {
        wheelTimeoutRef.current = null
        wheelAccumRef.current = 0
      }, 400)
    }

    window.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handler, { capture: true })
  }, [])

  useEffect(() => {
    const prevPage = prevPageRef.current
    if (prevPage === currentPage) return
    const expanded = expandedBullets.get(prevPage)
    if (expanded && expanded.size > 0) {
      setAnimatedBullets((prev) => {
        const next = new Map(prev)
        const pageSet = new Set(next.get(prevPage) ?? [])
        expanded.forEach((index) => pageSet.add(index))
        next.set(prevPage, pageSet)
        return next
      })
    }
    prevPageRef.current = currentPage
  }, [currentPage, expandedBullets])

  useEffect(() => {
    setResolvedSlideUrl(primarySlideUrl ?? null)
  }, [primarySlideUrl])

  const handleResizerMouseDown = useCallback((event: React.MouseEvent) => {
    resizeStartXRef.current = event.clientX
    resizeStartWidthRef.current = notesPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = resizeStartXRef.current - moveEvent.clientX
      setNotesPanelWidth(Math.max(320, resizeStartWidthRef.current + delta))
    }

    const onMouseUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [notesPanelWidth])

  if (initializingSession && !session && pageSource.length === 0) {
    console.log('[LivePage] SHOWING LOADING: initializingSession=', initializingSession, 'session=', session, 'pageSource.length=', pageSource.length)
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
        <div className="text-center">
          <div
            className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: C.secondary, borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: C.muted }}>{t('notes_loading')}</p>
        </div>
      </div>
    )
  }

  const recordingLabel =
    wsStatus === 'live'
      ? '录音中'
      : wsStatus === 'paused'
        ? '已暂停'
        : wsStatus === 'processing'
          ? '处理中'
          : wsStatus === 'done'
            ? '已完成'
            : wsStatus === 'connecting'
              ? '连接中'
              : wsStatus === 'stopped'
                ? '已停止'
                : '未开始'

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.bg, fontFamily: FONT_SERIF }}>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 20px',
          marginTop: '40px',
          borderBottom: `1px solid ${C.divider}`,
          background: C.white,
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color:
              wsStatus === 'live'
                ? '#E05C40'
                : wsStatus === 'processing'
                  ? '#F59E0B'
                  : C.muted,
          }}
        >
          {wsStatus === 'live' && (
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: '#E05C40',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
          {recordingLabel}
        </span>

        {wsStatus === 'idle' && (
          <button
            type="button"
            onClick={() => { void startRecording() }}
            style={{
              background: '#798C00',
              color: '#fff',
              border: 'none',
              borderRadius: '9999px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            开始录音
          </button>
        )}

        {wsStatus === 'live' && (
          <button
            type="button"
            onClick={pauseRecording}
            style={{
              background: C.bg,
              color: C.fg,
              border: `1px solid ${C.divider}`,
              borderRadius: '9999px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            暂停
          </button>
        )}

        {wsStatus === 'paused' && (
          <button
            type="button"
            onClick={resumeRecording}
            style={{
              background: '#798C00',
              color: '#fff',
              border: 'none',
              borderRadius: '9999px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            继续录音
          </button>
        )}

        {(wsStatus === 'live' || wsStatus === 'paused') && (
          <button
            type="button"
            onClick={() => { void handleEndClass() }}
            style={{
              marginLeft: 'auto',
              background: '#EF4444',
              color: '#fff',
              border: 'none',
              borderRadius: '9999px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            结束课程
          </button>
        )}

        {wsStatus === 'processing' && (
          <div style={{ flex: 1, height: '4px', background: C.divider, borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                background: '#798C00',
                width: `${processingProgress}%`,
                transition: 'width 0.5s',
              }}
            />
          </div>
        )}

        {error && <span style={{ fontSize: '12px', color: '#B45309' }}>{error}</span>}
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ position: 'relative' }}>
        {navVisible && navPages.length > 0 && (
          <aside
            className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{ width: '200px', background: C.sidebar, borderRight: '1px solid rgba(175,179,176,0.1)', zIndex: 15 }}
          >
            <div
              className="flex items-center justify-between flex-shrink-0 px-4"
              style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
            >
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.secondary }}>
                {t('notes_toc')}
              </span>
              <button
                type="button"
                onClick={() => setNavVisible(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px', borderRadius: '4px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {navPages.map((page) => {
                const isActive = page.page_num === currentPage
                return (
                  <button
                    key={page.page_num}
                    type="button"
                    onClick={() => setCurrentPage(page.page_num)}
                    className="relative cursor-pointer transition-all duration-150 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center w-full border-none p-0"
                    style={{
                      height: '80px',
                      borderRadius: '6px',
                      background: C.divider,
                      boxShadow: isActive ? '0px 0px 0px 2px rgba(95,94,94,1)' : '0 1px 3px rgba(0,0,0,0.08)',
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    {withApiBase(page.thumbnail_url) ?? buildSessionSlideUrl(page.pdf_page_num) ? (
                      <img
                        src={withApiBase(page.thumbnail_url) ?? (buildSessionSlideUrl(page.pdf_page_num) ?? '')}
                        alt={`第 ${page.page_num} 页缩略图`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        loading="lazy"
                        onError={(event) => {
                          const fallback = buildSessionSlideUrl(page.pdf_page_num)
                          if (!fallback) return
                          if (event.currentTarget.dataset.fallbackApplied === '1') {
                            event.currentTarget.style.opacity = '0'
                            return
                          }
                          event.currentTarget.dataset.fallbackApplied = '1'
                          event.currentTarget.src = fallback
                        }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.divider }}>
                        <span style={{ fontSize: '18px', fontWeight: '700', color: C.secondary, opacity: 0.5 }}>{page.page_num}</span>
                      </div>
                    )}
                    <span
                      className="absolute top-1 left-1.5 flex items-center justify-center"
                      style={{ background: C.fg, color: C.white, fontSize: '8px', fontWeight: '700', borderRadius: '3px', padding: '1px 5px', minWidth: '16px' }}
                    >
                      {page.page_num}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: C.bg }}>
          <CanvasToolbar
            navVisible={navVisible}
            onNavToggle={() => setNavVisible((value) => !value)}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onHighlightColorChange={setHighlightColor}
            translationEnabled={translationEnabled}
            popoverOpen={popoverOpen}
            onPopoverToggle={() => setPopoverOpen((value) => !value)}
            targetLang={targetLang}
            onTargetLangChange={setTargetLang}
            onTranslate={() => {
              setTranslationEnabled(true)
              setPopoverOpen(false)
              if (session) void translatePage(currentPage)
            }}
            onShowOriginal={() => {
              setTranslationEnabled(false)
              setPopoverOpen(false)
            }}
            onClosePopover={() => setPopoverOpen(false)}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            currentPage={currentPage}
            totalPages={Math.max(totalPages, 1)}
            pageInputValue={pageInputValue}
            onPageInputChange={setPageInputValue}
            onPageInputCommit={() => {
              const nextPage = parseInt(pageInputValue, 10)
              if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= Math.max(totalPages, 1)) {
                setCurrentPage(nextPage)
              } else {
                setPageInputValue(String(currentPage))
              }
            }}
            onPrevPage={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            onNextPage={() => setCurrentPage((prev) => Math.min(Math.max(totalPages, 1), prev + 1))}
            searchOpen={searchOpen}
            onSearchToggle={() => {
              setSearchOpen((value) => !value)
              if (searchOpen) setSearchQuery('')
            }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          <div
            ref={canvasAreaRef}
            className="flex-1 flex items-center justify-center"
            style={{
              position: 'relative',
              background: 'rgba(232,231,226,0.6)',
              overflowX: zoomLevel > 100 ? 'auto' : 'hidden',
              overflowY: 'hidden',
              touchAction: 'none',
            }}
          >
            {/* PDF 文件：立刻用 iframe 本地渲染，无需等后端 */}
            {localPdfUrl && pageSource.length === 0 ? (
              <div
                ref={pageContainerRef}
                className="relative rounded-lg overflow-hidden"
                style={{ width: Math.round(canvasWidth * zoomLevel / 100), maxWidth: '100%', height: '80vh', background: C.white, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}
              >
                <iframe
                  src={`${localPdfUrl}#page=${currentPage}&toolbar=0&navpanes=0&scrollbar=0`}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="PDF Viewer"
                />
                <TextAnnotationLayer
                  annotations={annotationsForPage(currentPage)}
                  textToolActive={activeTool === 'text'}
                  onPlaceAnnotation={(x, y) => addAnnotation(currentPage, x, y)}
                  onUpdate={updateAnnotation}
                  onRemove={removeAnnotation}
                />
                {pptUploading && (
                  <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(47,51,49,0.7)', color: '#fff', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} />
                    正在解析 PPT...
                  </div>
                )}
                <div className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}>
                  {String(currentPage).padStart(2, '0')} / {String(localPdfPageCount || 1).padStart(2, '0')}
                </div>
              </div>
            ) : pageSource.length === 0 ? (
              <div
                style={{
                  width: Math.round(canvasWidth * zoomLevel / 100),
                  maxWidth: '100%',
                  aspectRatio: '16/9',
                  borderRadius: '8px',
                  background: C.white,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px',
                }}
              >
                <div style={{ textAlign: 'center', color: C.muted }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: C.fg, marginBottom: '8px' }}>上传课程 PPT</div>
                  <div style={{ fontSize: '13px', marginBottom: '20px' }}>
                    左侧 PPT 区域会始终保留。你现在可以先录音，也可以先上传 PPT。
                  </div>
                  <label
                    style={{
                      cursor: 'pointer',
                      background: '#798C00',
                      color: '#fff',
                      borderRadius: '9999px',
                      padding: '10px 24px',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'inline-block',
                    }}
                  >
                    选择 PPT / PDF
                    <input
                      type="file"
                      accept=".ppt,.pptx,.pdf"
                      style={{ display: 'none' }}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        void handleUploadPpt(file)
                      }}
                    />
                  </label>
                  {pptUploading && <p style={{ marginTop: '10px', fontSize: '12px' }}>上传中...</p>}
                  {initError && <p style={{ marginTop: '10px', fontSize: '12px', color: '#B45309' }}>{initError}</p>}
                </div>
              </div>
            ) : !resolvedSlideUrl && pagePhase === 'processing' ? (
              <div
                style={{
                  width: Math.round(canvasWidth * zoomLevel / 100),
                  maxWidth: '100%',
                  aspectRatio: '16/9',
                  borderRadius: '8px',
                  background: C.white,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.secondary, borderTopColor: 'transparent' }} />
                <span style={{ fontSize: '12px', color: C.muted }}>{t('notes_loading')}</span>
              </div>
            ) : !resolvedSlideUrl ? (
              <div
                style={{
                  width: Math.round(canvasWidth * zoomLevel / 100),
                  maxWidth: '100%',
                  aspectRatio: '16/9',
                  borderRadius: '8px',
                  background: C.white,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: '12px', color: C.muted }}>当前页图片加载失败</span>
              </div>
            ) : (
              <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
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
                    alt={`Slide ${currentPage}`}
                    style={{
                      width: Math.round(canvasWidth * zoomLevel / 100),
                      maxWidth: '100%',
                      maxHeight: '80vh',
                      display: 'block',
                      objectFit: 'contain',
                    }}
                    onError={() => {
                      if (fallbackSlideUrl && resolvedSlideUrl !== fallbackSlideUrl) {
                        setResolvedSlideUrl(fallbackSlideUrl)
                      } else {
                        setResolvedSlideUrl(null)
                      }
                    }}
                  />
                  <HighlightLayer
                    pageContainerRef={pageContainerRef}
                    pageNum={currentPage}
                    highlights={highlightsForPage(currentPage)}
                    highlightToolActive={activeTool === 'highlight'}
                    eraserToolActive={activeTool === 'eraser'}
                    highlightColor={highlightColor}
                    onAdd={(record) => addHighlight({ ...record, sessionId: notesSessionId ?? 'live-unbound' })}
                    onRemove={removeHighlight}
                  />
                  <TextAnnotationLayer
                    annotations={annotationsForPage(currentPage)}
                    textToolActive={activeTool === 'text'}
                    onPlaceAnnotation={(x, y) => addAnnotation(currentPage, x, y)}
                    onUpdate={updateAnnotation}
                    onRemove={removeAnnotation}
                  />
                  <div
                    className="absolute bottom-3 right-3 text-xs px-2 py-0.5 rounded"
                    style={{ background: 'rgba(47,51,49,0.5)', color: C.white, letterSpacing: '0.05em' }}
                  >
                    SLIDE {String(currentPage).padStart(2, '0')} / {String(Math.max(totalPages, 1)).padStart(2, '0')}
                  </div>
                </div>
              </div>
            )}

            {isLiveMode && subtitleLines.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: '24px',
                  right: '24px',
                  bottom: '24px',
                  pointerEvents: 'none',
                  opacity: subtitleVisible ? 1 : 0,
                  transition: 'opacity 0.4s ease',
                  zIndex: 10,
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    maxWidth: 'min(860px, 100%)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.62)',
                    backdropFilter: 'blur(4px)',
                    fontSize: '15px',
                    lineHeight: '1.6',
                    color: '#FFFFFF',
                    fontWeight: 500,
                  }}
                >
                  {subtitleLines.slice(-2).join(' ')}
                </div>
              </div>
            )}
          </div>
        </main>

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
          onMouseEnter={(event) => { (event.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.06)' }}
          onMouseLeave={(event) => { (event.currentTarget as HTMLDivElement).style.background = 'transparent' }}
        >
          <div style={{ width: '1px', height: '100%', background: 'rgba(175,179,176,0.2)' }} />
        </div>

        <NotesPanel
          sessionId={panelSessionId}
          currentPage={currentPage}
          pageData={activePageData}
          notesPanelWidth={notesPanelWidth}
          noteMode={noteMode}
          onNoteModeChange={setNoteMode}
          isLive={isLiveMode}
          subtitleLines={subtitleLines}
          wsStatus={normalizePanelWsStatus(wsStatus)}
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
              const pageBullets = new Set(next.get(currentPage) ?? [])
              if (pageBullets.has(bulletIndex)) pageBullets.delete(bulletIndex)
              else pageBullets.add(bulletIndex)
              next.set(currentPage, pageBullets)
              return next
            })
          }}
          onBulletAnimationDone={(bulletIndex) => {
            setAnimatedBullets((prev) => {
              const next = new Map(prev)
              const pageBullets = new Set(next.get(currentPage) ?? [])
              pageBullets.add(bulletIndex)
              next.set(currentPage, pageBullets)
              return next
            })
          }}
          pageRevealed={!isLiveMode}
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
          onPageChatSend={() => { void handlePageChatSend() }}
          drawerPhase={drawerPhase}
          onDrawerPhaseChange={setDrawerPhase}
          drawerHeightPx={drawerHeightPx}
          onDrawerHeightChange={setDrawerHeightPx}
          drawerModel={drawerModel}
          onDrawerModelChange={setDrawerModel}
          drawerModelDDOpen={drawerModelDDOpen}
          onDrawerModelDDOpenChange={setDrawerModelDDOpen}
          pagePhase={pagePhase}
          transcriptJustDone={false}
          aiNotesJustDone={false}
          hasAnyAlignedSegments={session?.pages?.some((page) => (page.aligned_segments?.length ?? 0) > 0) ?? false}
          hasPendingAiNotes={session?.pages?.some((page) => !page.passive_notes?.bullets?.length) ?? false}
          draftOutlineLines={draftOutlineLines}
          fullscreen={notesFullscreen}
          onFullscreen={setNotesFullscreen}
        />

        {/* 课后 Transcript 覆盖层 */}
        {(sessionStatus === 'stopped' || sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'transcript' && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: '#fff', padding: '20px', zIndex: 10 }}>
            <p style={{ fontSize: 11, color: '#838683', marginBottom: 16 }}>
              课程已结束 · 完整转录
            </p>
            {postClassTranscript.length === 0 ? (
              <p style={{ color: '#c2c5c2' }}>暂无转录内容</p>
            ) : (
              postClassTranscript.map((item, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {item.page != null && (
                    <button
                      type="button"
                      onClick={() => setCurrentPage(item.page!)}
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        background: '#e8e7e2',
                        color: '#2F3331',
                        border: 'none',
                        borderRadius: 3,
                        padding: '2px 6px',
                        cursor: 'pointer',
                      }}
                    >
                      P{item.page}
                    </button>
                  )}
                  <p style={{ color: '#2F3331', lineHeight: 1.7, margin: 0 }}>{item.text}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* 课后 My Notes 长文覆盖层 */}
        {(sessionStatus === 'stopped' || sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'my' && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: '#fff', padding: '20px', zIndex: 10 }}>
            <p style={{ fontSize: 11, color: '#838683', marginBottom: 16 }}>
              课程已结束 · 整课笔记
            </p>
            {allMyNotesList.filter(n => n.text.trim()).length === 0 ? (
              <p style={{ color: '#c2c5c2' }}>本节课未写笔记</p>
            ) : (
              allMyNotesList.filter(n => n.text.trim()).map((note) => (
                <div key={note.page} style={{ marginBottom: 24 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(note.page)}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      background: 'transparent',
                      color: '#838683',
                      border: '1px solid #e8e7e2',
                      borderRadius: 4,
                      padding: '2px 8px',
                      marginBottom: 8,
                      cursor: 'pointer',
                      display: 'block',
                    }}
                  >
                    第 {note.page} 页
                  </button>
                  <div style={{ color: '#2F3331', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontSize: 14 }}>
                    {note.text}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 课后 AI Notes 覆盖层 */}
        {(sessionStatus === 'finalizing' || sessionStatus === 'done') && noteMode === 'ai' && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: '#fff', padding: '20px', zIndex: 10 }}>
            <p style={{ fontSize: 11, color: '#838683', marginBottom: 16 }}>
              {aiNotesStreaming ? '正在生成 AI 笔记...' : 'AI 笔记'}
            </p>
            {aiNotesText ? (
              <AiNotesRenderer
                text={aiNotesText}
                sessionId={liveBackendSessionId}
                onDetailedNote={handleOpenDetailedNote}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c2c5c2' }}>
                <div
                  className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: '#c2c5c2', borderTopColor: 'transparent' }}
                />
                等待生成...
              </div>
            )}
          </div>
        )}
      </div>

      {session?.audio_url && (
        <audio ref={audioRef} src={withApiBase(session.audio_url) ?? undefined} preload="metadata" style={{ display: 'none' }} />
      )}

      {/* Generate Notes 按钮（课后 stopped 态） */}
      {sessionStatus === 'stopped' && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
          }}
        >
          <button
            type="button"
            onClick={() => { void handleGenerateNotes() }}
            style={{
              background: '#2F3331',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '11px 32px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            }}
          >
            Generate Notes
          </button>
        </div>
      )}

      {/* Finalizing 状态提示 */}
      {sessionStatus === 'finalizing' && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
          }}
        >
          <div style={{ color: '#838683', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#838683', borderTopColor: 'transparent' }}
            />
            正在生成笔记...
          </div>
        </div>
      )}

      {/* Detailed Notes 悬浮侧栏 */}
      {detailedNoteOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 360,
            height: '100vh',
            background: '#fff',
            borderLeft: '1px solid #e8e7e2',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: '14px 16px',
              borderBottom: '1px solid #e8e7e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#838683' }}>详细解释</span>
            <button
              type="button"
              onClick={() => setDetailedNoteOpen(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c2c5c2', fontSize: 18 }}
            >
              ×
            </button>
          </div>

          <div style={{ flexShrink: 0, padding: '10px 16px', background: '#f8f8f5', borderBottom: '1px solid #e8e7e2' }}>
            <p style={{ fontSize: 12, color: '#c2c5c2', margin: 0 }}>
              {detailedNotePageNum != null ? `第 ${detailedNotePageNum} 页 · ` : ''}原文
            </p>
            <p style={{ fontSize: 13, color: '#2F3331', margin: '4px 0 0', fontWeight: 500, lineHeight: 1.6 }}>
              {detailedNoteSource}
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {detailedNoteText ? (
              <p style={{ fontSize: 14, color: '#2F3331', lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
                {detailedNoteText}
                {detailedNoteStreaming && (
                  <span style={{ display: 'inline-block', width: 2, height: 14, background: '#2F3331', marginLeft: 2 }} />
                )}
              </p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c2c5c2' }}>
                <div
                  className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: '#c2c5c2', borderTopColor: 'transparent' }}
                />
                生成中...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
