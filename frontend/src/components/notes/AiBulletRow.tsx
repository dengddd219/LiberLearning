import { useEffect, useState } from 'react'
import { useTranslation } from '../../context/TranslationContext'
import type { Bullet } from '../../lib/notesTypes'
import { C, stripBullet } from '../../lib/notesUtils'
import InlineQA from './InlineQA'
import LineByLineReveal from './LineByLineReveal'
import RevealText from './RevealText'

interface AiBulletRowProps {
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
}

export default function AiBulletRow({
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
}: AiBulletRowProps) {
  const { t } = useTranslation()
  const hasComment = !!bullet.ai_comment
  const indent = bullet.level * 16
  const isTitleLine = bulletIndex === 0
  const [hovered, setHovered] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set())
  const [pptExiting, setPptExiting] = useState(false)
  const [pptSwipedAway, setPptSwipedAway] = useState(animationDone)
  const [startAiLineReveal, setStartAiLineReveal] = useState(false)

  useEffect(() => {
    if (!expanded) {
      if (!animationDone) {
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
      const timer = window.setTimeout(fn, delay)
      timers.push(timer)
      return timer
    }

    setPptExiting(true)
    after(320, () => {
      setPptSwipedAway(true)
      setRevealedSet(new Set([0]))
      after(300, () => {
        setRevealedSet(new Set([0, 1]))
        after(250, () => {
          setStartAiLineReveal(true)
        })
      })
    })

    return () => timers.forEach(clearTimeout)
  }, [expanded, animationDone])

  const pptRevealed = revealedSet.has(0)
  const labelRevealed = revealedSet.has(1)
  const pptText = translationEnabled && translatedPptText ? translatedPptText : stripBullet(bullet.ppt_text)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
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
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => {
            if (hasComment) onToggle()
          }}
          className="text-left w-full"
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 0',
            cursor: hasComment ? 'pointer' : 'default',
            display: pptSwipedAway ? 'none' : 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            userSelect: 'text',
            width: '100%',
            ...(pptExiting ? { animation: 'swipe-up 0.32s ease-in forwards' } : {}),
          }}
        >
          <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
            {bullet.level === 0 ? '' : '•'}
          </span>
          <span
            style={{
              fontSize: isTitleLine ? '15px' : '14px',
              color: '#292929',
              lineHeight: '1.625',
              fontWeight: isTitleLine ? '700' : '400',
              opacity: !expanded
                ? translationEnabled && !translatedPptText
                  ? 0.4
                  : hasComment
                    ? 1
                    : 0.5
                : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {pptText}
          </span>
          {!expanded && hasComment && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: '4px', color: '#D0CFC5' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>

        {pptSwipedAway && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0' }}>
            <span style={{ color: '#D0CFC5', flexShrink: 0, marginTop: '2px', fontSize: '14px' }}>
              {bullet.level === 0 ? '' : '•'}
            </span>
            <p
              style={{
                fontSize: isTitleLine ? '15px' : '14px',
                lineHeight: '1.625',
                fontWeight: isTitleLine ? '700' : '400',
                margin: 0,
                minHeight: '1.4em',
              }}
            >
              {animationDone ? (
                <span style={{ color: '#292929' }}>{pptText}</span>
              ) : (
                <RevealText revealed={pptRevealed} muted={false} highlight={false}>
                  {pptText}
                </RevealText>
              )}
            </p>
          </div>
        )}
      </div>

      {hasComment && (animationDone || labelRevealed) && (
        <div
          style={{
            marginLeft: '18px',
            paddingLeft: '14px',
            borderLeft: '2px solid rgba(85,96,113,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '1.4em' }}>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{ display: 'inline', transform: 'translateY(1px)' }}
              >
                <path
                  d="M12 2L14.09 8.26L21 9.27L16 13.97L17.18 21L12 17.77L6.82 21L8 13.97L3 9.27L9.91 8.26L12 2Z"
                  fill="#72726E"
                />
              </svg>
            </RevealText>
            <RevealText revealed={labelRevealed} muted={false} highlight={false}>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  letterSpacing: '0.08em',
                  color: '#72726E',
                  textTransform: 'uppercase',
                }}
              >
                AI Clarification
              </span>
            </RevealText>
            {bullet.timestamp_start >= 0 && (
              <RevealText revealed={labelRevealed} muted={false} highlight={false}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onTimestampClick(bullet.timestamp_start)
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '9px',
                    color: '#D0CFC5',
                    fontWeight: '700',
                    padding: 0,
                    marginLeft: '4px',
                  }}
                >
                  {String(Math.floor(bullet.timestamp_start / 60)).padStart(2, '0')}:
                  {String(Math.floor(bullet.timestamp_start % 60)).padStart(2, '0')}
                </button>
              </RevealText>
            )}
          </div>

          <div
            style={{
              opacity: translationEnabled && !translatedAiComment ? 0.4 : 1,
              transition: 'opacity 0.2s',
              position: 'relative',
            }}
          >
            {translationEnabled && translatedAiComment ? (
              <p
                style={{
                  fontSize: '14px',
                  lineHeight: '1.625',
                  fontWeight: '400',
                  margin: 0,
                  userSelect: 'text',
                  color: '#72726E',
                }}
              >
                {translatedAiComment}
              </p>
            ) : animationDone ? (
              <p
                style={{
                  fontSize: '14px',
                  lineHeight: '1.625',
                  fontWeight: '400',
                  margin: 0,
                  userSelect: 'text',
                  color: '#72726E',
                }}
              >
                {bullet.ai_comment}
              </p>
            ) : (
              <LineByLineReveal
                text={bullet.ai_comment as string}
                startReveal={startAiLineReveal}
                onDone={onAnimationDone}
              />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button
              type="button"
              onClick={() => setAskOpen((value) => !value)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                border: `1px solid ${C.secondary}`,
                background: askOpen ? C.secondary : 'transparent',
                color: askOpen ? '#fff' : C.secondary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {askOpen ? t('notes_bullet_collapse') : t('notes_bullet_ask')}
            </button>
          </div>

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
