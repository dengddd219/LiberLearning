export interface AskMessage {
  role: 'user' | 'ai'
  content: string
  model: string
  timestamp: number
}

export interface PageChatMessage {
  role: 'user' | 'ai'
  content: string
  timestamp: number
}

export interface Bullet {
  ppt_text: string
  level: number
  ai_comment: string | null
  timestamp_start: number
  timestamp_end: number
}

export interface AlignedSegment {
  start: number
  end: number
  text: string
  similarity?: number
}

export interface PageData {
  page_num: number
  status?: string
  pdf_url: string
  pdf_page_num: number
  thumbnail_url?: string
  ppt_text: string
  page_start_time: number
  page_end_time: number
  alignment_confidence: number
  active_notes: { user_note: string; ai_expansion: string } | null
  passive_notes: { bullets: Bullet[]; error?: string } | null
  page_supplement: { content: string; timestamp_start: number; timestamp_end: number } | null
  aligned_segments?: AlignedSegment[]
}

export interface SessionData {
  session_id: string
  status: string
  ppt_filename: string
  audio_url: string
  total_duration: number
  pages: PageData[]
  progress?: {
    step: string
    percent: number
    ppt_id?: string | null
    live_transcript?: Array<{ text: string; timestamp: number; page_num?: number | null }>
  } | null
}
