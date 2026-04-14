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
