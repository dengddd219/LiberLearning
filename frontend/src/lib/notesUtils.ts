import React from 'react'

export const FONT_SERIF = "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"

export const C = {
  bg: '#F7F7F2',
  sidebar: '#F2F2EC',
  fg: '#292929',
  secondary: '#72726E',
  muted: '#D0CFC5',
  dark: '#292929',
  white: '#FFFFFF',
  divider: '#E3E3DA',
}

const SWEEP_STYLE_ID = 'ai-sweep-animation'

export function injectNoteStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(SWEEP_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = SWEEP_STYLE_ID
  style.textContent = `
    @keyframes ai-shimmer-sweep {
      0% { background-position: 200% 50%; }
      100% { background-position: -100% 50%; }
    }
    @keyframes ellipsis {
      0%   { width: 0; }
      33%  { width: 0.5em; }
      66%  { width: 1em; }
      100% { width: 1.5em; }
    }
    .ai-bullet-reveal {
      color: transparent;
      background: linear-gradient(110deg, #333333 40%, #ffffff 50%, #333333 60%);
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: ai-shimmer-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .ai-bullet-placeholder {
      color: #999999;
      transition: opacity 0.3s ease;
    }
  `
  document.head.appendChild(style)
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const ABSOLUTE_URL_RE = /^https?:\/\//i

export function withApiBase(url?: string | null): string | null {
  if (!url) return null
  return ABSOLUTE_URL_RE.test(url) ? url : `${API_BASE}${url}`
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function stripBullet(text: string): string {
  return text.replace(/^[\s\u2022\u25CF\u00B7\-–—]+/u, '')
}

export function renderMd(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  const inlineBold = (value: string, key: string): React.ReactNode => {
    const parts = value.split(/(\*\*[^*]+\*\*)/)
    return React.createElement(
      'span',
      { key },
      ...parts.map((part, index) =>
        part.startsWith('**') && part.endsWith('**')
          ? React.createElement('strong', { key: index, style: { fontWeight: 600 } }, part.slice(2, -2))
          : part,
      ),
    )
  }

  lines.forEach((line, index) => {
    if (line.startsWith('## ')) {
      nodes.push(
        React.createElement(
          'div',
          {
            key: index,
            style: {
              fontWeight: 600,
              fontSize: '14px',
              marginTop: index === 0 ? 0 : '10px',
              marginBottom: '4px',
              color: '#292929',
            },
          },
          inlineBold(line.slice(3), `h${index}`),
        ),
      )
      return
    }

    if (line.startsWith('- ')) {
      nodes.push(
        React.createElement(
          'div',
          { key: index, style: { display: 'flex', gap: '6px', marginBottom: '2px' } },
          React.createElement('span', { style: { flexShrink: 0, marginTop: '2px', color: '#72726E' } }, '•'),
          React.createElement('span', null, inlineBold(line.slice(2), `b${index}`)),
        ),
      )
      return
    }

    if (line.trim() === '') {
      nodes.push(React.createElement('div', { key: index, style: { height: '4px' } }))
      return
    }

    nodes.push(React.createElement('div', { key: index }, inlineBold(line, `t${index}`)))
  })

  return React.createElement(React.Fragment, null, ...nodes)
}
