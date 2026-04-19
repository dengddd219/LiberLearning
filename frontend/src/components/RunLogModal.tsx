import { useState, useEffect, useCallback } from 'react'
import { getRunLog } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface PageSummary {
  page_num: number
  status: string
  num_bullets?: number
}

interface GeneratedPage {
  page_num: number
  passive_notes?: { error?: string; bullets?: unknown[] }
  status?: string
}

interface StepData {
  status: string
  elapsed_s?: number
  duration_seconds?: number
  num_pages?: number
  num_sentences?: number
  pages_summary?: PageSummary[]
  generated_pages?: GeneratedPage[]
}

interface RunLog {
  session_id: string
  started_at: string
  finished_at?: string
  overall_status: string
  error?: string
  steps: {
    step1_audio?: StepData
    step2_ppt?: StepData
    step3_asr?: StepData
    step4_alignment?: StepData
    step5_notes?: StepData
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: string | undefined) {
  if (status === 'ok') return <span style={{ color: '#798C00' }}>✅</span>
  if (status === 'error') return <span style={{ color: '#D94F3D' }}>❌</span>
  if (status === 'partial_ready') return <span style={{ color: '#E8960C' }}>⚠️</span>
  return <span style={{ color: '#A8A8A0' }}>⏳</span>
}

function statusLabel(status: string | undefined) {
  if (status === 'ok') return '成功'
  if (status === 'error') return '失败'
  if (status === 'partial_ready') return '部分成功'
  return '未执行'
}

function elapsed(s: number | undefined) {
  if (s == null) return '—'
  return `${s.toFixed(2)}s`
}

function totalElapsed(log: RunLog): string {
  const steps = Object.values(log.steps)
  const total = steps.reduce((sum, s) => sum + (s?.elapsed_s ?? 0), 0)
  return `${total.toFixed(2)}s`
}

// ── Step Row ──────────────────────────────────────────────────────────────────

function StepRow({
  label,
  step,
  extra,
  failedPages,
}: {
  label: string
  step: StepData | undefined
  extra?: string
  failedPages?: { page_num: number; error: string }[]
}) {
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set())

