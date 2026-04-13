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

export async function uploadFiles(pptFile?: File, audioFile?: File): Promise<{ session_id: string }> {
  const form = new FormData()
  if (pptFile) form.append('ppt', pptFile)
  if (audioFile) form.append('audio', audioFile)
  // TODO: change to '/api/process' when connecting to real pipeline
  return apiPost('/api/process-mock', form)
}

export async function getSession(sessionId: string) {
  return apiGet(`/api/sessions/${sessionId}`)
}

export async function retryPage(sessionId: string, pageNum: number) {
  return apiPost(`/api/sessions/${sessionId}/page/${pageNum}/retry`)
}
