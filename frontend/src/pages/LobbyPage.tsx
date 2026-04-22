import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { listSessions, renameSession, deleteSession } from '../lib/api'
import { useTranslation } from '../context/TranslationContext'
import RunLogModal from '../components/RunLogModal'

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
      <rect x="0" y="0" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="7" y="0" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="0" y="6" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="7" y="6" width="5" height="4" rx="1" fill="currentColor" />
    </svg>
  )
}

function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="m9.5 9.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="1" width="5" height="7" rx="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 7c0 2.76 2.24 5 5 5s5-2.24 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7 12v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M13.1 9.03A5.07 5.07 0 0 0 13.2 8c0-.35-.03-.7-.1-1.03l1.55-1.19-1.5-2.59-1.82.74A5 5 0 0 0 9 3.1V1H7v2.1a5 5 0 0 0-2.13.83l-1.82-.74-1.5 2.59 1.54 1.19A5.05 5.05 0 0 0 2.8 8c0 .35.03.7.09 1.03L1.35 10.22l1.5 2.59 1.82-.74c.62.34 1.33.57 2.13.83V15h2v-2.1c.8-.26 1.51-.49 2.13-.83l1.82.74 1.5-2.59-1.55-1.19Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function IconNotes() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2.7 0.5C1.5 0.5 1.5 1.7 1.5 1.7v10.6S1.5 13.5 2.7 13.5h8.6s1.2 0 1.2-1.2V4.5L8.5 0.5H2.7Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
      />
      <path d="M8.5 0.5L8.5 4.5L12.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M4 7h6M4 9.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
      <path d="M1 2.5C1 1.67 1.67 1 2.5 1H5.5L7 3H12.5C13.33 3 14 3.67 14 4.5V9.5C14 10.33 13.33 11 12.5 11H1.5C0.67 11 0 10.33 0 9.5V2.5Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface Folder {
  id: string
  name: string
}

interface CourseCard {
  id: string
  course: string
  lecture: string
  duration: string
  notes: number
  time: string
  date: string
  thumbColor: string
  folderId: string   // '' = no folder / ungrouped
  status: 'done' | 'processing' | 'live'
}

