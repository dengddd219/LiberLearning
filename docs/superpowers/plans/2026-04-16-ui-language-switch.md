# UI Language Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a language toggle (English / 中文) in LobbyPage Settings panel that switches all UI text globally, persisted in localStorage.

**Architecture:** Extend `TranslationContext` with `uiLang: 'en' | 'zh'` and a `t(key)` function. A central `i18n.ts` dictionary holds all UI strings in both languages. All components call `useTranslation()` to get `t` and replace hardcoded strings. Default is English (`'en'`); switching writes to `localStorage('ui-lang')`.

**Tech Stack:** React context, localStorage, TypeScript (no new dependencies)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/lib/i18n.ts` | **Create** | All UI string keys in `en` and `zh` |
| `frontend/src/context/TranslationContext.tsx` | **Modify** | Add `uiLang`, `setUiLang`, `t()` to context |
| `frontend/src/pages/LobbyPage.tsx` | **Modify** | Settings panel + replace all hardcoded strings |
| `frontend/src/components/TopBar.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/pages/ProcessingPage.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/components/PillToggle.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/components/TemplateSelector.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/pages/NotesPage.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/pages/SessionPage.tsx` | **Modify** | Replace hardcoded strings |
| `frontend/src/pages/DetailedNotePage.tsx` | **Modify** | Replace hardcoded strings |

---

## Task 1: Create i18n dictionary

**Files:**
- Create: `frontend/src/lib/i18n.ts`

- [ ] **Step 1: Create the dictionary file**

```ts
// frontend/src/lib/i18n.ts

