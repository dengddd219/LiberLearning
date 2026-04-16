const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

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

export async function uploadFiles(
  pptFile?: File,
  audioFile?: File,
  language: string = 'en',
  userAnchors?: { page_num: number; timestamp: number }[],
): Promise<{ session_id: string }> {
  const form = new FormData()
  if (pptFile) form.append('ppt', pptFile)
  if (audioFile) form.append('audio', audioFile)
  form.append('language', language)
  if (userAnchors && userAnchors.length > 0) {
    form.append('user_anchors', JSON.stringify(userAnchors))
  }
  return apiPost('/api/process', form)
}

export async function getSession(sessionId: string) {
  return apiGet(`/api/sessions/${sessionId}`)
}

export async function retryPage(sessionId: string, pageNum: number) {
  return apiPost(`/api/sessions/${sessionId}/page/${pageNum}/retry`)
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
