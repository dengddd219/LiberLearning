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

export async function generateMyNote(
  sessionId: string,
  pageNum: number,
  template: string,
  granularity: string,
  provider: string,
) {
  return apiPost(`/api/sessions/${sessionId}/page/${pageNum}/generate-note`, {
    template,
    granularity,
    provider,
  })
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
