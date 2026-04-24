// DiagnosticsPage — 全流程自动化健康检查
// 访问 /diagnostics 触发

import { useState } from 'react'
import { apiFetch } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string
  status: 'ok' | 'fail' | 'skipped' | 'running'
  detail: string
  trace?: string
  ms: number
}

interface DiagnosticsReport {
  summary: {
    ok: number
    fail: number
    skipped: number
    total: number
    healthy: boolean
  }
  checks: CheckResult[]
  timestamp: string
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CheckResult['status'] }) {
  const styles: Record<CheckResult['status'], string> = {
    ok:      'bg-emerald-50 text-emerald-700 border border-emerald-200',
    fail:    'bg-red-50 text-red-700 border border-red-200',
    skipped: 'bg-zinc-50 text-zinc-500 border border-zinc-200',
    running: 'bg-blue-50 text-blue-600 border border-blue-200',
  }
  const labels: Record<CheckResult['status'], string> = {
    ok:      '通过',
    fail:    '失败',
    skipped: '跳过',
    running: '检测中…',
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status === 'ok'      && <span>✓</span>}
      {status === 'fail'    && <span>✗</span>}
      {status === 'skipped' && <span>–</span>}
      {status === 'running' && (
        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {labels[status]}
    </span>
  )
}

// ─── Check Row ────────────────────────────────────────────────────────────────

function CheckRow({ check, expanded, onToggle }: {
  check: CheckResult
  expanded: boolean
  onToggle: () => void
}) {
  const hasDetail = check.detail || check.trace

  return (
    <div className={`border rounded-lg overflow-hidden ${check.status === 'fail' ? 'border-red-200' : 'border-zinc-200'}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
        onClick={onToggle}
        disabled={!hasDetail}
      >
        <StatusBadge status={check.status} />
        <span className="flex-1 text-sm font-medium text-zinc-800">{check.name}</span>
        {check.ms > 0 && (
          <span className="text-xs text-zinc-400">{check.ms}ms</span>
        )}
        {hasDetail && (
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none"
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {expanded && hasDetail && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 space-y-2">
          {check.detail && (
            <pre className="text-xs text-zinc-600 whitespace-pre-wrap break-all font-mono leading-relaxed">
              {check.detail}
            </pre>
          )}
          {check.trace && (
            <details>
              <summary className="text-xs text-red-500 cursor-pointer">完整错误堆栈</summary>
              <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap break-all font-mono leading-relaxed bg-red-50 p-2 rounded">
                {check.trace}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Summary Bar ──────────────────────────────────────────────────────────────

function SummaryBar({ summary, timestamp }: { summary: DiagnosticsReport['summary'], timestamp: string }) {
  const allOk = summary.healthy
  return (
    <div className={`rounded-xl p-4 flex items-center gap-4 ${allOk ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${allOk ? 'bg-emerald-100' : 'bg-red-100'}`}>
        {allOk ? '✓' : '✗'}
      </div>
      <div className="flex-1">
        <p className={`font-semibold ${allOk ? 'text-emerald-800' : 'text-red-800'}`}>
          {allOk ? '全部检查通过，系统正常' : `发现 ${summary.fail} 个问题需要修复`}
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          通过 {summary.ok} / 失败 {summary.fail} / 跳过 {summary.skipped} · 检测时间 {timestamp}
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [fast, setFast] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runChecks() {
    setLoading(true)
    setReport(null)
    setError(null)
    setExpandedIdx(null)

    try {
      const url = fast ? '/api/diagnostics?fast=true' : '/api/diagnostics'
      const res = await apiFetch(url)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`后端返回 HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      const data: DiagnosticsReport = await res.json()
      setReport(data)

      // 自动展开第一个失败项
      const firstFailIdx = data.checks.findIndex(c => c.status === 'fail')
      if (firstFailIdx !== -1) setExpandedIdx(firstFailIdx)
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message)
      else setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-2xl mx-auto px-4 pt-24 pb-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">系统诊断</h1>
          <p className="text-sm text-zinc-500 mt-1">
            一键检测前后端全链路状态：环境变量、数据库、FFmpeg、LibreOffice、API 连通性、上传流程
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={runChecks}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                </svg>
                检测中…
              </>
            ) : '开始检测'}
          </button>

          <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fast}
              onChange={e => setFast(e.target.checked)}
              className="rounded"
            />
            快速模式（跳过 API 连通检查）
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-700">诊断请求失败</p>
            <p className="text-xs text-red-600 mt-1 font-mono break-all">{error}</p>
            <p className="text-xs text-red-500 mt-2">
              提示：确认后端已启动（<code>npm run backend</code>），然后再试
            </p>
          </div>
        )}

        {/* Summary */}
        {report && (
          <div className="space-y-4">
            <SummaryBar summary={report.summary} timestamp={report.timestamp} />

            <div className="space-y-2">
              {report.checks.map((check, i) => (
                <CheckRow
                  key={i}
                  check={check}
                  expanded={expandedIdx === i}
                  onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                />
              ))}
            </div>

            {/* Quick fix hints */}
            {!report.summary.healthy && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800 mb-2">常见修复方法</p>
                <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                  <li>环境变量缺失 → 检查 <code>backend/.env</code> 文件</li>
                  <li>FFmpeg 未找到 → 运行 <code>install_deps.bat</code> 或手动安装</li>
                  <li>LibreOffice 未找到 → 运行 <code>install_deps.bat</code> 或手动安装</li>
                  <li>API 连接失败 → 检查 API Key 是否有效、代理配置是否正确</li>
                  <li>上传端点失败 → 查看后端控制台日志获取详细错误</li>
                  <li>历史 session 不见了 → session 存在 SQLite，检查 <code>backend/database.db</code></li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!report && !loading && !error && (
          <div className="text-center py-16 text-zinc-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="none">
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3z" stroke="currentColor" strokeWidth="2"/>
            </svg>
            <p className="text-sm">点击「开始检测」运行全链路诊断</p>
          </div>
        )}
      </div>
    </div>
  )
}