export const i18n = {
  en: {
    // TopBar
    topbar_dashboard: 'Dashboard',
    topbar_detailed_note: 'Detailed Note →',
    topbar_close_tab: 'Close',

    // LobbyPage – sidebar
    lobby_brand: 'Student\nWorkspace',
    lobby_academic_year: 'ACADEMIC YEAR 2026',
    lobby_new_record: 'Upload the\nrecord',
    lobby_search: 'Search',
    lobby_nav_courses: 'MY COURSES',
    lobby_nav_settings: 'SETTINGS',
    lobby_user_name: '同学',
    lobby_user_role: '学生',

    // LobbyPage – header / main
    lobby_title: 'Scholarly Workspace',
    lobby_welcome: 'WELCOME BACK, YOUR RECORDINGS ARE UP TO DATE.',
    lobby_view_grid: 'Grid',
    lobby_view_list: 'List',
    lobby_empty_hint: 'No recordings yet',
    lobby_start_first: 'Start first recording',

    // LobbyPage – table headers
    table_thumbnail: 'COURSE\nTHUMBNAIL',
    table_name: 'COURSE NAME & IDENTIFIER',
    table_folder: 'FOLDER',
    table_date: 'DATE',
    table_duration: 'DURATION',
    table_notes: 'NOTES',

    // LobbyPage – card / row
    card_notes_suffix: 'notes',
    card_processing: 'PROCESSING',

    // LobbyPage – upload modal
    modal_new_class_title: 'New Class',
    modal_ppt_label: 'PPT/PDF Materials',
    modal_ppt_hint: 'DRAG OR CLICK TO UPLOAD',
    modal_audio_label: 'Audio Recording',
    modal_audio_hint: 'UPLOAD MP3, WAV OR AAC',
    modal_uploading: 'Uploading…',
    modal_submit: 'Save Workspace',
    modal_upload_error: 'Upload failed, please check your network and retry',
    modal_file_format_error: 'Unsupported format, please upload',
    modal_file_size_error: 'File too large, max',

    // LobbyPage – toast
    toast_done_title: 'Notes ready',
    toast_done_sub: 'Click to view notes',
    toast_error_title: 'Processing failed',
    toast_processing_title: 'Processing recording…',
    toast_default_sub: 'Retry upload or try again later',
    toast_view: 'View',
    toast_step_uploading: 'Uploading files',
    toast_step_converting: 'Converting audio',
    toast_step_parsing_ppt: 'Parsing PPT',
    toast_step_transcribing: 'Transcribing speech',
    toast_step_aligning: 'Aligning semantics',
    toast_step_generating: 'Generating structured notes',

    // LobbyPage – Settings panel
    settings_title: 'Settings',
    settings_language_label: 'Language',
    settings_lang_en: 'EN',
    settings_lang_zh: '中文',

    // ProcessingPage
    processing_title: 'Processing your recording',
    processing_remaining: 'Estimated time remaining',
    processing_still: 'Still processing, please wait…',
    processing_failed_title: 'Processing failed',
    processing_failed_sub: 'Speech transcription service is temporarily unavailable, please try again later',
    processing_retry: 'Retry',
    processing_reupload: 'Re-upload',
    processing_progress_label: 'Overall progress',
    processing_stage_convert: 'Audio conversion',
    processing_stage_ppt: 'PPT parsing',
    processing_stage_asr: 'Speech transcription',
    processing_stage_align: 'Alignment & note generation',
    processing_stage_convert_desc: 'Converting recording to standard audio format…',
    processing_stage_ppt_desc: 'Extracting text and image content per slide…',
    processing_stage_asr_desc: 'Transcribing recording to timestamped text…',
    processing_stage_align_desc: 'Aligning transcript to slides and generating structured notes…',
    processing_done: 'Done',
    processing_in_progress: 'In progress',
    processing_waiting: 'Waiting',

    // PillToggle
    pill_my_notes: 'My Notes',
    pill_ai_notes: 'AI Notes',

    // TemplateSelector
    template_outline_label: '📋 Outline',
    template_outline_desc: 'Organized by key point hierarchy',
    template_qa_label: '❓ Q&A',
    template_qa_desc: 'Extracted exam-style Q&A',
    template_cornell_label: '📝 Cornell',
    template_cornell_desc: 'Key points + cues + summary',
    template_mindmap_label: '🗺️ Mind Map',
    template_mindmap_desc: 'Tree structure output',
    template_simple: 'Simple',
    template_detailed: 'Detailed',

    // NotesPage
    notes_loading: 'Loading notes…',
    notes_retry: 'Retry',
    notes_unknown_error: 'Unknown error',
    notes_toc: 'Contents',
    notes_my_tab: 'My Notes',
    notes_ai_tab: 'AI Notes',
    notes_transcript_tab: 'Transcript',
    notes_annotation_label: 'PPT Annotation',
    notes_my_notes_heading: 'MY NOTES',
    notes_my_placeholder: 'Write your understanding, questions or keywords here…',
    notes_page_chat_placeholder: 'Ask AI… (Enter to send)',
    notes_expand: 'Expand',
    notes_expanding: 'Expanding…',
    notes_no_ai_notes: 'No AI notes for this page',
    notes_off_slide: 'OFF-SLIDE CONTENT',
    notes_no_transcript: 'No transcript for this page',
    notes_bullet_placeholder: 'Ask about this point… (Enter to send)',
    notes_model_label: 'Model',

    // SessionPage
    session_recording: 'LIVE RECORDING',
    session_not_recording: 'NOT RECORDING',
    session_start_hint: 'Click to start recording',
    session_recording_hint: 'Recording…',
    session_note_placeholder: 'Type a note (Alt + N)…',
    session_submit_notes: 'Generate lecture notes →',
    session_submitting: 'Submitting…',
    session_submit_error: 'Submission failed, please check your network and retry',
    session_recovery_title: 'Unfinished recording found',
    session_recovery_sub: 'Your last recording was interrupted. Would you like to resume?',
    session_recovery_continue: 'Generate notes with existing recording',
    session_recovery_discard: 'Discard recording (clear data)',
    session_my_notes: 'My Notes',
    session_ai_notes: 'AI Notes',
    session_no_annotation: 'No annotations yet, click + to add',
    session_lecture_slides: 'LECTURE SLIDES',
    session_ppt_not_uploaded: 'No PPT uploaded',
    session_support: 'SUPPORT',
    session_privacy: 'PRIVACY',
    session_terms: 'TERMS',

    // DetailedNotePage
    detailed_load_error: 'Failed to load notes',
    detailed_back_home: 'Back to home',
    detailed_navigation: 'NAVIGATION',
    detailed_back: 'Back',
    detailed_page_prefix: 'Page',
    detailed_session_subtitle_pages: 'pages',
    detailed_session_subtitle_minutes: 'min',
    detailed_no_user_notes: 'No user notes for this session',
    detailed_annotation_label: 'PPT Annotation',
    detailed_ai_clarification: 'AI CLARIFICATION',
    detailed_off_slide: 'OFF-SLIDE CONTENT',
    detailed_no_data: 'No notes data',
    detailed_my_tab: 'My Notes',
    detailed_ai_tab: 'AI Notes',
  },

  zh: {
    // TopBar
    topbar_dashboard: '主页',
    topbar_detailed_note: '详细笔记 →',
    topbar_close_tab: '关闭',

    // LobbyPage – sidebar
    lobby_brand: '学生\n工作台',
    lobby_academic_year: '学年 2026',
    lobby_new_record: '上传\n录音',
    lobby_search: '搜索',
    lobby_nav_courses: '我的课程',
    lobby_nav_settings: '设置',
    lobby_user_name: '同学',
    lobby_user_role: '学生',

    // LobbyPage – header / main
    lobby_title: '学术工作台',
    lobby_welcome: '欢迎回来，你的录音记录已是最新状态。',
    lobby_view_grid: '网格',
    lobby_view_list: '列表',
    lobby_empty_hint: '还没有任何课程记录',
    lobby_start_first: '开始第一次录音',

    // LobbyPage – table headers
    table_thumbnail: '课程\n缩略图',
    table_name: '课程名称与标识',
    table_folder: '文件夹',
    table_date: '日期',
    table_duration: '时长',
    table_notes: '笔记',

    // LobbyPage – card / row
    card_notes_suffix: '条笔记',
    card_processing: '处理中',

    // LobbyPage – upload modal
    modal_new_class_title: '新建课程',
    modal_ppt_label: 'PPT/PDF 课件',
    modal_ppt_hint: '拖拽或点击上传',
    modal_audio_label: '课堂录音',
    modal_audio_hint: '支持 MP3、WAV、AAC',
    modal_uploading: '上传中…',
    modal_submit: '保存并处理',
    modal_upload_error: '上传失败，请检查网络后重试',
    modal_file_format_error: '不支持的格式，请上传',
    modal_file_size_error: '文件过大，最大支持',

    // LobbyPage – toast
    toast_done_title: '笔记已生成完成',
    toast_done_sub: '点击查看笔记',
    toast_error_title: '处理失败',
    toast_processing_title: '正在处理课堂录音',
    toast_default_sub: '请重新上传或稍后重试',
    toast_view: '查看',
    toast_step_uploading: '上传文件',
    toast_step_converting: '音频格式转换',
    toast_step_parsing_ppt: 'PPT 解析',
    toast_step_transcribing: '语音转录',
    toast_step_aligning: '语义对齐',
    toast_step_generating: '生成结构化笔记',

    // LobbyPage – Settings panel
    settings_title: '设置',
    settings_language_label: '语言',
    settings_lang_en: 'EN',
    settings_lang_zh: '中文',

    // ProcessingPage
    processing_title: '正在处理课堂录音',
    processing_remaining: '预计还需',
    processing_still: '仍在处理中，请稍候…',
    processing_failed_title: '处理失败',
    processing_failed_sub: '语音转录服务暂时不可用，请稍后重试',
    processing_retry: '重试',
    processing_reupload: '重新上传',
    processing_progress_label: '处理总进度',
    processing_stage_convert: '音频转换',
    processing_stage_ppt: 'PPT 解析',
    processing_stage_asr: '语音转录',
    processing_stage_align: '对齐与笔记生成',
    processing_stage_convert_desc: '将录音转换为标准音频格式…',
    processing_stage_ppt_desc: '提取每页文本与图像内容…',
    processing_stage_asr_desc: '将录音转换为带时间戳的文字稿…',
    processing_stage_align_desc: '将转录稿与课件语义对齐，逐页生成结构化笔记…',
    processing_done: '已完成',
    processing_in_progress: '进行中',
    processing_waiting: '等待中',

    // PillToggle
    pill_my_notes: '我的笔记',
    pill_ai_notes: 'AI 笔记',

    // TemplateSelector
    template_outline_label: '📋 大纲式',
    template_outline_desc: '按要点层级整理',
    template_qa_label: '❓ 问答式',
    template_qa_desc: '提炼考点问答',
    template_cornell_label: '📝 康奈尔式',
    template_cornell_desc: '要点+提示+总结',
    template_mindmap_label: '🗺️ 思维导图',
    template_mindmap_desc: '树形结构输出',
    template_simple: '简洁',
    template_detailed: '详细',

    // NotesPage
    notes_loading: '加载笔记中…',
    notes_retry: '重试',
    notes_unknown_error: '未知错误',
    notes_toc: '目录',
    notes_my_tab: '我的笔记',
    notes_ai_tab: 'AI 笔记',
    notes_transcript_tab: '转录文本',
    notes_annotation_label: 'PPT 批注',
    notes_my_notes_heading: '我的笔记',
    notes_my_placeholder: '在这里记录你的理解、困惑或关键词…',
    notes_page_chat_placeholder: '向 AI 提问… (Enter 发送)',
    notes_expand: '扩写',
    notes_expanding: '扩写中…',
    notes_no_ai_notes: '该页暂无 AI 笔记',
    notes_off_slide: 'OFF-SLIDE 内容',
    notes_no_transcript: '该页暂无转录文本',
    notes_bullet_placeholder: '针对此条提问… (Enter 发送)',
    notes_model_label: '模型',

    // SessionPage
    session_recording: '录音中',
    session_not_recording: '未录音',
    session_start_hint: '点击开始录音',
    session_recording_hint: '录音中...',
    session_note_placeholder: '输入笔记 (Alt + N)…',
    session_submit_notes: '生成课堂笔记 →',
    session_submitting: '提交中…',
    session_submit_error: '提交失败，请检查网络后重试',
    session_recovery_title: '发现未完成的录音',
    session_recovery_sub: '上次录音未完成，是否要恢复？',
    session_recovery_continue: '用现有录音生成笔记',
    session_recovery_discard: '放弃录音（清除数据）',
    session_my_notes: '我的笔记',
    session_ai_notes: 'AI 笔记',
    session_no_annotation: '暂无笔记，点击 + 添加标注',
    session_lecture_slides: '课件幻灯片',
    session_ppt_not_uploaded: '未上传 PPT',
    session_support: '支持',
    session_privacy: '隐私',
    session_terms: '条款',

    // DetailedNotePage
    detailed_load_error: '无法加载笔记数据',
    detailed_back_home: '返回首页',
    detailed_navigation: '导航',
    detailed_back: '返回',
    detailed_page_prefix: '第',
    detailed_session_subtitle_pages: '页',
    detailed_session_subtitle_minutes: '分钟',
    detailed_no_user_notes: '该课程暂无用户笔记',
    detailed_annotation_label: 'PPT 批注',
    detailed_ai_clarification: 'AI 解析',
    detailed_off_slide: 'OFF-SLIDE 内容',
    detailed_no_data: '暂无笔记数据',
    detailed_my_tab: '我的笔记',
    detailed_ai_tab: 'AI 笔记',
  },
} as const

