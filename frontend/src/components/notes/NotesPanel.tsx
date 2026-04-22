import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { useTranslation } from '../../context/TranslationContext'
import type { AlignedSegment, PageChatMessage, PageData } from '../../lib/notesTypes'
import { C, formatTime, renderMd } from '../../lib/notesUtils'
import AiBulletRow from './AiBulletRow'
import StreamingExpandText from './StreamingExpandText'

type NoteMode = 'my' | 'ai' | 'transcript'
type DrawerPhase = 'closed' | 'input' | 'full'
type MyNoteExpandState = { userNote: string; aiText: string; status: 'idle' | 'expanding' | 'expanded' }
type WsStatus = 'idle' | 'connecting' | 'live' | 'stopped'
type TranslatedPageTexts = {
  bullets: string[]
  aiComments: (string | null)[]
  supplement: string | null
  aiExpansion: string | null
}

interface AnnotationItem {
  id: string
  text: string
}

export interface NotesPanelProps {
  sessionId: string
  currentPage: number
  pageData: PageData | null
  notesPanelWidth?: number
  noteMode: NoteMode
  onNoteModeChange: (mode: NoteMode) => void
  isLive?: boolean
  subtitleLines?: string[]
  wsStatus?: WsStatus
  getMyNoteText: (pageNum: number) => string
  onMyNoteChange: (pageNum: number, text: string) => void
  myNoteExpandState: MyNoteExpandState
  onExpandMyNote: (pageNum: number) => void
  annotations: AnnotationItem[]
  expandedBullets: Set<number>
  animatedBullets: Set<number>
  onBulletToggle: (bulletIndex: number) => void
  onBulletAnimationDone: (bulletIndex: number) => void
  pageRevealed: boolean
  onTimestampClick: (seconds: number) => void
  onSegmentPlay: (seg: AlignedSegment, idx: number) => void
  playingSegIdx: number | null
  playProgress: number
  transcriptClickCount: number
  translationEnabled?: boolean
  translatedPage?: TranslatedPageTexts
  retrying: number | null
  onRetryPage: (pageNum: number) => void
  pageChat: PageChatMessage[]
  pageChatInput: string
  onPageChatInputChange: (value: string) => void
  pageChatStreaming: boolean
  pageChatStreamingText: string
  onPageChatSend: () => void
  drawerPhase: DrawerPhase
  onDrawerPhaseChange: (phase: DrawerPhase) => void
  drawerHeightPx: number | null
  onDrawerHeightChange: (height: number | null) => void
  drawerModel: string
  onDrawerModelChange: (model: string) => void
  drawerModelDDOpen: boolean
  onDrawerModelDDOpenChange: (open: boolean) => void
  pagePhase?: 'upload' | 'processing' | 'ready'
  transcriptJustDone?: boolean
  aiNotesJustDone?: boolean
  hasAnyAlignedSegments?: boolean
  hasPendingAiNotes?: boolean
  draftOutlineLines: string[]
  fullscreen?: boolean
  onFullscreen?: (on: boolean) => void
}

const MODELS = [
  { id: 'Auto', label: 'Auto（中转站）', logo: '✦', cls: 'logo-auto' },
  { id: '中转站', label: '中转站', logo: '✦', cls: 'logo-claude' },
  { id: '通义千问', label: '通义千问', logo: 'Q', cls: 'logo-qwen' },
  { id: 'DeepSeek', label: 'DeepSeek', logo: 'D', cls: 'logo-deepseek' },
  { id: '豆包', label: '豆包', logo: 'B', cls: 'logo-doubao' },
] as const