  function togglePage(n: number) {
    setExpandedPages(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', borderRadius: '10px',
        backgroundColor: '#F2F2EC',
      }}>
        <span style={{ width: '20px', flexShrink: 0 }}>{statusIcon(step?.status)}</span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: '#292929' }}>{label}</span>
        {extra && (
          <span style={{ fontSize: '12px', color: '#72726E' }}>{extra}</span>
        )}
        <span style={{ fontSize: '12px', color: '#72726E', minWidth: '52px', textAlign: 'right' }}>
          {elapsed(step?.elapsed_s)}
        </span>
        <span style={{ fontSize: '12px', color: '#72726E', minWidth: '60px', textAlign: 'right' }}>
          {statusLabel(step?.status)}
        </span>
      </div>

      {failedPages && failedPages.length > 0 && (
        <div style={{ paddingLeft: '16px', marginTop: '4px' }}>
          {failedPages.map(fp => (
            <div key={fp.page_num} style={{ marginBottom: '4px' }}>
              <button
                onClick={() => togglePage(fp.page_num)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '12px', color: '#D94F3D', padding: '4px 0',
                }}
              >
                <span>❌ Page {fp.page_num}</span>
                <span style={{ color: '#A8A8A0' }}>{expandedPages.has(fp.page_num) ? '▾' : '▸'}</span>
              </button>
              {expandedPages.has(fp.page_num) && (
                <div style={{
                  fontFamily: 'monospace', fontSize: '11px', color: '#72726E',
                  backgroundColor: '#F9F9F6', borderRadius: '6px',
                  padding: '8px', maxHeight: '72px', overflowY: 'auto',
                  wordBreak: 'break-all', marginTop: '2px',
                }}>
                  {fp.error || '（无错误信息）'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function RunLogModal({
  sessionId,
  sessionName,
  onClose,
}: {
  sessionId: string
  sessionName: string
  onClose: () => void
}) {
  const [log, setLog] = useState<RunLog | null>(null)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [loading, setLoading] = useState(true)

  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(null)
    getRunLog(sessionId).then(data => {
      setLog(data as RunLog)
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : ''
      setError(msg.includes('404') ? 'not_found' : 'network')
    }).finally(() => {
      setLoading(false)
    })
  }, [sessionId])

  useEffect(() => { handleRetry() }, [handleRetry])

  function getFailedPages(log: RunLog): { page_num: number; error: string }[] {
    const step5 = log.steps.step5_notes
    if (!step5) return []
    const failedSummary = (step5.pages_summary ?? []).filter(
      p => p.status === 'error' || p.status === 'partial_ready'
    )
    return failedSummary.map(ps => {
      const gen = (step5.generated_pages ?? []).find(g => g.page_num === ps.page_num)
      return {
        page_num: ps.page_num,
        error: gen?.passive_notes?.error ?? '',
      }
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '480px', maxHeight: '70vh', backgroundColor: '#FFFFFF',
          borderRadius: '16px', display: 'flex', flexDirection: 'column',
          fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden',
          boxShadow: '0px 24px 48px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #E3E3DA',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 900, color: '#292929' }}>运行日志</div>
            <div style={{ fontSize: '12px', color: '#72726E', marginTop: '2px' }}>{sessionName}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '18px', color: '#72726E', padding: '4px',
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#A8A8A0', padding: '32px 0', fontSize: '13px' }}>
              加载中…
            </div>
          )}

          {!loading && error === 'not_found' && (
            <div style={{ textAlign: 'center', color: '#A8A8A0', padding: '32px 0', fontSize: '13px' }}>
              该课程暂无运行日志
            </div>
          )}

          {!loading && error === 'network' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '13px', color: '#D94F3D', marginBottom: '12px' }}>加载失败，请重试</div>
              <button
                onClick={handleRetry}
                style={{
                  padding: '6px 16px', borderRadius: '9999px', border: 'none',
                  backgroundColor: '#F2F2EC', fontSize: '12px', cursor: 'pointer', color: '#292929',
                }}
              >重试</button>
            </div>
          )}

          {!loading && !error && log && (
            <>
              {/* Meta */}
              <div style={{
                display: 'flex', gap: '16px', marginBottom: '16px',
                fontSize: '12px', color: '#72726E',
              }}>
                <span>开始：{log.started_at}</span>
                <span>总耗时：{totalElapsed(log)}</span>
                <span>状态：{statusIcon(log.overall_status)} {statusLabel(log.overall_status)}</span>
              </div>

              {/* Steps */}
              <StepRow
                label="Step 1 · 音频转换"
                step={log.steps.step1_audio}
                extra={log.steps.step1_audio?.duration_seconds
                  ? `音频 ${(log.steps.step1_audio.duration_seconds / 60).toFixed(1)}min`
                  : undefined}
              />
              <StepRow
                label="Step 2 · PPT 解析"
                step={log.steps.step2_ppt}
                extra={log.steps.step2_ppt?.num_pages != null
                  ? `${log.steps.step2_ppt.num_pages} 页`
                  : undefined}
              />
              <StepRow
                label="Step 3 · ASR 转录"
                step={log.steps.step3_asr}
                extra={log.steps.step3_asr?.num_sentences != null
                  ? `${log.steps.step3_asr.num_sentences} 句`
                  : undefined}
              />
              <StepRow
                label="Step 4 · 语义对齐"
                step={log.steps.step4_alignment}
                extra={log.steps.step4_alignment?.num_pages != null
                  ? `${log.steps.step4_alignment.num_pages} 页`
                  : undefined}
              />
              <StepRow
                label="Step 5 · 笔记生成"
                step={log.steps.step5_notes}
                extra={log.steps.step5_notes?.num_pages != null
                  ? `${log.steps.step5_notes.num_pages} 页`
                  : undefined}
                failedPages={getFailedPages(log)}
              />

              {/* Top-level error */}
              {log.error && (
                <div style={{
                  marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
                  backgroundColor: '#FEF2F2', fontSize: '12px', color: '#D94F3D',
                  fontFamily: 'monospace', wordBreak: 'break-all',
                }}>
                  {log.error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
