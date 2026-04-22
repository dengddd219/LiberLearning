export const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function apiPost<T>(path: string, body?: FormData | object): Promise<T> {
  const isFormData = body instanceof FormData
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function uploadPpt(pptFile: File): Promise<{
  ppt_id: string
  num_pages: number
  pages: { page_num: number; pdf_url: string | null; pdf_page_num: number; thumbnail_url: string | null; ppt_text: string }[]
}> {
  const form = new FormData()
  form.append('ppt', pptFile)
  return apiPost('/api/upload-ppt', form)
}

export async function uploadFiles(
  pptFile?: File,
  audioFile?: File,
  language: string = 'en',
  userAnchors?: { page_num: number; timestamp: number }[],
  pptId?: string,
  existingSessionId?: string,
): Promise<{ session_id: string }> {
  const form = new FormData()
  if (pptFile) form.append('ppt', pptFile)
  if (audioFile) form.append('audio', audioFile)
  form.append('language', language)
  if (userAnchors && userAnchors.length > 0) {
    form.append('user_anchors', JSON.stringify(userAnchors))
  }
  if (pptId) form.append('ppt_id', pptId)
  if (existingSessionId) form.append('existing_session_id', existingSessionId)
  return apiPost('/api/process', form)
}

export async function getSession(sessionId: string) {
  return apiGet(`/api/sessions/${sessionId}`)
}

export async function updateLiveSessionState(
  sessionId: string,
  payload: {
    ppt_id?: string
    ppt_filename?: string
    pages?: { page_num: number; pdf_url: string | null; pdf_page_num: number; thumbnail_url: string | null; ppt_text: string }[]
    live_transcript?: Array<{ text: string; timestamp: number; page_num?: number }>
  },
): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${sessionId}/live-state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  })
}

export async function retryPage(sessionId: string, pageNum: number) {
  return apiPost(`/api/sessions/${sessionId}/page/${pageNum}/retry`)
}

export async function getRunLog(sessionId: string): Promise<unknown> {
  return apiGet(`/api/sessions/${sessionId}/run-log`)
}

export async function renameSession(sessionId: string, newName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ppt_filename: newName }),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
}

export async function listSessions(): Promise<
  {
    session_id: string
    status: string
    ppt_filename: string | null
    total_duration: number
    created_at: string | null
  }[]
> {
  return apiGet('/api/sessions')
}

export async function createLiveSession(name?: string): Promise<{ session_id: string }> {
  return apiPost('/api/sessions/live', { name: name ?? '' })
}

export async function liveAsk(
  payload: {
    session_id: string
    question: string
    current_page: number
    current_page_ppt_text?: string
    current_page_notes?: string
    current_page_annotations?: string[]
    recent_transcript: Array<{ text: string; timestamp: number; page_num?: number }>
    model?: string
  },
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/live/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const parsed = JSON.parse(line.slice(6))
        if (parsed.type === 'chunk' && parsed.content) {
          full += parsed.content
          onChunk(parsed.content)
        }
      } catch {
        // ignore malformed sse chunks
      }
    }
  }

  return full
}

/**
 * 流式生成 My Notes AI 扩写。
 * onChunk 每次收到一段文本时回调；返回完整文本。
 */
export async function generateMyNote(
  sessionId: string,
  pageNum: number,
  userNote: string,
  pptText: string,
  provider: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/page/${pageNum}/my-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_note: userNote, ppt_text: pptText, provider }),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') break
      try {
        const { chunk } = JSON.parse(data)
        if (chunk) { full += chunk; onChunk(chunk) }
      } catch { /* ignore malformed */ }
    }
  }
  return full
}

/**
 * 针对单条 bullet 的流式问答。
 * onChunk 每次收到一段文本时回调；resolve 时返回完整文本。
 */
export async function askBullet(
  sessionId: string,
  pageNum: number,
  bulletIndex: number,
  bulletText: string,
  bulletAiComment: string,
  question: string,
  model: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      page_num: pageNum,
      bullet_index: bulletIndex,
      bullet_text: bulletText,
      bullet_ai_comment: bulletAiComment,
      model,
    }),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const parsed = JSON.parse(line.slice(6))
        if (parsed.type === 'chunk' && parsed.content) {
          full += parsed.content
          onChunk(parsed.content)
        }
      } catch { /* ignore malformed */ }
    }
  }
  return full
}