export default function NotesPanel({
  sessionId,
  currentPage,
  pageData,
  notesPanelWidth,
  noteMode,
  onNoteModeChange,
  isLive = false,
  subtitleLines = [],
  wsStatus = 'idle',
  getMyNoteText,
  onMyNoteChange,
  myNoteExpandState,
  onExpandMyNote,
  annotations,
  expandedBullets,
  animatedBullets,
  onBulletToggle,
  onBulletAnimationDone,
  pageRevealed,
  onTimestampClick,
  onSegmentPlay,
  playingSegIdx,
  playProgress,
  transcriptClickCount,
  translationEnabled,
  translatedPage,
  retrying,
  onRetryPage,
  pageChat,
  pageChatInput,
  onPageChatInputChange,
  pageChatStreaming,
  pageChatStreamingText,
  onPageChatSend,
  drawerPhase,
  onDrawerPhaseChange,
  drawerHeightPx,
  onDrawerHeightChange,
  drawerModel,
  onDrawerModelChange,
  drawerModelDDOpen,
  onDrawerModelDDOpenChange,
  pagePhase = 'ready',
  transcriptJustDone = false,
  aiNotesJustDone = false,
  hasAnyAlignedSegments = false,
  hasPendingAiNotes = false,
  draftOutlineLines,
  fullscreen = false,
  onFullscreen,
}: NotesPanelProps) {
  const { t } = useTranslation()
  const pageChatBottomRef = useRef<HTMLDivElement>(null)
  const drawerModelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!drawerModelDDOpen) return

    const handler = (event: MouseEvent) => {
      if (drawerModelBtnRef.current?.contains(event.target as Node)) return
      onDrawerModelDDOpenChange(false)
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [drawerModelDDOpen, onDrawerModelDDOpenChange])

  useEffect(() => {
    pageChatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pageChat, pageChatStreamingText])

  const myText = getMyNoteText(currentPage)
  const hasMyNote = myText.trim().length > 0
  const isExpanding = myNoteExpandState.status === 'expanding'
  const isExpanded = myNoteExpandState.status === 'expanded'
  const pageAnnotations = annotations.filter((item) => item.text.trim())
  const drawerHeight =
    drawerPhase === 'full'
      ? drawerHeightPx != null
        ? `${drawerHeightPx}px`
        : '80%'
      : drawerPhase === 'input'
        ? '210px'
        : '0px'

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={
        fullscreen
          ? { position: 'fixed', inset: 0, zIndex: 50, background: C.white }
          : { width: notesPanelWidth != null ? `${notesPanelWidth}px` : '100%', background: C.white, position: 'relative' }
      }
    >
      <div
        className="flex-shrink-0 flex items-end"
        style={{ padding: '14px 18px 0', borderBottom: `1px solid ${C.divider}`, gap: 0 }}
      >
        <div className="flex-1 flex items-end">
        {(['my', 'ai', 'transcript'] as const).map((mode) => {
          const label =
            mode === 'my'
              ? t('notes_my_tab')
              : mode === 'ai'
                ? t('notes_ai_tab')
                : t('notes_transcript_tab')
          const active = noteMode === mode

          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onNoteModeChange(mode)}
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
              {mode === 'transcript' && pagePhase === 'processing' && !hasAnyAlignedSegments && (
                <span
                  className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin"
                  style={{
                    borderWidth: '1.5px',
                    borderColor: '#D0CFC5',
                    borderTopColor: '#EC4899',
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {mode === 'transcript' && transcriptJustDone && (
                <span
                  style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}
                >
                  ✓
                </span>
              )}
              {mode === 'ai' && pagePhase === 'processing' && hasPendingAiNotes && (
                <span
                  className="inline-block ml-1 w-2.5 h-2.5 border border-transparent rounded-full animate-spin"
                  style={{
                    borderWidth: '1.5px',
                    borderColor: '#D0CFC5',
                    borderTopColor: '#8B5CF6',
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {mode === 'ai' && aiNotesJustDone && (
                <span
                  style={{ color: '#10B981', fontSize: '10px', marginLeft: '4px', verticalAlign: 'middle' }}
                >
                  ✓
                </span>
              )}
            </button>
          )
        })}
        </div>
        {onFullscreen && noteMode === 'my' && (
          <button
            type="button"
            onClick={() => onFullscreen(!fullscreen)}
            title={fullscreen ? '退出全屏' : '全屏笔记'}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              marginBottom: '6px',
              background: 'none',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: C.muted,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4" onWheel={(event) => event.stopPropagation()}>
        {noteMode === 'my' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <textarea
              value={myText}
              onChange={(event) => onMyNoteChange(currentPage, event.target.value)}
              placeholder={t('notes_my_placeholder')}
              style={{
                flex: 1,
                width: '100%',
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: C.fg,
                fontSize: '13px',
                lineHeight: '1.7',
                fontFamily: 'inherit',
                minHeight: '200px',
                boxSizing: 'border-box',
                padding: '0',
                paddingTop: '12px',
              }}
            />
          </div>
        ) : noteMode === 'ai' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {(() => {
              if (!hasMyNote && !isExpanded && pageAnnotations.length === 0) return null

              return (
                <div style={{ paddingTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: '700',
                        letterSpacing: '0.08em',
                        color: '#72726E',
                      }}
                    >
                      {t('notes_my_notes_heading')}
                    </span>
                    {hasMyNote && (
                      <button
                        type="button"
                        onClick={() => onExpandMyNote(currentPage)}
                        disabled={isExpanding}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: `1px solid ${isExpanding ? '#6366f1' : C.divider}`,
                          background: isExpanding ? 'rgba(99,102,241,0.08)' : 'transparent',
                          color: isExpanding ? '#6366f1' : C.muted,
                          fontSize: '11px',
                          fontWeight: '500',
                          cursor: isExpanding ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                            fill={isExpanding ? '#6366f1' : '#72726E'}
                          />
                        </svg>
                        {isExpanding ? t('notes_expanding') : t('notes_expand')}
                      </button>
                    )}
                  </div>

                  {hasMyNote && (
                    <p
                      style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}
                    >
                      {myText}
                    </p>
                  )}

                  {pageAnnotations.length > 0 && (
                    <div
                      style={{
                        marginTop: hasMyNote ? '10px' : '0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          letterSpacing: '0.06em',
                          color: C.muted,
                        }}
                      >
                        {t('notes_annotation_label')}
                      </span>
                      {pageAnnotations.map((annotation) => (
                        <p
                          key={annotation.id}
                          style={{
                            fontSize: '13px',
                            color: C.fg,
                            lineHeight: '1.6',
                            margin: 0,
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: C.sidebar,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {annotation.text}
                        </p>
                      ))}
                    </div>
                  )}

                  {(isExpanding || isExpanded) && myNoteExpandState.aiText && (
                    <div
                      style={{
                        marginTop: '10px',
                        paddingLeft: '14px',
                        borderLeft: '2px solid rgba(85,96,113,0.2)',
                      }}
                    >
                      {isExpanding ? (
                        <div style={{ fontSize: '13px', color: '#72726E', lineHeight: '1.7' }}>
                          {renderMd(myNoteExpandState.aiText)}
                          <span style={{ opacity: 0.5 }}>▋</span>
                        </div>
                      ) : (
                        <StreamingExpandText text={myNoteExpandState.aiText} />
                      )}
                    </div>
                  )}

                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', marginBottom: '4px' }}
                  >
                    <div style={{ flex: 1, height: '1px', background: C.divider }} />
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: '700',
                        letterSpacing: '0.1em',
                        color: C.muted,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      AI NOTES
                    </span>
                    <div style={{ flex: 1, height: '1px', background: C.divider }} />
                  </div>
                </div>
              )
            })()}

            {pageData?.active_notes ? (
              <div>
                <div className="mb-3">
                  <span
                    style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: C.muted }}
                  >
                    ACTIVE ANNOTATION
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ fontSize: '11px', color: '#D0CFC5', fontWeight: '500' }}>
                    {formatTime(pageData.page_start_time)}
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(175,179,176,0.3)' }} />
                </div>
                <p
                  style={{
                    fontSize: '14px',
                    color: C.fg,
                    fontWeight: '500',
                    lineHeight: '1.6',
                    marginBottom: '12px',
                  }}
                >
                  {pageData.active_notes.user_note}
                </p>
                <div style={{ borderLeft: '2px solid rgba(85,96,113,0.2)', paddingLeft: '16px' }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                        fill="#72726E"
                      />
                    </svg>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: '700',
                        letterSpacing: '0.08em',
                        color: C.secondary,
                        textTransform: 'uppercase',
                      }}
                    >
                      AI Clarification
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '14px',
                      color: C.fg,
                      lineHeight: '1.6',
                      opacity: translationEnabled && !translatedPage?.aiExpansion ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {translationEnabled && translatedPage?.aiExpansion
                      ? translatedPage.aiExpansion
                      : pageData.active_notes.ai_expansion}
                  </p>
                </div>
              </div>
            ) : null}

            {pageData?.passive_notes?.error && (
              <div
                className="rounded-lg p-4"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#B45309' }}>
                    笔记生成失败
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#92400E', lineHeight: '1.5', marginBottom: '8px' }}>
                  {pageData.passive_notes.error}
                </p>
                <button
                  onClick={() => onRetryPage(pageData.page_num)}
                  disabled={retrying === pageData.page_num}
                  className="text-xs px-3 py-1.5 rounded cursor-pointer transition-all duration-150 disabled:opacity-50"
                  style={{
                    background: '#F59E0B',
                    color: C.white,
                    border: 'none',
                    fontWeight: '500',
                  }}
                >
                  {retrying === pageData.page_num ? '重新生成中…' : '重新生成'}
                </button>
              </div>
            )}

            {!isLive && pageData?.passive_notes?.bullets && pageData.passive_notes.bullets.length > 0 && (
              <div>
                <div className="mb-3">
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: '800',
                      letterSpacing: '0.1em',
                      color: '#777C79',
                      textTransform: 'uppercase',
                    }}
                  >
                    AI Notes
                  </span>
                </div>
                <div
                  className={pageRevealed ? 'ai-bullet-reveal' : ''}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                >
                  {pageData.passive_notes.bullets.map((bullet, index) => (
                    <AiBulletRow
                      key={`${currentPage}-${index}`}
                      bullet={bullet}
                      expanded={expandedBullets.has(index)}
                      animationDone={animatedBullets.has(index)}
                      onToggle={() => onBulletToggle(index)}
                      onAnimationDone={() => onBulletAnimationDone(index)}
                      onTimestampClick={onTimestampClick}
                      translationEnabled={translationEnabled}
                      translatedPptText={translatedPage?.bullets[index]}
                      translatedAiComment={translatedPage?.aiComments[index]}
                      sessionId={sessionId}
                      pageNum={currentPage}
                      bulletIndex={index}
                    />
                  ))}
                </div>
              </div>
            )}

            {isLive && (
              <div style={{ padding: '32px 24px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
                课程结束后自动生成 AI 纪要
              </div>
            )}

            {pagePhase === 'processing' && !pageData?.passive_notes && pageData?.ppt_text && !isLive && (
              <div
                className="ai-bullet-placeholder"
                style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {draftOutlineLines.map((line, index) => {
                  const isBullet = line.startsWith('• ')
                  if (!isBullet) {
                    return (
                      <div
                        key={`draft-h-${index}`}
                        style={{
                          fontSize: '13px',
                          lineHeight: '1.5',
                          color: '#8C8F8D',
                          fontWeight: 600,
                          marginTop: index === 0 ? 0 : 4,
                        }}
                      >
                        {line}
                      </div>
                    )
                  }

                  return (
                    <div key={`draft-b-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ color: '#AFB3B0', marginTop: '2px' }}>•</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', lineHeight: '1.7', color: C.muted }}>
                          {line.slice(2)}
                        </div>
                        <div
                          style={{
                            marginTop: '4px',
                            height: '6px',
                            width: `${70 + ((index * 13) % 25)}%`,
                            borderRadius: '999px',
                            background: 'rgba(175,179,176,0.18)',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span
                    className="inline-block w-3 h-3 border-2 border-transparent rounded-full animate-spin"
                    style={{ borderColor: '#D0CFC5', borderTopColor: '#8B5CF6' }}
                  />
                  <span style={{ fontSize: '11px', color: C.muted }}>AI 正在生成笔记...</span>
                </div>
              </div>
            )}

            {!pageData?.active_notes &&
              !pageData?.passive_notes?.error &&
              (!pageData?.passive_notes || pageData.passive_notes.bullets.length === 0) &&
              !(pagePhase === 'processing' && pageData?.ppt_text) &&
              !isLive && (
                <div className="flex items-center justify-center py-8">
                  <p style={{ fontSize: '13px', color: C.muted }}>{t('notes_no_ai_notes')}</p>
                </div>
              )}

            {pageData?.page_supplement && (
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
                      onClick={() => onTimestampClick(pageData.page_supplement!.timestamp_start)}
                      className="text-xs cursor-pointer transition-all duration-150 hover:opacity-70"
                      style={{ color: '#D0CFC5', background: 'none', border: 'none', padding: 0 }}
                    >
                      {formatTime(pageData.page_supplement.timestamp_start)} -{' '}
                      {formatTime(pageData.page_supplement.timestamp_end)}
                    </button>
                  </div>
                  <p
                    style={{
                      fontSize: '13px',
                      color: C.fg,
                      lineHeight: '1.6',
                      opacity: translationEnabled && !translatedPage?.supplement ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {translationEnabled && translatedPage?.supplement
                      ? translatedPage.supplement
                      : pageData.page_supplement.content}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
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

            {isLive && wsStatus !== 'stopped' ? (
              subtitleLines.length > 0 ? (
                subtitleLines.map((line, index) => (
                  <div
                    key={`${currentPage}-subtitle-${index}`}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '6px',
                      background: index === subtitleLines.length - 1 ? 'rgba(85,107,47,0.08)' : 'transparent',
                    }}
                  >
                    <p style={{ fontSize: '13px', color: C.fg, lineHeight: '1.6', margin: 0 }}>{line}</p>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center py-8">
                  <p style={{ fontSize: '13px', color: C.muted }}>实时字幕准备中…</p>
                </div>
              )
            ) : pageData?.aligned_segments && pageData.aligned_segments.length > 0 ? (
              pageData.aligned_segments.map((seg, index) => (
                <div
                  key={index}
                  onClick={() => onSegmentPlay(seg, index)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '10px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: playingSegIdx === index ? 'rgba(85,107,47,0.08)' : 'transparent',
                    transition: 'background 120ms',
                    borderLeft: playingSegIdx === index ? '2px solid #6B7F3A' : '2px solid transparent',
                  }}
                  onMouseEnter={(event) => {
                    if (playingSegIdx !== index) {
                      ;(event.currentTarget as HTMLDivElement).style.background = 'rgba(175,179,176,0.12)'
                    }
                  }}
                  onMouseLeave={(event) => {
                    if (playingSegIdx !== index) {
                      ;(event.currentTarget as HTMLDivElement).style.background = 'transparent'
                    }
                  }}
                >
                  {playingSegIdx === index ? (
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
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          bottom: 0,
                          width: `${playProgress * 100}%`,
                          background: '#6B7F3A',
                          transition: 'width 80ms linear',
                          borderRadius: '999px',
                        }}
                      />
                      <span style={{ position: 'relative', color: '#6B7F3A', zIndex: 1 }}>
                        {formatTime(seg.start)}
                      </span>
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          bottom: 0,
                          right: 0,
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
        )}
      </div>

      {noteMode !== 'transcript' && (
        <>
          {drawerPhase !== 'closed' && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: drawerHeight,
                zIndex: 25,
                cursor: 'default',
              }}
              onClick={() => {
                onDrawerModelDDOpenChange(false)
                onDrawerPhaseChange('closed')
              }}
            />
          )}

          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: C.white,
              borderRadius: '14px 14px 0 0',
              boxShadow:
                drawerPhase !== 'closed'
                  ? `0 -1px 0 ${C.divider}, 0 -10px 36px rgba(0,0,0,0.07)`
                  : 'none',
              zIndex: 30,
              height: drawerHeight,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              transition: 'height 0.42s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.2s ease',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                height: '14px',
                cursor: 'ns-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const startY = event.clientY
                const aside = event.currentTarget.closest('aside') as HTMLElement | null
                const asideHeight = aside?.getBoundingClientRect().height ?? 600
                const startHeight = drawerHeightPx ?? asideHeight * 0.8

                const onMove = (moveEvent: MouseEvent) => {
                  const delta = startY - moveEvent.clientY
                  const next = Math.min(Math.max(startHeight + delta, 180), asideHeight - 52)
                  onDrawerHeightChange(next)
                }

                const onUp = () => {
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }

                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '3px',
                  borderRadius: '2px',
                  background: '#D0CFC5',
                }}
              />
            </div>

            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px 9px',
                borderBottom: `1px solid ${C.divider}`,
                opacity: drawerPhase !== 'closed' ? 1 : 0,
                transition: 'opacity 0.18s ease 0.1s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: C.fg,
                }}
              >
                AI Chat
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    color: C.secondary,
                    background: C.sidebar,
                    border: `1px solid ${C.divider}`,
                    borderRadius: '4px',
                    padding: '1px 6px',
                  }}
                >
                  Page {currentPage}
                </span>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onDrawerPhaseChange('closed')
                }}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: C.secondary,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div
              ref={pageChatBottomRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                opacity: drawerPhase === 'full' ? 1 : 0,
                transition: 'opacity 0.22s ease',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {pageChat.map((msg, index) => (
                <div
                  key={index}
                  style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    style={{
                      maxWidth: '86%',
                      padding: '7px 11px',
                      fontSize: '13px',
                      lineHeight: '1.55',
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? C.fg : C.sidebar,
                      color: msg.role === 'user' ? C.white : C.fg,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {pageChatStreaming && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '86%',
                      padding: '7px 11px',
                      fontSize: '13px',
                      lineHeight: '1.55',
                      borderRadius: '12px 12px 12px 2px',
                      background: C.sidebar,
                      color: C.fg,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {pageChatStreamingText ? (
                      <>
                        {pageChatStreamingText}
                        <span style={{ opacity: 0.5 }}>▋</span>
                      </>
                    ) : (
                      <span style={{ opacity: 0.5 }}>
                        正在思考
                        <span
                          style={{
                            display: 'inline-block',
                            animation: 'ellipsis 1.2s steps(3, end) infinite',
                            width: '1.5em',
                            overflow: 'hidden',
                            verticalAlign: 'bottom',
                          }}
                        >
                          ...
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                flexShrink: 0,
                padding: '10px 14px 14px',
                opacity: drawerPhase !== 'closed' ? 1 : 0,
                transform: drawerPhase !== 'closed' ? 'translateY(0)' : 'translateY(5px)',
                transition: 'opacity 0.2s ease 0.14s, transform 0.2s ease 0.14s',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: C.sidebar,
                  border: `1px solid ${C.divider}`,
                  borderRadius: '5px',
                  padding: '2px 7px',
                  fontSize: '11px',
                  color: C.secondary,
                  marginBottom: '7px',
                }}
              >
                📄 Page {currentPage}
              </div>

              <div
                style={{
                  border: `1.5px solid ${C.divider}`,
                  borderRadius: '10px',
                  padding: '8px 11px 6px',
                }}
              >
                <textarea
                  rows={1}
                  value={pageChatInput}
                  onChange={(event) => onPageChatInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      if (pageChatInput.trim()) {
                        onDrawerPhaseChange('full')
                        onPageChatSend()
                      }
                    }
                  }}
                  placeholder={t('notes_page_chat_placeholder')}
                  style={{
                    width: '100%',
                    resize: 'none',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: C.fg,
                    fontFamily: 'inherit',
                    maxHeight: '80px',
                    overflowY: 'auto',
                    caretColor: '#798C00',
                    display: 'block',
                    minHeight: '34px',
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '6px',
                    borderTop: `1px solid ${C.divider}`,
                    marginTop: '4px',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <button
                      ref={drawerModelBtnRef}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDrawerModelDDOpenChange(!drawerModelDDOpen)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: C.secondary,
                        background: C.sidebar,
                        border: `1px solid ${C.divider}`,
                        cursor: 'pointer',
                      }}
                    >
                      {drawerModel}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {drawerModelDDOpen &&
                      (() => {
                        const rect = drawerModelBtnRef.current?.getBoundingClientRect()
                        return createPortal(
                          <div
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              position: 'fixed',
                              bottom: rect ? window.innerHeight - rect.top + 6 : 'auto',
                              left: rect ? rect.left : 0,
                              width: '220px',
                              background: C.white,
                              borderRadius: '10px',
                              boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
                              padding: '5px 0',
                              zIndex: 9999,
                            }}
                          >
                            {MODELS.map((model, index) => (
                              <div key={model.id}>
                                {index === 1 && (
                                  <div style={{ height: '1px', background: C.divider, margin: '3px 0' }} />
                                )}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                  }}
                                  onClick={() => {
                                    onDrawerModelChange(model.id)
                                    onDrawerModelDDOpenChange(false)
                                  }}
                                  onMouseEnter={(event) => {
                                    ;(event.currentTarget as HTMLElement).style.background = C.sidebar
                                  }}
                                  onMouseLeave={(event) => {
                                    ;(event.currentTarget as HTMLElement).style.background = 'transparent'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                    <div
                                      style={{
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize:
                                          model.cls === 'logo-qwen' ||
                                          model.cls === 'logo-deepseek' ||
                                          model.cls === 'logo-doubao'
                                            ? '9px'
                                            : '11px',
                                        fontWeight: '700',
                                        color: '#fff',
                                        background:
                                          model.cls === 'logo-auto'
                                            ? 'linear-gradient(135deg,#EAE9E0,#D0CFC5)'
                                            : model.cls === 'logo-claude'
                                              ? '#d97757'
                                              : model.cls === 'logo-qwen'
                                                ? '#5B8FF9'
                                                : model.cls === 'logo-deepseek'
                                                  ? '#2563EB'
                                                  : model.cls === 'logo-doubao'
                                                    ? '#1DB954'
                                                    : '#798C00',
                                        ...(model.cls === 'logo-auto' ? { color: '#798C00' } : {}),
                                      }}
                                    >
                                      {model.logo}
                                    </div>
                                    <span style={{ fontSize: '13px', color: C.fg }}>
                                      {model.label}
                                      {index > 0 && (
                                        <span
                                          style={{
                                            fontSize: '10px',
                                            color: '#798C00',
                                            background: 'rgba(121,140,0,0.10)',
                                            borderRadius: '4px',
                                            padding: '1px 5px',
                                            marginLeft: '5px',
                                            fontWeight: '500',
                                          }}
                                        >
                                          Beta
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  {drawerModel === model.id && (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#798C00" strokeWidth="2.5" strokeLinecap="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>,
                          document.body,
                        )
                      })()}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '5px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: C.muted,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <rect x="9" y="2" width="6" height="11" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                        <line x1="9" y1="22" x2="15" y2="22" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (pageChatInput.trim()) {
                          onDrawerPhaseChange('full')
                          onPageChatSend()
                        }
                      }}
                      disabled={pageChatStreaming || !pageChatInput.trim()}
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        border: 'none',
                        background: pageChatStreaming || !pageChatInput.trim() ? C.muted : '#798C00',
                        color: C.white,
                        cursor: pageChatStreaming || !pageChatInput.trim() ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.15s',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

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
                onClick={() => onDrawerPhaseChange('input')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  background: C.sidebar,
                  border: `1px solid ${C.divider}`,
                  borderRadius: '14px',
                  padding: '9px 14px',
                  cursor: 'text',
                }}
              >
                <div
                  style={{
                    width: '17px',
                    height: '17px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: 'conic-gradient(from 0deg, #798C00, #b5c833, #798C00)',
                  }}
                />
                <span style={{ fontSize: '13px', color: C.muted }}>Ask AI about this page…</span>
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
