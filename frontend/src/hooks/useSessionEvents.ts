// frontend/src/hooks/useSessionEvents.ts
import { useEffect, useRef } from 'react'
import { API_BASE, getSession } from '../lib/api'

export type SSEEvent =
  | { event: 'ppt_parsed'; data: { num_pages: number } }
  | { event: 'page_ready'; page_num: number }
  | { event: 'asr_done' }
  | { event: 'all_done'; status?: string }
  | { event: 'error'; message?: string }
  | { event: '_poll'; status?: string; [key: string]: unknown }
  | { event: string; [key: string]: unknown }

export function useSessionEvents(
  sessionId: string | undefined,
  enabled: boolean,
  onEvent: (event: SSEEvent) => void,
) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!enabled || !sessionId) return

    let pollTimer: ReturnType<typeof setInterval> | null = null

    const es = new EventSource(`${API_BASE}/api/sessions/${sessionId}/events`)

    es.onmessage = (e) => {
      try {
        const data: SSEEvent = JSON.parse(e.data)
        onEventRef.current(data)
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      es.close()
      pollTimer = setInterval(async () => {
        try {
          const data = await getSession(sessionId) as { status?: string }
          onEventRef.current({ event: '_poll', ...(data as Record<string, unknown>) })
          if (data.status === 'ready' || data.status === 'partial_ready') {
            if (pollTimer) clearInterval(pollTimer)
            onEventRef.current({ event: 'all_done', status: data.status })
          }
        } catch { /* ignore fetch errors during polling */ }
      }, 3000)
    }

    return () => {
      es.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [sessionId, enabled])
}
