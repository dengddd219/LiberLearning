# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LiberStudy** is a multimodal lecture knowledge structuring tool. It aligns instructor speech (ASR transcription) with PPT slides on a per-page basis, producing structured study notes anchored to individual PPT pages.

Core flow: User uploads PPT + records audio in-browser (or uploads audio file) → ASR transcription with timestamps → user note anchors + semantic alignment builds per-page timeline → LLM generates structured notes per PPT page → outputs in a tri-pane view (slide nav + PPT canvas + notes panel).

## Current State

This repository is in the **pre-code / PRD stage**. The product requirements document is in `LiberStudy-PRD.md` (v0.4). No application code has been written yet.

## MVP-0 Scope

MVP-0 focuses on **Scene ② (real-time in-class recording)** as the core, with **Scene ① (post-class audio upload)** as P1. Scenes ③④ (video/screen capture) are deferred to V2.

## Planned Tech Stack (decided)

- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Backend**: FastAPI (Python)
- **PPT Parsing & Rendering**: LibreOffice (headless, converts .ppt/.pptx to PDF) + PyMuPDF (text extraction + PNG rendering)
- **Audio Format Conversion**: FFmpeg (WebM/Opus → WAV for ASR APIs)
- **Chinese ASR**: Alibaba Cloud ASR API
- **English ASR**: OpenAI Whisper API
- **Semantic Alignment**: OpenAI text-embedding-3-small
- **Note Generation**: Claude API (claude-sonnet)
- **Deployment**: Cloud deployment (frontend + backend separated), API keys in server-side environment variables

## Target Users

- **Primary — 小林 (STEM university student)**: 985/211 undergrad, PPT-heavy technical courses (formulas, code, architecture diagrams), high AI tool adoption, goal: get structured notes per PPT page without replaying recordings.
- **Secondary — 小陈 (humanities university student)**: economics/law/journalism, PPT-light (concepts, cases), medium tech savviness, goal: capture teacher's oral elaboration (cases, opinions) not shown on PPT.
- **Tertiary — Alex (professional, post-MVP)**: 3-5 years in internet/consulting, attends PPT-driven meetings, needs structured meeting minutes with action items.

The product language is Chinese.

## Key MVP-0 Features (P0)

1. In-class real-time recording (browser microphone) with inline text annotation on PPT (click to create text label in-place, no pin/connector line)
2. PPT file upload and parsing (.ppt/.pptx/.pdf via LibreOffice + PyMuPDF)
3. ASR transcription with timestamps + post-processing (filler word removal, semantic repair, punctuation reconstruction)
4. User note anchors + semantic alignment for per-page timeline (debounced anchor + semantic similarity calibration; supports non-linear lecture flow)
5. Structured note generation via LLM (passive learning: all pages; active learning: additive on pages with user notes)
6. Tri-pane viewing interface (slide nav + PPT canvas + notes panel) with pill-style "My Notes | AI Notes" toggle; AI Notes side provides 4 template options + simple/detailed granularity switch

## Key MVP-0 Features (P1)

- **Post-class audio file upload** (Scene ①): MP3/WAV/M4A upload + optional manual page-timestamp anchoring
- **Quick Ask (课中实时辅助)**: AssistiveTouch-style floating ball, draggable, semi-transparent, snaps to screen edge; click to open chat, ask "what did the teacher just say?" — AI answers from streaming ASR cache without triggering batch processing. V2: Electron desktop client for system-level overlay. Trigger shortcut: input "？" to auto-summarize recent N minutes.
- **No-PPT mode**: recording + free-text notes only; output structured by topic paragraphs instead of PPT pages
- **Note export**: Markdown (primary) + PDF (secondary)

## Key Design Decisions

- **PPT is optional**: Without PPT → active learning only (user notes + transcript). With PPT → passive learning added (AI aligns transcript to slides)
- **PPT browsing**: Vertical scroll (all pages stacked, like a webpage), not left/right pagination
- **Data persistence**: IndexedDB (frontend for audio chunks and session drafts); cloud DB for processed structured notes and session metadata
- **Export**: Markdown (primary) + PDF (secondary, jsPDF + html2canvas, frontend-only)
- **Passive learning is the base layer**: all pages always get notes; active learning (user-note-based expansion) is additive on top
- **Teacher off-slide detection**: periods where teacher leaves the PPT (e.g., opens VSCode) are not force-aligned; content goes into `page_supplement` of the most recent page
- **Alignment signal priority**: ASR transcript × PPT text semantic similarity is the strongest signal; time-axis ordering is a soft prior, not a hard constraint

## Classroom Behavior Observations (Field Research)

These observations directly inform product design decisions:

| ID | Observation | Product Implication |
|----|-------------|---------------------|
| **S1** | Students rarely stay focused on PPT full-time; they drift to phone/other tabs but need to know where the teacher is | Quick Ask floating ball must persist without requiring user to stay on LiberStudy page; MVP: in-page draggable AssistiveTouch ball; V2: Electron system-level overlay |
| **S2** | When a student zones out and returns, the most urgent need is "what did I miss just now" — a single "？" is enough | Quick Ask "？" shortcut for auto-summarizing recent N minutes is a high-frequency critical need; prioritize response speed and context quality |
| **T1** | Teachers often read from PPT text, and largely follow PPT page order | ASR × PPT semantic similarity is the strongest alignment signal; time-axis ordering is a useful soft prior |
| **T2** | Teachers frequently leave the PPT for minutes (e.g., live coding in VSCode) before returning | System must detect "off-slide mode"; those segments go to `page_supplement`, not force-aligned to any page |
| **T3** | Teachers reference prior lecture content ("as we covered last class..."), creating context gaps for students | Cross-session knowledge recall is a V2 feature (Agent + RAG over historical sessions) |

## Constraints

- MVP: single language only (Chinese or English), no mixed-language support
- One PPT per audio (no multi-PPT support)
- Per-user limits: max 2 sessions/day, max 120 minutes per audio
- Cloud deployment; audio/PPT files cleaned after processing, structured notes stored in cloud DB
- Session interruption recovery: audio chunks persisted to IndexedDB; on next page open, if an incomplete session exists, show recovery modal (continue / generate with existing / discard)
- Partial failure strategy: LLM note generation is per-page with up to 3 retries; partial success enters `partial_ready` state with per-page retry buttons; ASR/alignment failure enters `error` state
