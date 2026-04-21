import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CanvasToolbar from '../components/CanvasToolbar'
import NotesPanel from '../components/notes/NotesPanel'
import { useTabs } from '../context/TabsContext'
import { useTranslation } from '../context/TranslationContext'
import {
  askBullet,
  createLiveSession,
  generateMyNote,
  getSession,
  retryPage,
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const WS_BASE =
  API_BASE.replace(/^http/, 'ws') ||
  (typeof window !== 'undefined'
    ? import.meta.env.DEV
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000`
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

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
  } = useTranslation()

  const requestedSessionId = searchParams.get('session')
  const createNewSession = searchParams.get('new') === '1' || !requestedSessionId

  const [draftSessionId, setDraftSessionId] = useState<string | null>(null)
  const [processedSessionId, setProcessedSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  const notesSessionId = draftSessionId ?? processedSessionId ?? 'live-local'
  const panelSessionId = processedSessionId ?? notesSessionId

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

  const [pptFile, setPptFile] = useState<File | null>(null)
  const [pptId, setPptId] = useState<string | null>(null)
  const [pptPages, setPptPages] = useState<PptPage[]>([])
  const [pptUploading, setPptUploading] = useState(false)
  const [processingProgress, setProcessingProgress] = useState(0)

  const [currentPage, setCurrentPage] = useState(1)
  const [noteMode, setNoteMode] = useState<NoteMode>('my')
  const [navVisible, setNavVisible] = useState(true)
  const [notesPanelWidth, setNotesPanelWidth] = useState(460)
  const [activeTool, setActiveTool] = useState<'none' | 'highlight' | 'eraser' | 'text'>('none')
  const [highlightColor, setHighlightColor] = useState('#FFD700')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageInputValue, setPageInputValue] = useState('1')
  const [popoverOpen, setPopoverOpen] = useState(false)

  const [myNoteTexts, setMyNoteTexts] = useState<Map<number, string>>(new Map())
  const myNoteSaveTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const myNoteTextsRef = useRef(myNoteTexts)
  const notesSessionIdRef = useRef(notesSessionId)
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
  const audioRef = useRef<HTMLAudioElement>(null)
  const segStartRef = useRef<number | null>(null)
  const segEndRef = useRef<number | null>(null)
  const segTimeUpdateRef = useRef<(() => void) | null>(null)

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

  const activePageData = session?.pages.find((page) => page.page_num === currentPage) ?? null
  const draftPage = pptPages.find((page) => page.page_num === currentPage) ?? null
  const totalPages = session?.pages.length ?? pptPages.length
  const pageSource = session?.pages ?? pptPages
  const isLiveMode = wsStatus !== 'done'
  const pagePhase = wsStatus === 'processing' ? 'processing' : 'ready'
  const draftOutlineLines = buildDraftOutlineLines(activePageData?.ppt_text ?? draftPage?.ppt_text ?? '')

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

    if (!notesSessionId || myNoteTexts.size === 0) return

    await Promise.all(
      Array.from(myNoteTexts.entries()).map(([pageNum, text]) => saveMyNote(notesSessionId, pageNum, text)),
    )
  }, [myNoteTexts, notesSessionId])

  const applySessionData = useCallback(
    (
      sessionId: string,
      data: SessionData,
      options?: { liveDraft?: boolean; keepCurrentPage?: boolean },
    ) => {
      if (options?.liveDraft || data.status === 'live') {
        setDraftSessionId(sessionId)
      } else {
        setProcessedSessionId(sessionId)
      }

      setSession(data)

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
      } else if (data.status === 'live') {
        setWsStatus('idle')
      }
    },
    [],
  )

  const pollProcessedSession = useCallback(
    async (sessionId: string) => {
      clearProcessingPoll()

      try {
        const data = await getSession(sessionId) as SessionData
        if (unmountedRef.current) return

        if (data.status === 'error') {
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
      } catch {
        if (!unmountedRef.current) {
          setWsStatus('stopped')
        }
      }
    },
    [applySessionData, clearProcessingPoll],
  )

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

  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    myNoteTextsRef.current = myNoteTexts
  }, [myNoteTexts])

  useEffect(() => {
    notesSessionIdRef.current = notesSessionId
  }, [notesSessionId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const timers = myNoteSaveTimerRef.current
      timers.forEach((timerId) => clearTimeout(timerId))
      timers.clear()
      const sid = notesSessionIdRef.current
      if (sid) {
        Array.from(myNoteTextsRef.current.entries()).forEach(([pageNum, text]) => {
          void saveMyNote(sid, pageNum, text)
        })
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      unmountedRef.current = true
      clearProcessingPoll()
      myNoteSaveTimerRef.current.forEach((timer) => clearTimeout(timer))
      myNoteSaveTimerRef.current.clear()
      const pendingSessionId = notesSessionIdRef.current
      const pendingNotes = Array.from(myNoteTextsRef.current.entries())
      if (pendingSessionId && pendingNotes.length > 0) {
        void Promise.all(
          pendingNotes.map(([pageNum, text]) => saveMyNote(pendingSessionId, pageNum, text)),
        )
      }
      stopSegmentPlayback()
      cleanupRecordingResources()
      document.body.style.overflow = previousOverflow
    }
  }, [clearProcessingPoll, cleanupRecordingResources, stopSegmentPlayback])

  useEffect(() => {
    let cancelled = false
    setInitError(null)

    if (createNewSession) {
      createLiveSession()
      .then(({ session_id }) => {
        if (cancelled || unmountedRef.current) return
        setDraftSessionId(session_id)
        openTab({ sessionId: session_id, label: 'Live Session', path: `/live?session=${session_id}` })
      })
      .catch((error) => {
        if (cancelled || unmountedRef.current) return
        const fallbackId = `live-local-${Date.now()}`
        setDraftSessionId(fallbackId)
        setInitError(error instanceof Error ? error.message : '初始化 Live 会话失败')
        openTab({ sessionId: fallbackId, label: 'Live Session', path: `/live?session=${fallbackId}` })
      })
    } else if (requestedSessionId) {
      getSession(requestedSessionId)
        .then((data) => {
          if (cancelled || unmountedRef.current) return

          const typedData = data as SessionData
          openTab({
            sessionId: requestedSessionId,
            label: typedData.ppt_filename || 'Live Session',
            path: `/live?session=${requestedSessionId}`,
          })

          if (typedData.status === 'live') {
            setDraftSessionId(requestedSessionId)
            if (Array.isArray(typedData.pages) && typedData.pages.length > 0) {
              applySessionData(requestedSessionId, typedData, { liveDraft: true })
            }
            return
          }

          applySessionData(requestedSessionId, typedData)
          if (typedData.status === 'processing') {
            void pollProcessedSession(requestedSessionId)
          }
        })
        .catch((error) => {
          if (cancelled || unmountedRef.current) return
          setInitError(error instanceof Error ? error.message : 'Failed to load live session')
        })
    }

    return () => {
      cancelled = true
    }
  }, [applySessionData, createNewSession, openTab, pollProcessedSession, requestedSessionId])

  useEffect(() => {
    if (!notesSessionId) return

    loadMyNote(notesSessionId, currentPage).then((text) => {
      setMyNoteTexts((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, text)
        return next
      })
    })
  }, [notesSessionId, currentPage])

  useEffect(() => {
    if (!notesSessionId) return

    loadPageChat(notesSessionId, currentPage).then((messages) => {
      setPageChatMessages((prev) => {
        if (prev.has(currentPage)) return prev
        const next = new Map(prev)
        next.set(currentPage, messages)
        return next
      })
    })
  }, [notesSessionId, currentPage])

  useEffect(() => {
    if (totalPages <= 0) return
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages))
  }, [totalPages])

  useEffect(() => {
    if (translationEnabled && session) {
      void translatePage(currentPage)
    }
  }, [currentPage, session, translatePage, translationEnabled])

  const handleMyNoteChange = useCallback((pageNum: number, text: string) => {
    setMyNoteTexts((prev) => {
      const next = new Map(prev)
      next.set(pageNum, text)
      return next
    })

    const existingTimer = myNoteSaveTimerRef.current.get(pageNum)
    if (existingTimer) clearTimeout(existingTimer)

    const nextTimer = setTimeout(() => {
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
      const aiMessage: PageChatMessage = {
        role: 'ai',
        content: '课堂处理中后，这里的页内问答会使用完整笔记上下文继续回答。',
        timestamp: Date.now(),
      }
      const messagesWithReply = [...nextMessages, aiMessage]
      setPageChatMessages((prev) => {
        const next = new Map(prev)
        next.set(currentPage, messagesWithReply)
        return next
      })
      await savePageChat(notesSessionId, currentPage, messagesWithReply)
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
      await savePageChat(notesSessionId, currentPage, messagesWithReply)
    } catch (error) {
      const aiMessage: PageChatMessage = {
        role: 'ai',
        content: `出错了：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      }
      const messagesWithReply = [...nextMessages, aiMessage]
      setPageChatMessages((prev) => {
        const next = new Map(prev)
        next.set(currentPage, messagesWithReply)
        return next
      })
      await savePageChat(notesSessionId, currentPage, messagesWithReply)
    } finally {
      setPageChatStreaming(false)
      setPageChatStreamingText('')
    }
  }, [
    currentPage,
    drawerModel,
    getMyNoteText,
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

  const startRecording = useCallback(async () => {
    setWsStatus('connecting')
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const ws = new WebSocket(`${WS_BASE}/api/ws/live-asr`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsStatus('live')
        openTab({ sessionId: notesSessionIdRef.current, label: '⏺ 录音中', path: `/live?session=${notesSessionIdRef.current}` })
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
  }, [cleanupRecordingResources, openTab])

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

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })

    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile, 'zh', undefined, pptId ?? undefined)
      const nextSessionId = result.session_id
      setProcessedSessionId(nextSessionId)

      await pollProcessedSession(nextSessionId)
    } catch {
      setWsStatus('stopped')
    }
  }, [clearProcessingPoll, flushPendingMyNotes, pollProcessedSession, pptFile, pptId])

  const currentSlideUrl = activePageData
    ? withApiBase(activePageData.thumbnail_url) ??
      (processedSessionId ? `${API_BASE}/api/sessions/${processedSessionId}/slide/${activePageData.pdf_page_num}.png` : null)
    : withApiBase(draftPage?.thumbnail_url)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', marginTop: '40px', background: C.bg, fontFamily: FONT_SERIF }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {navVisible && (
          <aside style={{ width: 200, flexShrink: 0, background: C.sidebar, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: C.secondary }}>TOC</span>
              <button
                type="button"
                onClick={() => setNavVisible(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '16px' }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }} onWheel={(event) => event.stopPropagation()}>
              {pageSource.map((page) => {
                const thumbUrl = withApiBase(page.thumbnail_url)
                const pageNum = page.page_num
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      borderRadius: '6px',
                      border: 'none',
                      background: currentPage === pageNum ? 'rgba(121,140,0,0.12)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={`Slide ${pageNum}`}
                        style={{
                          width: '100%',
                          borderRadius: '4px',
                          border: currentPage === pageNum ? '2px solid #798C00' : '2px solid transparent',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '16/9',
                          background: C.muted,
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          color: C.secondary,
                        }}
                      >
                        {pageNum}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </aside>
        )}

        {pageSource.length > 0 && (
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <CanvasToolbar
            navVisible={navVisible}
            onNavToggle={() => setNavVisible((prev) => !prev)}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onHighlightColorChange={setHighlightColor}
            translationEnabled={translationEnabled}
            popoverOpen={popoverOpen}
            onPopoverToggle={() => setPopoverOpen((prev) => !prev)}
            targetLang={targetLang}
            onTargetLangChange={setTargetLang}
            onTranslate={() => setTranslationEnabled(true)}
            onShowOriginal={() => setTranslationEnabled(false)}
            onClosePopover={() => setPopoverOpen(false)}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            currentPage={currentPage}
            totalPages={totalPages || 1}
            pageInputValue={pageInputValue}
            onPageInputChange={setPageInputValue}
            onPageInputCommit={() => {
              const nextPage = parseInt(pageInputValue, 10)
              if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= (totalPages || 1)) {
                setCurrentPage(nextPage)
              }
            }}
            onPrevPage={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            onNextPage={() => setCurrentPage((prev) => Math.min(totalPages || 1, prev + 1))}
            searchOpen={searchOpen}
            onSearchToggle={() => setSearchOpen((prev) => !prev)}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
            {pageSource.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.muted }}>
                <p style={{ fontSize: '13px', marginBottom: '12px' }}>可选：上传 PPT 同步显示幻灯片</p>
                <label
                  style={{
                    cursor: 'pointer',
                    background: '#798C00',
                    color: '#fff',
                    borderRadius: '9999px',
                    padding: '8px 20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'inline-block',
                  }}
                >
                  上传 PPT
                  <input
                    type="file"
                    accept=".ppt,.pptx,.pdf"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      setPptFile(file)
                      setPptUploading(true)
                      uploadPpt(file)
                        .then((result) => {
                          setPptId(result.ppt_id)
                          setPptPages(result.pages)
                          setCurrentPage(1)
                        })
                        .finally(() => setPptUploading(false))
                    }}
                  />
                </label>
                {pptUploading && <p style={{ marginTop: '8px', fontSize: '12px' }}>上传中…</p>}
                {initError && <p style={{ marginTop: '8px', fontSize: '12px', color: '#B45309' }}>{initError}</p>}
              </div>
            ) : currentSlideUrl ? (
              <img
                src={currentSlideUrl}
                alt={`Slide ${currentPage}`}
                style={{
                  maxWidth: `${zoomLevel}%`,
                  maxHeight: '100%',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16/9',
                  maxWidth: '800px',
                  background: C.white,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.secondary,
                  fontSize: '14px',
                }}
              >
                第 {currentPage} 页
              </div>
            )}
            {/* 字幕浮层：说话时出现，静默 2.5s 后淡出 */}
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
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    maxWidth: '100%',
                    padding: '6px 14px',
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

          )}

          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 20px',
              borderTop: `1px solid ${C.divider}`,
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
                gap: '5px',
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
                    animation: 'pulse 1.5s ease-in-out infinite',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
              )}
              {wsStatus === 'idle'
                ? '未开始'
                : wsStatus === 'connecting'
                  ? '连接中'
                  : wsStatus === 'live'
                    ? '录音中'
                    : wsStatus === 'paused'
                      ? '已暂停'
                      : wsStatus === 'stopped'
                        ? '录音已停止'
                        : wsStatus === 'processing'
                          ? '处理中'
                          : '已完成'}
            </span>

            {wsStatus === 'idle' && (
              <button
                type="button"
                onClick={() => {
                  void startRecording()
                }}
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
                onClick={() => {
                  void stopRecording()
                }}
                style={{
                  background: '#EF4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  padding: '6px 18px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                结束课堂
              </button>
            )}

            {wsStatus === 'processing' && (
              <div style={{ flex: 1, height: '4px', background: C.muted, borderRadius: '2px', overflow: 'hidden' }}>
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
          </div>
        </main>
        )}

        {pageSource.length > 0 && (
          <div
            style={{ width: '8px', flexShrink: 0, cursor: 'col-resize', background: C.divider, opacity: 0 }}
          onMouseDown={(event) => {
            const startX = event.clientX
            const startWidth = notesPanelWidth

            const onMove = (moveEvent: MouseEvent) => {
              setNotesPanelWidth(Math.max(300, startWidth - (moveEvent.clientX - startX)))
            }

            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
            }

            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        />
        )}

        <NotesPanel
          sessionId={panelSessionId}
          currentPage={currentPage}
          pageData={activePageData}
          notesPanelWidth={pageSource.length > 0 ? notesPanelWidth : undefined}
          noteMode={noteMode}
          onNoteModeChange={setNoteMode}
          isLive={isLiveMode}
          subtitleLines={subtitleLines}
          wsStatus={wsStatus === 'done' || wsStatus === 'processing' ? 'stopped' : wsStatus === 'paused' ? 'live' : wsStatus}
          getMyNoteText={getMyNoteText}
          onMyNoteChange={handleMyNoteChange}
          myNoteExpandState={getMyNoteExpandState(currentPage)}
          onExpandMyNote={handleExpandMyNote}
          annotations={[]}
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
          onPageChatSend={() => {
            void handlePageChatSend()
          }}
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
        />
      </div>

      {session?.audio_url && (
        <audio ref={audioRef} src={withApiBase(session.audio_url) ?? undefined} preload="metadata" style={{ display: 'none' }} />
      )}
    </div>
  )
}
