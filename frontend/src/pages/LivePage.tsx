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
import type { AlignedSegment, PageChatMessage, PageData, SessionData } from '../lib/notesTypes'
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
const WS_BASE = API_BASE.replace(/^http/, 'ws')

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
    targetLang,
    setEnabled: setTranslationEnabled,
    setTargetLang,
  } = useTranslation()

  const createNewSession = searchParams.get('new') === '1' || !searchParams.get('session')

  const [draftSessionId, setDraftSessionId] = useState<string | null>(null)
  const [processedSessionId, setProcessedSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  const notesSessionId = draftSessionId ?? processedSessionId ?? 'live-local'
  const panelSessionId = processedSessionId ?? notesSessionId

  const [wsStatus, setWsStatus] = useState<WsStatus>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const [subtitleLines, setSubtitleLines] = useState<string[]>([])
  const [transcriptByPage, setTranscriptByPage] = useState<Record<number, string[]>>({})
  const subtitleBottomRef = useRef<HTMLDivElement>(null)

  const [pptFile, setPptFile] = useState<File | null>(null)
  const [pptId, setPptId] = useState<string | null>(null)
  const [pptPages, setPptPages] = useState<PptPage[]>([])
  const [pptUploading, setPptUploading] = useState(false)
  const [processingProgress, setProcessingProgress] = useState(0)

  const [currentPage, setCurrentPage] = useState(1)
  const currentPageRef = useRef(1)
  const [noteMode, setNoteMode] = useState<NoteMode>('transcript')
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
  const [myNoteExpandStates, setMyNoteExpandStates] = useState<Map<number, MyNoteExpandState>>(new Map())
  const [expandedBullets, setExpandedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [animatedBullets, setAnimatedBullets] = useState<Map<number, Set<number>>>(new Map())
  const [translatedTexts] = useState<Map<number, TranslatedPageTexts>>(new Map())

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

  useEffect(() => {
    currentPageRef.current = currentPage
    setPageInputValue(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    subtitleBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitleLines])

  useEffect(() => {
    if (!createNewSession) return

    let cancelled = false

    createLiveSession()
      .then(({ session_id }) => {
        if (cancelled) return
        setDraftSessionId(session_id)
        openTab({ sessionId: session_id, label: 'Live 课堂', path: '/live?new=1' })
      })
      .catch((error) => {
        if (cancelled) return
        const fallbackId = `live-local-${Date.now()}`
        setDraftSessionId(fallbackId)
        setInitError(error instanceof Error ? error.message : '初始化 Live 会话失败')
        openTab({ sessionId: fallbackId, label: 'Live 课堂', path: '/live?new=1' })
      })

    return () => {
      cancelled = true
    }
  }, [createNewSession, openTab])

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
  }, [playingSegIdx])

  const startRecording = useCallback(async () => {
    setWsStatus('connecting')
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ws = new WebSocket(`${WS_BASE}/api/ws/live-asr`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsStatus('live')
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
          setTranscriptByPage((prev) => ({
            ...prev,
            [currentPageRef.current]: [...(prev[currentPageRef.current] ?? []), message.text],
          }))
          return
        }

        setSubtitleLines((prev) => {
          const base = prev[prev.length - 1] === '…' ? prev.slice(0, -1) : prev
          return [...base, message.text || '…']
        })
      }

      ws.onerror = () => setWsStatus('stopped')
      ws.onclose = () => {
        setWsStatus((prev) => (prev === 'processing' || prev === 'done' ? prev : 'stopped'))
      }
    } catch {
      setWsStatus('idle')
    }
  }, [])

  const pauseRecording = useCallback(() => {
    mediaRecorderRef.current?.pause()
    setWsStatus('paused')
  }, [])

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume()
    setWsStatus('live')
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    const stream = recorder?.stream

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }

    stream?.getTracks().forEach((track) => track.stop())
    wsRef.current?.close()
    setWsStatus('processing')

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })

    try {
      const result = await uploadFiles(pptFile ?? undefined, audioFile, 'zh', undefined, pptId ?? undefined)
      const nextSessionId = result.session_id
      setProcessedSessionId(nextSessionId)

      const poll = async () => {
        const data = await getSession(nextSessionId) as SessionData & {
          progress?: { step: string; percent: number } | null
        }

        if (data.status === 'ready' || data.status === 'partial_ready') {
          setSession(data)
          setWsStatus('done')
          setNoteMode('ai')
          if (data.pages.length > 0) {
            setCurrentPage(data.pages[0].page_num)
          }
          return
        }

        if (data.status === 'error') {
          setWsStatus('stopped')
          return
        }

        if (data.progress) {
          setProcessingProgress(data.progress.percent)
        }
        window.setTimeout(() => {
          void poll()
        }, 3000)
      }

      await poll()
    } catch {
      setWsStatus('stopped')
    }
  }, [pptFile, pptId])

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
          </div>

          {isLiveMode && (
            <div
              style={{
                height: '100px',
                flexShrink: 0,
                overflowY: 'auto',
                background: 'rgba(30,30,30,0.88)',
                margin: '0 12px 8px',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#E8E8E0',
              }}
            >
              {subtitleLines.length === 0 ? (
                <span style={{ opacity: 0.4 }}>开始录音后，字幕会实时显示在这里。</span>
              ) : (
                subtitleLines.map((line, index) => (
                  <p key={`${index}-${line}`} style={{ margin: '2px 0' }}>
                    {line}
                  </p>
                ))
              )}
              <div ref={subtitleBottomRef} />
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
                color:
                  wsStatus === 'live'
                    ? '#798C00'
                    : wsStatus === 'processing'
                      ? '#F59E0B'
                      : C.muted,
              }}
            >
              {wsStatus === 'idle'
                ? '未开始'
                : wsStatus === 'connecting'
                  ? '连接中'
                  : wsStatus === 'live'
                    ? '● 录音中'
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

        <NotesPanel
          sessionId={panelSessionId}
          currentPage={currentPage}
          pageData={activePageData}
          notesPanelWidth={notesPanelWidth}
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