export type UiLang = keyof typeof i18n
export type I18nKey = keyof typeof i18n.en
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/i18n.ts
git commit -m "feat: add i18n dictionary with en/zh UI strings"
```

---

## Task 2: Extend TranslationContext

**Files:**
- Modify: `frontend/src/context/TranslationContext.tsx`

- [ ] **Step 1: Replace the file content**

```tsx
// frontend/src/context/TranslationContext.tsx
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { translateWithMyMemory } from '../lib/translation'
import { i18n, type UiLang, type I18nKey } from '../lib/i18n'

export type TargetLang = 'zh-CN' | 'zh-TW'

interface TranslationContextValue {
  // Content translation (ASR / notes)
  enabled: boolean
  targetLang: TargetLang
  setTargetLang: (lang: TargetLang) => void
  setEnabled: (v: boolean) => void
  translate: (text: string) => Promise<string>
  // UI language
  uiLang: UiLang
  setUiLang: (lang: UiLang) => void
  t: (key: I18nKey) => string
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

function readStoredLang(): UiLang {
  try {
    const stored = localStorage.getItem('ui-lang')
    if (stored === 'en' || stored === 'zh') return stored
  } catch { /* ignore */ }
  return 'en'
}

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-CN')
  const [uiLang, setUiLangState] = useState<UiLang>(readStoredLang)
  const cacheRef = useRef<Map<string, string>>(new Map())