const FALLBACK_SESSIONS: CourseCard[] = []
const DEFAULT_FOLDER_ID = '__default__'
const DEFAULT_FOLDER_NAME = '我的课程'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return ''
  const diff = (Date.now() / 1000) - ts
  if (diff < 3600) return `${Math.floor(diff / 60)}M AGO`
  if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`
  if (diff < 172800) return 'YESTERDAY'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

const THUMB_COLORS = ['#4A6FA5', '#6B8E6B', '#8B7355', '#7B6B8B', '#5E8B8B', '#8B5E5E']

// ─── Context menu (三点菜单) ───────────────────────────────────────────────────

interface MenuAction {
  label: string
  color: string
  action: () => void
  subItems?: { label: string; action: () => void }[]
}

function ContextMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const [subOpen, setSubOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSubOpen(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-label="更多操作"
        onClick={() => { setOpen(v => !v); setSubOpen(null) }}
        style={{
          width: '24px', height: '24px', borderRadius: '9999px', border: 'none',
          backgroundColor: open ? 'rgba(41,41,41,0.08)' : 'transparent',
          color: '#72726E', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(41,41,41,0.06)' }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
      >
        <svg width="12" height="3" viewBox="0 0 12 3" fill="none">
          <circle cx="1.5" cy="1.5" r="1.3" fill="currentColor" />
          <circle cx="6" cy="1.5" r="1.3" fill="currentColor" />
          <circle cx="10.5" cy="1.5" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '28px', right: '0',
          backgroundColor: '#FFFFFF', borderRadius: '12px',
          boxShadow: '0px 4px 16px -2px rgba(47,51,49,0.14), 0px 0px 0px 1px rgba(175,179,176,0.12)',
          padding: '4px', zIndex: 100, minWidth: '120px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          {actions.map(({ label, action, color, subItems }) => (
            <div key={label} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => {
                  if (subItems) { setSubOpen(subOpen === label ? null : label); return }
                  setOpen(false); action()
                }}
                onMouseEnter={() => { if (subItems) setSubOpen(label) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '7px 12px', textAlign: 'left',
                  background: subOpen === label ? 'rgba(47,51,49,0.05)' : 'none',
                  border: 'none', borderRadius: '8px', fontSize: '13px',
                  fontWeight: 500, color, cursor: 'pointer', transition: 'background-color 0.12s',
                }}
                onMouseLeave={e => {
                  if (!subItems) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                }}
              >
                <span>{label}</span>
                {subItems && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}
              </button>
              {subItems && subOpen === label && (
                <div style={{
                  position: 'absolute', top: '0', left: '100%', marginLeft: '4px',
                  backgroundColor: '#FFFFFF', borderRadius: '12px',
                  boxShadow: '0px 4px 16px -2px rgba(47,51,49,0.14), 0px 0px 0px 1px rgba(175,179,176,0.12)',
                  padding: '4px', zIndex: 101, minWidth: '120px',
                }}>
                  {subItems.map(sub => (
                    <button
                      key={sub.label}
                      type="button"
                      onClick={() => { setOpen(false); setSubOpen(null); sub.action() }}
                      style={{
                        display: 'block', width: '100%', padding: '7px 12px', textAlign: 'left',
                        background: 'none', border: 'none', borderRadius: '8px',
                        fontSize: '13px', fontWeight: 500, color: '#292929', cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(47,51,49,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar folder tree ──────────────────────────────────────────────────────

interface SidebarFolderTreeProps {
  folders: Folder[]
  sessions: CourseCard[]
  activeFolderId: string | null   // null = 全部课程
  activeSessionId?: string
  pendingNewFolderId: string | null
  onFolderClick: (id: string | null) => void
  onSessionClick: (id: string) => void
  onSessionRename: (id: string) => void
  onSessionDelete: (id: string) => void
  onSessionMove: (sessionId: string, toFolderId: string) => void
  onFolderRename: (id: string) => void
  onFolderDelete: (id: string) => void
  onFolderDrop: (sessionId: string, folderId: string) => void
  onNewFolderCommit: (id: string, name: string) => void
  onNewFolderCancel: (id: string) => void
}

function SidebarFolderTree({
  folders, sessions, activeFolderId, activeSessionId, pendingNewFolderId,
  onFolderClick, onSessionClick, onSessionRename, onSessionDelete, onSessionMove,
  onFolderRename, onFolderDelete, onFolderDrop, onNewFolderCommit, onNewFolderCancel,
}: SidebarFolderTreeProps) {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ [DEFAULT_FOLDER_ID]: true })
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [draggingSession, setDraggingSession] = useState<string | null>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pendingNewFolderId && newFolderInputRef.current) {
      newFolderInputRef.current.focus()
      newFolderInputRef.current.select()
    }
  }, [pendingNewFolderId])

  function toggleFolder(id: string) {
    setOpenFolders(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleDragStart(e: React.DragEvent, sessionId: string) {
    e.dataTransfer.setData('sessionId', sessionId)
    setDraggingSession(sessionId)
  }

  function handleDragEnd() {
    setDraggingSession(null)
    setDragOverFolder(null)
  }

  function handleDragOver(e: React.DragEvent, folderId: string) {
    e.preventDefault()
    setDragOverFolder(folderId)
  }

  function handleDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault()
    const sid = e.dataTransfer.getData('sessionId')
    if (sid) onFolderDrop(sid, folderId)
    setDragOverFolder(null)
    setDraggingSession(null)
  }

  const allFolders = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }, ...folders]
  const isAllActive = activeFolderId === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 4px 16px', marginBottom: '2px' }}>
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#72726E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>My Courses</span>
      </div>

      {/* All courses row */}
      <button
        type="button"
        onClick={() => onFolderClick(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '5px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
          backgroundColor: isAllActive ? 'rgba(121,140,0,0.1)' : 'transparent',
          transition: 'background-color 0.12s',
        }}
        onMouseEnter={e => { if (!isAllActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(41,41,41,0.04)' }}
        onMouseLeave={e => { if (!isAllActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" style={{ flexShrink: 0, color: '#72726E' }}>
          <rect x="0.5" y="0.5" width="5.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="8" y="0.5" width="5.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="0.5" y="6.5" width="5.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="8" y="6.5" width="5.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
        </svg>
        <span style={{ fontSize: '12px', fontWeight: isAllActive ? 600 : 400, color: '#292929' }}>全部课程</span>
        <span style={{ fontSize: '10px', color: '#A8A8A0', marginLeft: '2px' }}>
          {sessions.filter(s => s.status === 'done').length}
        </span>
      </button>

      {allFolders.map(folder => {
        const folderSessions = sessions.filter(s => s.folderId === folder.id && s.status === 'done')
        const isOpen = !!openFolders[folder.id]
        const isDragTarget = dragOverFolder === folder.id
        const isFolderActive = activeFolderId === folder.id

        return (
          <div key={folder.id}>
            {/* Folder row */}
            <div
              onDragOver={e => handleDragOver(e, folder.id)}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={e => handleDrop(e, folder.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '4px 4px 4px 8px', borderRadius: '6px',
                backgroundColor: isDragTarget ? 'rgba(121,140,0,0.1)' : isFolderActive ? 'rgba(121,140,0,0.08)' : 'transparent',
                transition: 'background-color 0.12s',
                border: isDragTarget ? '1px dashed #798C00' : '1px solid transparent',
              }}
              onMouseEnter={e => {
                if (!isDragTarget && !isFolderActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(41,41,41,0.04)'
              }}
              onMouseLeave={e => {
                if (!isDragTarget && !isFolderActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
              }}
            >
              <button
                type="button"
                onClick={() => { toggleFolder(folder.id); onFolderClick(folder.id) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                }}
              >
                <span style={{ color: '#72726E', flexShrink: 0 }}><IconChevron open={isOpen} /></span>
                <span style={{ color: '#72726E', flexShrink: 0 }}><IconFolder /></span>
                <span style={{
                  fontSize: '12px', fontWeight: isFolderActive ? 600 : 500, color: '#292929',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{folder.name}</span>
                <span style={{ fontSize: '10px', color: '#A8A8A0', flexShrink: 0, marginLeft: '2px' }}>
                  {folderSessions.length}
                </span>
              </button>
              {folder.id !== DEFAULT_FOLDER_ID && (
                <ContextMenu actions={[
                  { label: '重命名', color: '#292929', action: () => onFolderRename(folder.id) },
                  { label: '删除', color: '#D94F3D', action: () => onFolderDelete(folder.id) },
                ]} />
              )}
            </div>

            {/* Pending new folder inline input */}
            {pendingNewFolderId && folder.id === DEFAULT_FOLDER_ID && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 4px 4px 8px', borderRadius: '6px',
                backgroundColor: 'rgba(121,140,0,0.08)',
              }}>
                <span style={{ color: '#72726E', flexShrink: 0 }}><IconChevron open={false} /></span>
                <span style={{ color: '#72726E', flexShrink: 0 }}><IconFolder /></span>
                <input
                  ref={newFolderInputRef}
                  defaultValue="新文件夹"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim()
                      if (val) onNewFolderCommit(pendingNewFolderId, val)
                      else onNewFolderCancel(pendingNewFolderId)
                    }
                    if (e.key === 'Escape') onNewFolderCancel(pendingNewFolderId)
                  }}
                  onBlur={e => {
                    const val = e.target.value.trim()
                    if (val) onNewFolderCommit(pendingNewFolderId, val)
                    else onNewFolderCancel(pendingNewFolderId)
                  }}
                  style={{
                    flex: 1, minWidth: 0, fontSize: '12px', fontWeight: 500, color: '#292929',
                    border: 'none', borderBottom: '1px solid #798C00', background: 'transparent',
                    outline: 'none', padding: '0 2px',
                  }}
                />
              </div>
            )}

            {/* Session rows (indented) */}
            {isOpen && folderSessions.map(s => (
              <div
                key={s.id}
                draggable
                onDragStart={e => handleDragStart(e, s.id)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  paddingLeft: '24px', paddingRight: '4px', paddingTop: '3px', paddingBottom: '3px',
                  borderRadius: '6px', cursor: 'pointer',
                  opacity: draggingSession === s.id ? 0.4 : 1,
                  transition: 'all 0.12s',
                }}
                className="group"
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(41,41,41,0.04)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'}
              >
                <button
                  type="button"
                  onClick={() => onSessionClick(s.id)}
                  style={{
                    flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', padding: 0,
                  }}
                >
                  <span style={{
                    fontSize: '12px', fontWeight: activeSessionId === s.id ? 600 : 400,
                    color: activeSessionId === s.id ? '#292929' : '#4A4A48',
                    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.course}</span>
                </button>
                <div style={{ flexShrink: 0, opacity: 0 }} className="group-hover:opacity-100"
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '0'}
                >
                  <ContextMenu actions={[
                    { label: '重命名', color: '#292929', action: () => onSessionRename(s.id) },
                    {
                      label: '移动到', color: '#292929', action: () => {},
                      subItems: allFolders
                        .filter(f => f.id !== s.folderId)
                        .map(f => ({ label: f.name, action: () => onSessionMove(s.id, f.id) })),
                    },
                    { label: '删除', color: '#D94F3D', action: () => onSessionDelete(s.id) },
                  ]} />
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ─── Cards ───────────────────────────────────────────────────────────────────

const API_BASE_FOR_THUMB = import.meta.env.VITE_API_BASE_URL || ''

function ProcessingCard() {
  const { t } = useTranslation()
  return (
    <div className="p-6 relative bg-white rounded-[32px] flex flex-col justify-start items-start gap-4" style={{ width: '224px', minHeight: '288px' }}>
      <div className="w-56 h-72 left-0 top-0 absolute bg-white/0 rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
      <div className="self-stretch py-7 rounded-md inline-flex justify-center items-center overflow-hidden" style={{ backgroundColor: '#F2F2EC' }}>
        <div className="inline-flex flex-col justify-start items-start">
          <div className="w-8 h-6 animate-pulse rounded" style={{ backgroundColor: '#D0CFC5' }} />
        </div>
      </div>
      <div className="self-stretch flex flex-col justify-start items-start gap-3">
        <div className="w-32 h-4 rounded-2xl animate-pulse" style={{ backgroundColor: '#F2F2EC' }} />
        <div className="w-20 h-3 rounded-2xl animate-pulse" style={{ backgroundColor: '#F2F2EC' }} />
      </div>
      <div className="self-stretch h-20 min-h-8 pt-12 flex flex-col justify-end items-start">
        <div className="self-stretch pt-4 inline-flex justify-between items-center" style={{ borderTop: '1px solid #E3E3DA' }}>
          <div className="flex justify-start items-start gap-1">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#D0CFC5' }} />
          </div>
          <div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{t('card_processing')}</div>
        </div>
      </div>
    </div>
  )
}

function DoneCard({ card, onClick, onRename, onDelete, onShare }: {
  card: CourseCard
  onClick: () => void
  onRename: () => void
  onDelete: () => void
  onShare: () => void
}) {
  const { t } = useTranslation()
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const thumbSrc = `${API_BASE_FOR_THUMB}/api/sessions/${card.id}/slide/1.png`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      aria-label={`打开课程：${card.course}`}
      className="relative bg-white rounded-[32px] outline outline-1 outline-offset-[-1px] outline-black/0 cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0px_40px_56px_-15px_rgba(47,51,49,0.10)] text-left flex-shrink-0"
      style={{ width: '224px', height: '288px' }}
    >
      <div className="w-56 h-72 left-0 top-0 absolute bg-white/0 rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
      {/* ... menu */}
      <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10 }}>
        <ContextMenu actions={[
          { label: 'Rename', color: '#292929', action: onRename },
          { label: 'Delete', color: '#D94F3D', action: onDelete },
          { label: 'Share', color: '#72726E', action: onShare },
        ]} />
      </div>
      {/* Thumbnail */}
      <div className="w-44 left-[25px] top-[44px] absolute rounded-md inline-flex flex-col justify-center items-start overflow-hidden" style={{ backgroundColor: '#F2F2EC' }}>
        <div className="self-stretch h-24 relative overflow-hidden" style={{ backgroundColor: card.thumbColor, opacity: thumbLoaded ? 1 : 0.85 }}>
          {!thumbError && (
            <img
              src={thumbSrc} alt="" aria-hidden="true"
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbError(true)}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: thumbLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
            />
          )}
        </div>
        <div className="px-2 py-1 absolute rounded-2xl" style={{ right: '8px', bottom: '8px', backgroundColor: 'rgba(41,41,41,0.85)' }}>
          <div className="text-white text-[10.40px] font-normal font-['Liberation_Mono'] leading-4">{card.duration}</div>
        </div>
      </div>
      {/* Info */}
      <div className="w-44 left-[25px] top-[148px] absolute inline-flex flex-col justify-start items-start gap-1">
        <div className="self-stretch pb-[0.69px] flex flex-col justify-start items-start">
          <div className="self-stretch text-base font-bold font-['Inter'] leading-6 truncate" style={{ color: '#292929' }}>{card.course}</div>
        </div>
        <div className="self-stretch flex flex-col justify-start items-start">
          <div className="self-stretch text-xs font-medium font-['Inter'] leading-4 truncate" style={{ color: '#72726E' }}>{card.lecture}</div>
        </div>
      </div>
      {/* Footer */}
      <div className="w-44 pt-4 left-[25px] top-[244px] absolute inline-flex justify-between items-center" style={{ borderTop: '1px solid #E3E3DA' }}>
        {card.status === 'live' ? (
          <div className="flex justify-start items-center gap-1">
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#E05C40' }} />
            <div className="text-xs font-semibold font-['Inter'] leading-4" style={{ color: '#E05C40' }}>进行中</div>
          </div>
        ) : (
          <div className="flex justify-start items-center gap-1">
            <div className="w-3.5 h-3.5 relative" style={{ color: '#72726E' }}><IconNotes /></div>
            <div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.notes} {t('card_notes_suffix')}</div>
          </div>
        )}
        <div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{card.time}</div>
      </div>
    </div>
  )
}

// ─── Grid view (grouped by folder) ───────────────────────────────────────────

function GridView({ sessions, folders, onCardClick, onRename, onDelete, onShare }: {
  sessions: CourseCard[]
  folders: Folder[]
  onCardClick: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onShare: (id: string) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const allFolders = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }, ...folders]
  const processing = sessions.filter(s => s.status === 'processing')

  return (
    <div className="self-stretch flex flex-col gap-10">
      {/* Processing cards first */}
      {processing.length > 0 && (
        <div className="flex flex-wrap gap-6">
          {processing.map(s => <ProcessingCard key={s.id} />)}
        </div>
      )}

      {allFolders.map(folder => {
        const cards = sessions.filter(s => s.folderId === folder.id && (s.status === 'done' || s.status === 'live'))
        if (cards.length === 0) return null
        return (
          <div key={folder.id}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              marginBottom: '16px', color: '#72726E',
            }}>
              <IconFolder />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#292929' }}>{folder.name}</span>
              <span style={{ fontSize: '11px', color: '#A8A8A0' }}>{cards.length}</span>
            </div>
            <div className="flex flex-wrap gap-6">
              {cards.map(s => (
                <DoneCard
                  key={s.id} card={s}
                  onClick={() => onCardClick(s.id)}
                  onRename={() => onRename(s.id)}
                  onDelete={() => onDelete(s.id)}
                  onShare={() => onShare(s.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 w-full">
          <p className="text-sm mb-4" style={{ color: '#D0CFC5' }}>{t('lobby_empty_hint')}</p>
          <button
            onClick={() => navigate('/notes/new')}
            className="px-4 py-2 text-white text-sm rounded-full cursor-pointer hover:opacity-85 border-none"
            style={{ backgroundColor: '#798C00' }}
          >
            {t('lobby_start_first')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListRow({ card, folderName, onClick, isLast, onRename, onDelete, onShare }: {
  card: CourseCard
  folderName: string
  onClick: () => void
  isLast: boolean
  onRename: () => void
  onDelete: () => void
  onShare: () => void
}) {
  const { t } = useTranslation()
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const thumbSrc = `${API_BASE_FOR_THUMB}/api/sessions/${card.id}/slide/1.png`

  return (
    <div
      className={`w-full flex items-center${isLast ? '' : ' border-b'}`}
      style={isLast ? {} : { borderColor: '#E3E3DA' }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`打开课程：${card.course}`}
        className="flex-1 min-w-0 text-left flex items-center cursor-pointer hover:bg-[#F2F2EC]/60 transition-colors"
      >
        {/* Thumbnail */}
        <div className="w-40 px-6 py-7 flex-shrink-0">
          <div className="w-16 h-10 rounded-2xl outline outline-1 outline-offset-[-1px] overflow-hidden relative" style={{ backgroundColor: card.thumbColor, opacity: 0.8, outlineColor: '#E3E3DA' }}>
            {!thumbError && (
              <img
                src={thumbSrc} alt="" aria-hidden="true"
                onLoad={() => setThumbLoaded(true)}
                onError={() => setThumbError(true)}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: thumbLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
              />
            )}
          </div>
        </div>

        {/* Course name & subtitle */}
        <div className="w-56 pl-6 flex-shrink-0 flex flex-col gap-0.5">
          <div className="text-sm font-semibold font-['Inter'] leading-5" style={{ color: '#292929' }}>{card.course}</div>
          <div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.lecture}</div>
        </div>

        {/* Folder badge */}
        <div className="w-48 pl-12 pr-6 py-9 flex-shrink-0">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ backgroundColor: '#E3E3DA' }}>
            <div className="w-2.5 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#72726E' }} />
            <span className="text-[10px] font-medium font-['Inter']" style={{ color: '#72726E' }}>{folderName}</span>
          </div>
        </div>

        {/* Date */}
        <div className="w-28 px-6 py-7 flex-shrink-0 text-sm font-normal font-['Inter'] leading-5" style={{ color: '#72726E' }}>
          {card.date}
        </div>

        {/* Duration */}
        <div className="w-28 px-6 py-7 flex-shrink-0 text-sm font-normal font-['Inter'] leading-5" style={{ color: '#72726E' }}>
          {card.duration}
        </div>

        {/* Notes */}
        <div className="w-32 pl-6 flex-shrink-0 flex items-center gap-2 text-sm font-medium font-['Inter'] leading-5" style={{ color: '#292929' }}>
          {card.status === 'live' ? (
            <>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#E05C40' }} />
              <span style={{ color: '#E05C40', fontWeight: 600 }}>进行中</span>
            </>
          ) : (
            <>
              <IconNotes />
              {card.notes} {t('card_notes_suffix')}
            </>
          )}
        </div>
      </button>

      {/* ... menu */}
      <div className="px-4 flex-shrink-0">
        <ContextMenu actions={[
          { label: 'Rename', color: '#292929', action: onRename },
          { label: 'Delete', color: '#D94F3D', action: onDelete },
          { label: 'Share', color: '#72726E', action: onShare },
        ]} />
      </div>
    </div>
  )
}

function ListTable({ sessions, folders, onRowClick, onRename, onDelete, onShare }: {
  sessions: CourseCard[]
  folders: Folder[]
  onRowClick: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onShare: (id: string) => void
}) {
  const { t } = useTranslation()
  const allFolders = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }, ...folders]
  const folderMap = Object.fromEntries(allFolders.map(f => [f.id, f.name]))
  const done = sessions.filter(s => s.status === 'done' || s.status === 'live')
  return (
    <div className="self-stretch rounded-[32px] shadow-[0px_40px_40px_0px_rgba(47,51,49,0.04)] overflow-hidden" style={{ backgroundColor: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex items-start pr-24" style={{ backgroundColor: 'rgba(247,247,242,0.5)' }}>
        <div className="w-40 px-6 py-4 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_thumbnail').split('\n').map((l, i) => <span key={i}>{l}{i === 0 && <br/>}</span>)}</div>
        <div className="w-56 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_name')}</div>
        <div className="w-48 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_folder')}</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_date')}</div>
        <div className="w-28 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_duration')}</div>
        <div className="w-32 px-6 py-5 flex-shrink-0 text-[10px] font-medium font-['Inter'] uppercase tracking-wide" style={{ color: '#72726E' }}>{t('table_notes')}</div>
      </div>
      {/* Rows */}
      {done.map((card, i) => (
        <ListRow
          key={card.id}
          card={card}
          folderName={folderMap[card.folderId] ?? DEFAULT_FOLDER_NAME}
          onClick={() => onRowClick(card.id)}
          isLast={i === done.length - 1}
          onRename={() => onRename(card.id)}
          onDelete={() => onDelete(card.id)}
          onShare={() => onShare(card.id)}
        />
      ))}
    </div>
  )
}


// ─── Settings Panel ─────────────────────────────────────────────────────────

function SettingsPanel({
  sessions,
  onOpenRunLog,
}: {
  sessions: CourseCard[]
  onOpenRunLog: (sessionId: string) => void
}) {
  const { uiLang, setUiLang, t } = useTranslation()
  const [logPickerOpen, setLogPickerOpen] = useState(false)
  const logPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!logPickerOpen) return
    function h(e: MouseEvent) {
      if (logPickerRef.current && !logPickerRef.current.contains(e.target as Node)) {
        setLogPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [logPickerOpen])
  const availableSessions = sessions.filter(s => s.status === 'done')

  return (
    <div style={{ padding: '48px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ fontSize: '24px', fontWeight: 900, color: '#292929', marginBottom: '40px' }}>
        {t('settings_title')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '480px' }}>
        {/* 语言设置 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#292929' }}>
            {t('settings_language_label')}
          </span>
          <div style={{ display: 'inline-flex', backgroundColor: '#F2F2EC', borderRadius: '9999px', padding: '4px', gap: '4px' }}>
            {(['en', 'zh'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setUiLang(lang)}
                style={{
                  padding: '6px 20px', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
                  backgroundColor: uiLang === lang ? '#FFFFFF' : 'transparent',
                  color: uiLang === lang ? '#292929' : '#72726E',
                  boxShadow: uiLang === lang ? '0px 1px 2px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {lang === 'en' ? t('settings_lang_en') : t('settings_lang_zh')}
              </button>
            ))}
          </div>
        </div>

        {/* 开发工具分区 */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#A8A8A0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
            开发工具
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#292929' }}>查看运行日志</span>
            <div style={{ position: 'relative' }} ref={logPickerRef}>
              <button
                type="button"
                onClick={() => setLogPickerOpen(v => !v)}
                style={{
                  padding: '6px 14px', borderRadius: '9999px', border: '1px solid #E3E3DA',
                  fontSize: '13px', fontWeight: 500, color: '#292929', cursor: 'pointer',
                  backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                选择课程 <span style={{ fontSize: '10px', color: '#72726E' }}>{logPickerOpen ? '▲' : '▼'}</span>
              </button>
              {logPickerOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                  backgroundColor: '#FFFFFF', borderRadius: '12px', zIndex: 100,
                  boxShadow: '0px 8px 24px rgba(0,0,0,0.10)', minWidth: '240px',
                  maxHeight: '280px', overflowY: 'auto', padding: '4px',
                }}>
                  {availableSessions.length === 0 && (
                    <div style={{ padding: '12px 16px', fontSize: '13px', color: '#A8A8A0' }}>
                      暂无课程
                    </div>
                  )}
                  {availableSessions.map(s => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => {
                        setLogPickerOpen(false)
                        onOpenRunLog(s.id)
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: '8px', border: 'none',
                        fontSize: '13px', color: '#292929', cursor: 'pointer',
                        backgroundColor: 'transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(47,51,49,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div style={{ fontWeight: 500 }}>{s.course}</div>
                      {s.lecture && (
                        <div style={{ fontSize: '11px', color: '#A8A8A0', marginTop: '1px' }}>{s.lecture}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const LS_FOLDERS_KEY = 'liberstudy_folders'
const LS_SESSION_FOLDERS_KEY = 'liberstudy_session_folders'

type SortBy = 'created' | 'name'

function SortDropdown({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const labels: Record<SortBy, string> = { created: '创建时间', name: '文件名称' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '6px 12px', borderRadius: '9999px', border: '1px solid #E3E3DA',
          backgroundColor: open ? '#F2F2EC' : '#FFFFFF', cursor: 'pointer',
          fontSize: '12px', fontWeight: 500, color: '#72726E',
          fontFamily: 'Inter, system-ui, sans-serif', transition: 'all 0.12s',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 3h10M3 6h6M5 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {labels[value]}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '36px', left: '0', zIndex: 50,
          backgroundColor: '#FFFFFF', borderRadius: '12px',
          boxShadow: '0px 4px 16px -2px rgba(47,51,49,0.14), 0px 0px 0px 1px rgba(175,179,176,0.12)',
          padding: '4px', minWidth: '140px', fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          {(['created', 'name'] as SortBy[]).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '7px 12px', textAlign: 'left',
                background: value === opt ? 'rgba(121,140,0,0.08)' : 'none',
                border: 'none', borderRadius: '8px', fontSize: '13px',
                fontWeight: value === opt ? 600 : 400, color: '#292929', cursor: 'pointer',
              }}
              onMouseEnter={e => { if (value !== opt) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(47,51,49,0.05)' }}
              onMouseLeave={e => { if (value !== opt) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
            >
              {labels[opt]}
              {value === opt && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="#798C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LobbyPage() {
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const { t } = useTranslation()
  const mainAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = mainAreaRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      el.scrollTop += e.deltaY * 0.4
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeNav, setActiveNav] = useState<'courses' | 'settings'>('courses')
  const [sessions, setSessions] = useState<CourseCard[]>(FALLBACK_SESSIONS)
  const [sortBy, setSortBy] = useState<SortBy>('created')
  const [runLogSessionId, setRunLogSessionId] = useState<string | null>(null)
  const runLogSession = sessions.find(s => s.id === runLogSessionId)

  // activeFolderId: null = 全部课程（默认），string = 指定文件夹
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)

  // ── folders: 从 localStorage 初始化 ──────────────────────────────────────
  const [folders, setFolders] = useState<Folder[]>(() => {
    try {
      const raw = localStorage.getItem(LS_FOLDERS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  // 每次 folders 变化时写入 localStorage
  useEffect(() => {
    localStorage.setItem(LS_FOLDERS_KEY, JSON.stringify(folders))
  }, [folders])

  // session folderId 映射从 localStorage 初始化/同步
  const [sessionFolderMap, setSessionFolderMap] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(LS_SESSION_FOLDERS_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })

  useEffect(() => {
    localStorage.setItem(LS_SESSION_FOLDERS_KEY, JSON.stringify(sessionFolderMap))
  }, [sessionFolderMap])

  // ── pending new folder (行内新建) ─────────────────────────────────────────
  const [pendingNewFolderId, setPendingNewFolderId] = useState<string | null>(null)

  const handleNewFolder = useCallback(() => {
    const id = `folder_${Date.now()}`
    setPendingNewFolderId(id)
  }, [])

  const handleNewFolderCommit = useCallback((id: string, name: string) => {
    setFolders(prev => [...prev, { id, name }])
    setPendingNewFolderId(null)
  }, [])

  const handleNewFolderCancel = useCallback((id: string) => {
    setPendingNewFolderId(null)
    void id
  }, [])

  // ── Folder operations ─────────────────────────────────────────────────────

  const handleFolderRename = useCallback((id: string) => {
    const folder = folders.find(f => f.id === id)
    const newName = window.prompt('重命名文件夹', folder?.name ?? '')
    if (!newName || !newName.trim() || newName === folder?.name) return
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName.trim() } : f))
  }, [folders])

  const handleFolderDelete = useCallback((id: string) => {
    if (!window.confirm('删除文件夹后，其中的笔记将移至"我的课程"')) return
    setFolders(prev => prev.filter(f => f.id !== id))
    setSessionFolderMap(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(sid => { if (next[sid] === id) next[sid] = DEFAULT_FOLDER_ID })
      return next
    })
    setSessions(prev => prev.map(s => s.folderId === id ? { ...s, folderId: DEFAULT_FOLDER_ID } : s))
    if (activeFolderId === id) setActiveFolderId(null)
  }, [folders, activeFolderId])

  const handleSessionMove = useCallback((sessionId: string, toFolderId: string) => {
    setSessionFolderMap(prev => ({ ...prev, [sessionId]: toFolderId }))
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, folderId: toFolderId } : s))
  }, [])

  // ── Session operations ────────────────────────────────────────────────────

  const handleRename = useCallback((id: string) => {
    const card = sessions.find(s => s.id === id)
    const newName = window.prompt('重命名', card?.course ?? '')
    if (!newName || newName.trim() === '' || newName === card?.course) return
    renameSession(id, newName.trim())
      .then(() => setSessions(prev => prev.map(s => s.id === id ? { ...s, course: newName.trim() } : s)))
      .catch(() => alert('重命名失败，请重试'))
  }, [sessions])

  const handleDelete = useCallback((id: string) => {
    if (!window.confirm('确认删除这条记录？')) return
    deleteSession(id)
      .then(() => {
        setSessions(prev => prev.filter(s => s.id !== id))
        setSessionFolderMap(prev => { const next = { ...prev }; delete next[id]; return next })
      })
      .catch(() => alert('删除失败，请重试'))
  }, [])

  const handleShare = useCallback((_id: string) => {
    alert('分享功能即将上线')
  }, [])

  const refreshSessions = useCallback(() => {
    listSessions()
      .then((data) => {
        setSessionFolderMap(map => {
          const cards: CourseCard[] = data.map((s, i) => ({
            id: s.session_id,
            course: s.ppt_filename ?? '未命名课程',
            lecture: '',
            duration: formatDuration(s.total_duration),
            notes: 0,
            time: formatTimeAgo(s.created_at ? Number(s.created_at) : null),
            date: s.created_at ? new Date(Number(s.created_at) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
            thumbColor: THUMB_COLORS[i % THUMB_COLORS.length],
            folderId: map[s.session_id] ?? DEFAULT_FOLDER_ID,
            status: (s.status === 'processing' ? 'processing' : s.status === 'live' ? 'live' : 'done') as 'done' | 'processing' | 'live',
          }))
          setSessions(cards)
          return map
        })
      })
      .catch((err) => {
        console.warn('[LobbyPage] listSessions failed, retrying in 3s:', err)
        setTimeout(refreshSessions, 3000)
      })
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') refreshSessions() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [refreshSessions])

  // ── Sorted & filtered sessions for main area ──────────────────────────────
  const displayedSessions = useMemo(() => {
    const filtered = activeFolderId === null
      ? sessions
      : sessions.filter(s => s.folderId === activeFolderId)

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.course.localeCompare(b.course, 'zh')
      // 'created': 按 date 降序（最新在前），processing 排最前
      if (a.status === 'processing' && b.status !== 'processing') return -1
      if (b.status === 'processing' && a.status !== 'processing') return 1
      return b.date.localeCompare(a.date)
    })
  }, [sessions, activeFolderId, sortBy])

  return (
    <div className="w-full flex font-['Inter'] overflow-hidden" style={{ backgroundColor: '#F7F7F2', height: 'calc(100vh - 40px)', marginTop: '40px' }}>

      {/* ── Sidebar ── */}
      <aside aria-label="侧边导航" className="w-52 flex-shrink-0 flex flex-col overflow-y-auto scroll-ghost" style={{ backgroundColor: '#F2F2EC', height: '100%' }}>
        {/* Brand */}
        <div className="px-7 pt-10 pb-10 flex flex-col justify-start items-start flex-shrink-0">
          <div className="text-lg font-bold font-['Inter'] leading-7" style={{ color: '#292929' }}>
            {t('lobby_brand').split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
          </div>
          <div className="opacity-60 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide mt-1" style={{ color: '#292929' }}>
            {t('lobby_academic_year')}
          </div>
        </div>

        {/* New Class CTA */}
        <div className="px-3 pb-3 flex-shrink-0">
          <button
            onClick={() => navigate('/notes/new')}
            className="w-full px-4 py-3 rounded-2xl inline-flex justify-start items-center gap-2 border-none cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#798C00' }}
          >
            <IconMic />
            <span className="text-center text-stone-50 text-xs font-semibold font-['Inter'] leading-5 tracking-tight">
              {t('lobby_new_record').split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
            </span>
          </button>
        </div>

        {/* Nav (Search + Folder tree) */}
        <div className="flex-1 px-3 flex flex-col gap-4">
          {/* Search */}
          <div className="px-4 py-2 rounded-md inline-flex justify-between items-center cursor-pointer transition-colors" style={{ backgroundColor: 'rgba(227,227,218,0.3)' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(227,227,218,0.6)')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(227,227,218,0.3)')}>
            <div className="flex justify-start items-center gap-3" style={{ color: '#72726E' }}>
              <IconSearch />
              <span className="text-xs font-medium font-['Inter'] leading-5" style={{ color: '#72726E' }}>{t('lobby_search')}</span>
            </div>
            <div className="px-1.5 pt-px pb-[2.39px] rounded-2xl inline-flex flex-col justify-start items-start" style={{ backgroundColor: '#E3E3DA' }}>
              <span className="text-[9.60px] font-bold font-['IPAGothic'] leading-4" style={{ color: '#72726E' }}>⌘K</span>
            </div>
          </div>

          {/* Folder tree */}
          <div className="flex flex-col">
            <SidebarFolderTree
              folders={folders}
              sessions={sessions}
              activeFolderId={activeFolderId}
              pendingNewFolderId={pendingNewFolderId}
              onFolderClick={setActiveFolderId}
              onSessionClick={(id) => {
                const card = sessions.find(s => s.id === id)
                openTab({ sessionId: id, label: card?.course ?? id })
                navigate(`/notes/${id}`)
              }}
              onSessionRename={handleRename}
              onSessionDelete={handleDelete}
              onSessionMove={handleSessionMove}
              onFolderRename={handleFolderRename}
              onFolderDelete={handleFolderDelete}
              onFolderDrop={handleSessionMove}
              onNewFolderCommit={handleNewFolderCommit}
              onNewFolderCancel={handleNewFolderCancel}
            />
            {/* New folder button below tree */}
            <button
              type="button"
              onClick={handleNewFolder}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 8px', marginTop: '4px', borderRadius: '6px',
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '12px', color: '#A8A8A0', width: '100%', textAlign: 'left',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(41,41,41,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = '#72726E' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#A8A8A0' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              新建文件夹
            </button>
          </div>
        </div>

        {/* Settings (above user anchor) */}
        <div className="flex-shrink-0 px-3 pt-4">
          <button
            onClick={() => setActiveNav(activeNav === 'settings' ? 'courses' : 'settings')}
            className="w-full px-4 py-3 inline-flex justify-start items-center gap-3 cursor-pointer border-none bg-transparent transition-all rounded-md"
            style={{
              borderRight: activeNav === 'settings' ? '2px solid #798C00' : '2px solid transparent',
              backgroundColor: activeNav === 'settings' ? 'rgba(121,140,0,0.06)' : 'transparent',
            }}
          >
            <span style={{ color: activeNav === 'settings' ? '#292929' : '#72726E' }}><IconSettings /></span>
            <span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>{t('lobby_nav_settings')}</span>
          </button>
        </div>

        {/* User anchor */}
        <div className="flex-shrink-0 px-7 py-6 inline-flex justify-start items-center gap-3">
          <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: '#D0CFC5' }}>
            <span className="text-xs font-bold" style={{ color: '#72726E' }}>学</span>
          </div>
          <div className="inline-flex flex-col justify-start items-start overflow-hidden">
            <div className="self-stretch flex flex-col justify-start items-start overflow-hidden">
              <div className="text-xs font-bold font-['Inter'] leading-4" style={{ color: '#292929' }}>同学</div>
            </div>
            <div className="self-stretch h-3.5 relative overflow-hidden">
              <div className="left-0 top-[-1px] absolute text-[9.60px] font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>学生</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div
        ref={mainAreaRef}
        className="flex-1 min-w-0 overflow-y-auto scroll-ghost flex flex-col"
        style={{ backgroundColor: '#F7F7F2', height: '100%' }}
      >

        {/* Header */}
        <div className="self-stretch px-12 py-6 backdrop-blur-md inline-flex justify-between items-center sticky top-0 z-10" style={{ backgroundColor: 'rgba(247,247,242,0.65)' }}>
          <div className="inline-flex flex-col justify-start items-start gap-0.5">
            <div className="self-stretch flex flex-col justify-start items-start">
              <div className="text-2xl font-black font-['Inter'] leading-8" style={{ color: '#292929' }}>
                {activeFolderId === null
                  ? t('lobby_title')
                  : (folders.find(f => f.id === activeFolderId)?.name ?? DEFAULT_FOLDER_NAME)}
              </div>
            </div>
            <div className="self-stretch flex flex-col justify-start items-start">
              <div className="text-[10.40px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{t('lobby_welcome')}</div>
            </div>
          </div>
          <div className="flex justify-start items-center gap-3">
            {/* Sort dropdown */}
            <SortDropdown value={sortBy} onChange={setSortBy} />
            {/* Grid/List toggle */}
            <div className="p-1 rounded-full flex justify-start items-start gap-1" style={{ backgroundColor: '#F2F2EC' }}>
              <button
                onClick={() => setViewMode('grid')}
                className="px-4 py-1.5 rounded-full inline-flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'grid' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'grid' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}><IconGrid /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}>{t('lobby_view_grid')}</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className="px-4 py-1.5 rounded-full inline-flex justify-start items-center gap-2 cursor-pointer border-none transition-all"
                style={{ backgroundColor: viewMode === 'list' ? '#FFFFFF' : 'transparent', boxShadow: viewMode === 'list' ? '0px 1px 2px 0px rgba(0,0,0,0.05)' : 'none' }}
              >
                <span style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}><IconList /></span>
                <span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}>{t('lobby_view_list')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {activeNav === 'settings' ? (
          <SettingsPanel sessions={sessions} onOpenRunLog={setRunLogSessionId} />
        ) : (
          <div className="w-full max-w-[1400px] px-12 py-8 flex flex-col justify-start items-start gap-24">
            {viewMode === 'grid' ? (
              <GridView
                sessions={displayedSessions}
                folders={folders}
                onCardClick={(id) => {
                  const card = sessions.find(s => s.id === id)
                  if (card?.status === 'live' || id.startsWith('live_') || id.startsWith('live-')) {
                    navigate(`/live?sessionId=${id}`)
                  } else {
                    openTab({ sessionId: id, label: card?.course ?? id })
                    navigate(`/notes/${id}`)
                  }
                }}
                onRename={handleRename}
                onDelete={handleDelete}
                onShare={handleShare}
              />
            ) : (
              <ListTable
                sessions={displayedSessions}
                folders={folders}
                onRowClick={(id) => {
                  const card = sessions.find(s => s.id === id)
                  if (card?.status === 'live' || id.startsWith('live_') || id.startsWith('live-')) {
                    navigate(`/live?sessionId=${id}`)
                  } else {
                    openTab({ sessionId: id, label: card?.course ?? id })
                    navigate(`/notes/${id}`)
                  }
                }}
                onRename={handleRename}
                onDelete={handleDelete}
                onShare={handleShare}
              />
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInToast {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .group:hover .group-hover\\:opacity-100 { opacity: 1 !important; }
      `}</style>

      {runLogSessionId && runLogSession && (
        <RunLogModal
          sessionId={runLogSessionId}
          sessionName={runLogSession.course}
          onClose={() => setRunLogSessionId(null)}
        />
      )}
    </div>
  )
}
