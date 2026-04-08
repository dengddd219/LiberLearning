# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LiberStudy** is a multimodal lecture knowledge structuring tool. It aligns instructor speech (ASR transcription) with PPT slides on a per-page basis, producing structured study notes anchored to individual PPT pages.

Core flow: User uploads PPT + records audio in-browser (or uploads audio file) → ASR transcription with timestamps → user note anchors + semantic alignment builds per-page timeline → LLM generates structured notes per PPT page → outputs in a tri-pane view (slide nav + PPT canvas + notes panel).

## Current State

This repository is in the **pre-code / PRD stage**. The product requirements document is in `LiberStudy-PRD.md` (v0.2). No application code has been written yet.

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
- **Deployment**: Local-only (localhost), API keys in .env

## Target Users

Primary: Chinese university students (STEM and humanities). Secondary: professionals attending PPT-driven meetings. The product language is Chinese.

## Key MVP-0 Features (P0)

1. In-class real-time recording (browser microphone) with pin-annotation on PPT
2. PPT file upload and parsing (.ppt/.pptx/.pdf via LibreOffice + PyMuPDF)
3. ASR transcription with timestamps
4. User note anchors + semantic alignment for per-page timeline
5. Structured note generation via LLM (passive learning: all pages; active learning: additive on pages with user notes)
6. Tri-pane viewing interface (slide nav + PPT canvas + notes panel) with "My Notes | AI Notes" view toggle

## Key Design Decisions

- **Passive + Active learning are additive, not mutually exclusive**: All pages get passive learning (bullet annotations). Pages with user notes ALSO get active learning (note expansion), layered on top.
- **Data persistence**: IndexedDB (via Dexie.js), NOT localStorage
- **Export**: Markdown (primary) + PDF (secondary)

## Constraints

- MVP: single language only (Chinese or English), no mixed-language support
- One PPT per audio (no multi-PPT support)
- Per-user limits: max 2 sessions/day, max 120 minutes per audio
- Local-only deployment, all data on user's machine