  const setUiLang = useCallback((lang: UiLang) => {
    setUiLangState(lang)
    try { localStorage.setItem('ui-lang', lang) } catch { /* ignore */ }
  }, [])

  const t = useCallback(
    (key: I18nKey): string => i18n[uiLang][key],
    [uiLang],
  )

  const translate = useCallback(
    async (text: string): Promise<string> => {
      const key = `${targetLang}:${text}`
      if (cacheRef.current.has(key)) return cacheRef.current.get(key)!
      const result = await translateWithMyMemory(text, `en|${targetLang}`)
      cacheRef.current.set(key, result)
      return result
    },
    [targetLang],
  )

  return (
    <TranslationContext.Provider value={{ enabled, setEnabled, targetLang, setTargetLang, translate, uiLang, setUiLang, t }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(TranslationContext)
  if (!ctx) throw new Error('useTranslation must be used inside TranslationProvider')
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/context/TranslationContext.tsx
git commit -m "feat: add uiLang + t() to TranslationContext, persisted to localStorage"
```

---

## Task 3: Add Settings panel and language toggle to LobbyPage

**Files:**
- Modify: `frontend/src/pages/LobbyPage.tsx`

This task has two parts: (A) add a Settings panel that renders when `activeNav === 'settings'`, and (B) replace all hardcoded UI strings with `t()` calls.

- [ ] **Step 1: Add `useTranslation` import at the top of LobbyPage.tsx**

Find the existing imports block (around line 1-4):
```tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { uploadFiles, listSessions } from '../lib/api'
```

Replace with:
```tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTabs } from '../context/TabsContext'
import { uploadFiles, listSessions } from '../lib/api'
import { useTranslation } from '../context/TranslationContext'
```

- [ ] **Step 2: Add Settings panel component (before `export default function LobbyPage`)**

Insert this component before the `LobbyPage` function:

```tsx
function SettingsPanel() {
  const { uiLang, setUiLang, t } = useTranslation()
  return (
    <div style={{ padding: '48px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ fontSize: '24px', fontWeight: 900, color: '#292929', marginBottom: '40px' }}>
        {t('settings_title')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '480px' }}>
        {/* Language row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#292929' }}>
            {t('settings_language_label')}
          </span>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: '#F2F2EC',
              borderRadius: '9999px',
              padding: '4px',
              gap: '4px',
            }}
          >
            {(['en', 'zh'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setUiLang(lang)}
                style={{
                  padding: '6px 20px',
                  borderRadius: '9999px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 700,
                  fontFamily: 'Inter, system-ui, sans-serif',
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
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace hardcoded strings in LobbyPage's JSX**

In `LobbyPage` function body, add `const { t } = useTranslation()` right after the existing state declarations:

```tsx
export default function LobbyPage() {
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const { t } = useTranslation()   // ← add this line
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  // ... rest unchanged
```

- [ ] **Step 4: Replace sidebar strings**

Find sidebar brand section (around line 714-721):
```tsx
<div className="self-stretch text-lg font-bold font-['Inter'] leading-7" style={{ color: '#292929' }}>
  Student<br />Workspace
</div>
<div className="self-stretch opacity-60 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide mt-1" style={{ color: '#292929' }}>
  ACADEMIC YEAR 2026
</div>
```
Replace with:
```tsx
<div className="self-stretch text-lg font-bold font-['Inter'] leading-7" style={{ color: '#292929' }}>
  {t('lobby_brand').split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
</div>
<div className="self-stretch opacity-60 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide mt-1" style={{ color: '#292929' }}>
  {t('lobby_academic_year')}
</div>
```

Find the "Upload the record" button text (around line 732):
```tsx
<span className="text-center text-stone-50 text-xs font-semibold font-['Inter'] leading-5 tracking-tight">Upload the<br />record</span>
```
Replace with:
```tsx
<span className="text-center text-stone-50 text-xs font-semibold font-['Inter'] leading-5 tracking-tight">
  {t('lobby_new_record').split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
</span>
```

Find Search nav item (around line 742):
```tsx
<span className="text-xs font-medium font-['Inter'] leading-5" style={{ color: '#72726E' }}>Search</span>
```
Replace with:
```tsx
<span className="text-xs font-medium font-['Inter'] leading-5" style={{ color: '#72726E' }}>{t('lobby_search')}</span>
```

Find MY COURSES button text (around line 757):
```tsx
<span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>MY COURSES</span>
```
Replace with:
```tsx
<span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>{t('lobby_nav_courses')}</span>
```

Find SETTINGS button text (around line 765):
```tsx
<span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>SETTINGS</span>
```
Replace with:
```tsx
<span className="text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#292929' }}>{t('lobby_nav_settings')}</span>
```

- [ ] **Step 5: Replace main area header strings**

Find title and welcome text (around line 793-796):
```tsx
<div className="text-2xl font-black font-['Inter'] leading-8" style={{ color: '#292929' }}>Scholarly Workspace</div>
```
Replace with:
```tsx
<div className="text-2xl font-black font-['Inter'] leading-8" style={{ color: '#292929' }}>{t('lobby_title')}</div>
```

Find welcome subtitle:
```tsx
<div className="text-[10.40px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>WELCOME BACK, YOUR RECORDINGS ARE UP TO DATE.</div>
```
Replace with:
```tsx
<div className="text-[10.40px] font-normal font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{t('lobby_welcome')}</div>
```

Find Grid/List toggle text (around line 808-816):
```tsx
<span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}>Grid</span>
```
Replace with:
```tsx
<span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'grid' ? '#292929' : '#72726E' }}>{t('lobby_view_grid')}</span>
```
```tsx
<span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}>List</span>
```
Replace with:
```tsx
<span className="text-xs font-bold font-['Inter'] leading-4" style={{ color: viewMode === 'list' ? '#292929' : '#72726E' }}>{t('lobby_view_list')}</span>
```

- [ ] **Step 6: Replace empty state strings**

Find empty state (around line 839-845):
```tsx
<p className="text-sm mb-4" style={{ color: '#D0CFC5' }}>还没有任何课程记录</p>
<button ...>开始第一次录音</button>
```
Replace with:
```tsx
<p className="text-sm mb-4" style={{ color: '#D0CFC5' }}>{t('lobby_empty_hint')}</p>
<button ...>{t('lobby_start_first')}</button>
```

- [ ] **Step 7: Replace table header strings in `ListTable` component**

Find (around line 298-303):
```tsx
<div ...>COURSE<br/>THUMBNAIL</div>
<div ...>COURSE NAME &amp; IDENTIFIER</div>
<div ...>FOLDER</div>
<div ...>DATE</div>
<div ...>DURATION</div>
<div ...>NOTES</div>
```

`ListTable` does not yet use `t`. Add import at component level — since it's a sub-component inside the same file, it can call `useTranslation()` directly:

Replace the `ListTable` function signature and add `t`:
```tsx
function ListTable({ sessions, onRowClick }: { sessions: CourseCard[]; onRowClick: (id: string) => void }) {
  const { t } = useTranslation()
  const done = sessions.filter(s => s.status === 'done')
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
        <ListRow key={card.id} card={card} onClick={() => onRowClick(card.id)} isLast={i === done.length - 1} />
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Replace DoneCard notes suffix**

In `DoneCard` (around line 209):
```tsx
<div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.notes} notes</div>
```
`DoneCard` needs `t` — add `useTranslation` call inside the component:
```tsx
function DoneCard({ card, onClick }: { card: CourseCard; onClick: () => void }) {
  const { t } = useTranslation()
  const [thumbLoaded, setThumbLoaded] = useState(false)
  // ... rest
```
Then replace:
```tsx
<div className="text-xs font-normal font-['Inter'] leading-4" style={{ color: '#72726E' }}>{card.notes} {t('card_notes_suffix')}</div>
```

- [ ] **Step 9: Replace ListRow notes suffix**

`ListRow` (around line 286):
```tsx
{card.notes} notes
```
Add `useTranslation` to `ListRow`:
```tsx
function ListRow({ card, onClick, isLast }: { card: CourseCard; onClick: () => void; isLast: boolean }) {
  const { t } = useTranslation()
  // ... rest
```
Then replace:
```tsx
{card.notes} {t('card_notes_suffix')}
```

- [ ] **Step 10: Replace ProcessingCard "PROCESSING" label**

Add `useTranslation` to `ProcessingCard`:
```tsx
function ProcessingCard() {
  const { t } = useTranslation()
  return (
    // ... existing JSX
```
Find (around line 154):
```tsx
<div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>PROCESSING</div>
```
Replace with:
```tsx
<div className="text-[10.40px] font-bold font-['Inter'] uppercase leading-4 tracking-wide" style={{ color: '#72726E' }}>{t('card_processing')}</div>
```

- [ ] **Step 11: Replace upload modal strings in `NewClassModal`**

Add `useTranslation` to `NewClassModal`:
```tsx
function NewClassModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (sessionId: string) => void }) {
  const { t } = useTranslation()
  // ... existing state
```

Replace modal title (find `New Class`):
```tsx
// before
<div id="modal-title" ...>New Class</div>
// after
<div id="modal-title" ...>{t('modal_new_class_title')}</div>
```

Replace upload zone label/hint props and button text. Find the two `<UploadZone ... />` calls and the submit button:
```tsx
<UploadZone
  label={t('modal_ppt_label')}
  hint={t('modal_ppt_hint')}
  // ...
/>
<UploadZone
  label={t('modal_audio_label')}
  hint={t('modal_audio_hint')}
  // ...
/>
```

For the submit button (find `Uploading…` and `Save Workspace`):
```tsx
{uploading ? t('modal_uploading') : t('modal_submit')}
```

For upload error text (find `上传失败，请检查网络后重试`):
```tsx
setUploadError(t('modal_upload_error'))
```

For `validateFile` error messages — these are called outside component, so pass `t` or inline. Simplest: replace the string literals in `handlePpt`/`handleAudio` call sites:
```tsx
const handlePpt = useCallback((file: File) => {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  const acceptPpt = ['.ppt', '.pptx', '.pdf']
  if (!acceptPpt.includes(ext)) { setPptError(`${t('modal_file_format_error')} ${acceptPpt.join(' / ')}`); return }
  setPptError(null); setPptFile(file)
}, [t])

const handleAudio = useCallback((file: File) => {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  const acceptAudio = ['.mp3', '.wav', '.m4a', '.aac']
  if (!acceptAudio.includes(ext)) { setAudioError(`${t('modal_file_format_error')} ${acceptAudio.join(' / ')}`); return }
  if (file.size > MAX_AUDIO_MB * 1024 * 1024) { setAudioError(`${t('modal_file_size_error')} ${MAX_AUDIO_MB}MB`); return }
  setAudioError(null); setAudioFile(file)
}, [t])
```

- [ ] **Step 12: Replace toast strings in `ProcessingToast`**

Add `useTranslation` to `ProcessingToast`:
```tsx
function ProcessingToast({ toast, onClose, onOpen }: { ... }) {
  const { t } = useTranslation()
```

Replace `STEP_LABELS`:
```tsx
const STEP_LABELS: Record<string, string> = {
  uploading: t('toast_step_uploading'),
  converting: t('toast_step_converting'),
  parsing_ppt: t('toast_step_parsing_ppt'),
  transcribing: t('toast_step_transcribing'),
  aligning: t('toast_step_aligning'),
  generating: t('toast_step_generating'),
}
```

Replace text content:
```tsx
// title
{isDone ? t('toast_done_title') : isError ? t('toast_error_title') : t('toast_processing_title')}
// subtitle
{isDone ? t('toast_done_sub') : isError ? (toast.errorMsg || t('toast_default_sub')) : (STEP_LABELS[toast.step] ?? '...')}
// view button
{t('toast_view')}
```

- [ ] **Step 13: Wire Settings panel into LobbyPage main area**

Find the Content section (around line 822-859), which currently renders session cards. Change it to conditionally render `SettingsPanel` when `activeNav === 'settings'`:

```tsx
{/* Content */}
{activeNav === 'settings' ? (
  <SettingsPanel />
) : (
  <div className="w-full max-w-[1400px] px-12 py-8 flex flex-col justify-start items-start gap-24">
    {/* Session cards — existing code unchanged */}
    {viewMode === 'grid' ? (
      // ... existing grid code
    ) : (
      // ... existing list code
    )}
  </div>
)}
```

- [ ] **Step 14: Commit**

```bash
git add frontend/src/pages/LobbyPage.tsx
git commit -m "feat: add Settings panel with language toggle; replace all LobbyPage strings with t()"
```

---

## Task 4: Update TopBar

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`

- [ ] **Step 1: Add import and replace strings**

Add import:
```tsx
import { useTranslation } from '../context/TranslationContext'
```

In `TopBar` function, add `t` after existing hook calls:
```tsx
export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tabs, activeTabId, closeTab, activateTab } = useTabs()
  const { t } = useTranslation()
```

Replace `Dashboard` button text (around line 251):
```tsx
Dashboard
```
→
```tsx
{t('topbar_dashboard')}
```

Replace `Detailed Note →` button text (around line 301):
```tsx
Detailed Note →
```
→
```tsx
{t('topbar_detailed_note')}
```

Replace `关闭 ${label}` in `ChromeTab` close button aria-label. `ChromeTab` is a sub-component in the same file — it doesn't have access to `t` directly. Pass it as a prop from `TopBar`:

Change `ChromeTab` to accept `closeLabel`:
```tsx
function ChromeTab({
  label,
  favicon,
  isActive,
  onClick,
  onClose,
  closeLabel,
}: {
  label: string
  favicon?: string
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  closeLabel: string
}) {
```

In the close button:
```tsx
aria-label={closeLabel}
```

In `TopBar` where `ChromeTab` is rendered (around line 274-281):
```tsx
<ChromeTab
  key={tab.sessionId}
  label={tab.label}
  isActive={isActive}
  onClick={() => handleTabClick(tab.sessionId)}
  onClose={(e) => handleTabClose(e, tab.sessionId)}
  closeLabel={`${t('topbar_close_tab')} ${tab.label}`}
/>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TopBar.tsx
git commit -m "feat: replace TopBar hardcoded strings with t()"
```

---

## Task 5: Update ProcessingPage

**Files:**
- Modify: `frontend/src/pages/ProcessingPage.tsx`

- [ ] **Step 1: Add import**

```tsx
import { useTranslation } from '../context/TranslationContext'
```

- [ ] **Step 2: Replace STAGES array with dynamic version**

Remove the module-level `STAGES` constant. Inside `ProcessingPage`, derive stages from `t()`:

```tsx
export default function ProcessingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? ''
  const { t } = useTranslation()

  const STAGES = [
    { id: 'convert', label: t('processing_stage_convert'), description: t('processing_stage_convert_desc') },
    { id: 'ppt',     label: t('processing_stage_ppt'),     description: t('processing_stage_ppt_desc') },
    { id: 'asr',     label: t('processing_stage_asr'),     description: t('processing_stage_asr_desc') },
    { id: 'align',   label: t('processing_stage_align'),   description: t('processing_stage_align_desc') },
  ]

  const [currentStage, setCurrentStage] = useState(0)
  // ... rest of state unchanged
```

- [ ] **Step 3: Replace all hardcoded strings in JSX**

Failed state:
```tsx
<h2 className="text-lg font-bold text-gray-900 mb-2">{t('processing_failed_title')}</h2>
<p className="text-sm text-gray-500 mb-6">{t('processing_failed_sub')}</p>
<button ... onClick={() => navigate('/upload')}>{t('processing_reupload')}</button>
<button ... onClick={() => setFailed(false)}>{t('processing_retry')}</button>
```

Processing state:
```tsx
<h1 className="text-xl font-bold text-gray-900 mb-1">{t('processing_title')}</h1>
<p className="text-sm text-gray-600 mb-8">
  {remaining > 0 ? `${t('processing_remaining')} ${remaining} 秒` : t('processing_still')}
</p>
```

Progress bar aria-label:
```tsx
aria-label={t('processing_progress_label')}
```

Stage list item aria-label (around line 150):
```tsx
aria-label={`${stage.label}：${done ? t('processing_done') : active ? t('processing_in_progress') : t('processing_waiting')}`}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ProcessingPage.tsx
git commit -m "feat: replace ProcessingPage hardcoded strings with t()"
```

---

## Task 6: Update PillToggle and TemplateSelector

**Files:**
- Modify: `frontend/src/components/PillToggle.tsx`
- Modify: `frontend/src/components/TemplateSelector.tsx`

- [ ] **Step 1: Update PillToggle**

```tsx
// frontend/src/components/PillToggle.tsx
import { useTranslation } from '../context/TranslationContext'

interface PillToggleProps {
  value: 'my' | 'ai'
  onChange: (v: 'my' | 'ai') => void
}

export default function PillToggle({ value, onChange }: PillToggleProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => onChange('my')}
        title={t('pill_my_notes')}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'my'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t('pill_my_notes')}
      </button>
      <button
        onClick={() => onChange('ai')}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
          value === 'ai'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t('pill_ai_notes')}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update TemplateSelector**

```tsx
// frontend/src/components/TemplateSelector.tsx
import { useState } from 'react'
import { useTranslation } from '../context/TranslationContext'

export type Template = 'outline' | 'qa' | 'cornell' | 'mindmap'
export type Granularity = 'simple' | 'detailed'

interface TemplateSelectorProps {
  template: Template
  granularity: Granularity
  onTemplateChange: (t: Template) => void
  onGranularityChange: (g: Granularity) => void
}

export default function TemplateSelector({
  template,
  granularity,
  onTemplateChange,
  onGranularityChange,
}: TemplateSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const TEMPLATES: { id: Template; label: string; desc: string }[] = [
    { id: 'outline', label: t('template_outline_label'), desc: t('template_outline_desc') },
    { id: 'qa',      label: t('template_qa_label'),      desc: t('template_qa_desc') },
    { id: 'cornell', label: t('template_cornell_label'), desc: t('template_cornell_desc') },
    { id: 'mindmap', label: t('template_mindmap_label'), desc: t('template_mindmap_desc') },
  ]

  const current = TEMPLATES.find((tmpl) => tmpl.id === template)!

  return (
    <div className="flex items-center gap-2">
      {/* Template dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
        >
          {current.label}
          <span className="text-gray-400">›</span>
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-20 w-48">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => { onTemplateChange(tmpl.id); setOpen(false) }}
                className={`w-full flex flex-col text-left px-4 py-2.5 hover:bg-indigo-50 first:rounded-t-xl last:rounded-b-xl ${
                  template === tmpl.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                }`}
              >
                <span className="text-sm font-medium">{tmpl.label}</span>
                <span className="text-xs text-gray-400">{tmpl.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Granularity toggle */}
      <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
        <button
          onClick={() => onGranularityChange('simple')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            granularity === 'simple' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
          }`}
        >
          {t('template_simple')}
        </button>
        <button
          onClick={() => onGranularityChange('detailed')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            granularity === 'detailed' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
          }`}
        >
          {t('template_detailed')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PillToggle.tsx frontend/src/components/TemplateSelector.tsx
git commit -m "feat: replace PillToggle and TemplateSelector strings with t()"
```

---

## Task 7: Update NotesPage

**Files:**
- Modify: `frontend/src/pages/NotesPage.tsx`

- [ ] **Step 1: Add import**

Add to imports block:
```tsx
import { useTranslation } from '../context/TranslationContext'
```

- [ ] **Step 2: Add `t` inside `NotesPage` component**

```tsx
const { t } = useTranslation()
```

- [ ] **Step 3: Replace strings — loading/error state**

Find loading state JSX (search for `加载笔记中`):
```tsx
// before
<div>加载笔记中…</div>
// after
<div>{t('notes_loading')}</div>
```

Find error state (search for `未知错误`):
```tsx
// retry button
<button ...>{t('notes_retry')}</button>
// error message
{error ?? t('notes_unknown_error')}
```

- [ ] **Step 4: Replace nav / tab strings**

Find TOC label (search for `目录`):
```tsx
{t('notes_toc')}
```

Find tab buttons (My Notes / AI Notes / Transcript):
```tsx
{t('notes_my_tab')}
{t('notes_ai_tab')}
{t('notes_transcript_tab')}
```

Find `PPT 批注` / `MY NOTES` headings:
```tsx
{t('notes_annotation_label')}
{t('notes_my_notes_heading')}
```

- [ ] **Step 5: Replace placeholder strings**

Find `在这里记录你的理解、困惑或关键词…`:
```tsx
placeholder={t('notes_my_placeholder')}
```

Find `向 AI 提问… (Enter 发送)` (page chat):
```tsx
placeholder={t('notes_page_chat_placeholder')}
```

Find `针对此条提问… (Enter 发送)` (bullet inline):
```tsx
placeholder={t('notes_bullet_placeholder')}
```

- [ ] **Step 6: Replace expand / AI notes strings**

Find `扩写` and `扩写中...`:
```tsx
{isExpanding ? t('notes_expanding') : t('notes_expand')}
```

Find `该页暂无 AI 笔记`:
```tsx
{t('notes_no_ai_notes')}
```

Find `OFF-SLIDE CONTENT`:
```tsx
{t('notes_off_slide')}
```

Find `该页暂无转录文本`:
```tsx
{t('notes_no_transcript')}
```

Find `模型` label:
```tsx
{t('notes_model_label')}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/NotesPage.tsx
git commit -m "feat: replace NotesPage hardcoded strings with t()"
```

---

## Task 8: Update SessionPage

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx`

- [ ] **Step 1: Add import and `t`**

```tsx
import { useTranslation } from '../context/TranslationContext'
```

Inside `SessionPage`:
```tsx
const { t } = useTranslation()
```

- [ ] **Step 2: Replace strings**

Recording status badge (search for `LIVE RECORDING` / `NOT RECORDING`):
```tsx
{isRecording ? t('session_recording') : t('session_not_recording')}
```

Start hint / recording hint:
```tsx
{isRecording ? t('session_recording_hint') : t('session_start_hint')}
```

Note textarea placeholder:
```tsx
placeholder={t('session_note_placeholder')}
```

Submit button:
```tsx
{submitting ? t('session_submitting') : t('session_submit_notes')}
```

Submit error:
```tsx
setSubmitError(t('session_submit_error'))
```

Recovery modal title and subtitle:
```tsx
<h2>{t('session_recovery_title')}</h2>
<p>{t('session_recovery_sub')}</p>
```

Recovery buttons:
```tsx
<button ...>{t('session_recovery_continue')}</button>
<button ...>{t('session_recovery_discard')}</button>
```

My Notes / AI Notes tab labels:
```tsx
{t('session_my_notes')}
{t('session_ai_notes')}
```

Empty annotation hint:
```tsx
{t('session_no_annotation')}
```

Slide panel heading:
```tsx
{t('session_lecture_slides')}
```

PPT not uploaded hint:
```tsx
{t('session_ppt_not_uploaded')}
```

Footer links:
```tsx
{t('session_support')}
{t('session_privacy')}
{t('session_terms')}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat: replace SessionPage hardcoded strings with t()"
```

---

## Task 9: Update DetailedNotePage

**Files:**
- Modify: `frontend/src/pages/DetailedNotePage.tsx`

- [ ] **Step 1: Add import and `t`**

```tsx
import { useTranslation } from '../context/TranslationContext'
```

Inside `DetailedNotePage`:
```tsx
const { t } = useTranslation()
```

- [ ] **Step 2: Replace strings**

Load error state:
```tsx
{t('detailed_load_error')}
{t('detailed_back_home')} // back button text
```

Navigation heading:
```tsx
{t('detailed_navigation')}
```

Back button:
```tsx
{t('detailed_back')}
```

Page prefix (dynamic "第 N 页"):
```tsx
{t('detailed_page_prefix')} {pageNum} {t('detailed_session_subtitle_pages')}
```

Session subtitle:
```tsx
Session · {pageCount} {t('detailed_session_subtitle_pages')} · {duration} {t('detailed_session_subtitle_minutes')}
```

No user notes:
```tsx
{t('detailed_no_user_notes')}
```

Annotation label:
```tsx
{t('detailed_annotation_label')}
```

AI clarification heading:
```tsx
{t('detailed_ai_clarification')}
```

Off-slide heading:
```tsx
{t('detailed_off_slide')}
```

No data:
```tsx
{t('detailed_no_data')}
```

My Notes / AI Notes tabs:
```tsx
{t('detailed_my_tab')}
{t('detailed_ai_tab')}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DetailedNotePage.tsx
git commit -m "feat: replace DetailedNotePage hardcoded strings with t()"
```

---

## Task 10: Smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 2: Test English mode (default)**

- LobbyPage loads with English UI: "Scholarly Workspace", "MY COURSES", "SETTINGS", "Grid", "List"
- Click SETTINGS → Settings panel appears with "Language" label and EN / 中文 pill toggle
- EN pill is highlighted by default

- [ ] **Step 3: Switch to Chinese**

- Click 中文 pill → all text on the page immediately switches to Chinese
- Sidebar: "我的课程", "设置", "学术工作台"
- Reload the page → still Chinese (localStorage persisted)

- [ ] **Step 4: Navigate to NotesPage (if session exists)**

- Open a notes session → tab labels show "我的笔记" / "AI 笔记" / "转录文本" in Chinese
- Switch back to EN in Settings → navigate to notes → all labels in English

- [ ] **Step 5: Check ProcessingPage**

Navigate to `/processing?session_id=test` → stage labels in current language

- [ ] **Step 6: Final commit if any last-minute fixes needed**

```bash
git add -p
git commit -m "fix: language switch smoke test fixes"
```
