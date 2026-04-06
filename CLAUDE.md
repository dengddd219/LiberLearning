# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LiberStudy** is a multimodal lecture/meeting knowledge structuring tool. It aligns instructor speech (ASR transcription) with PPT slides (Vision/OCR) on a per-page basis, producing structured study notes anchored to individual PPT pages.

Core flow: User uploads PPT + lecture video/audio → ASR transcription with timestamps → video frame sampling for slide transition detection → multimodal LLM aligns transcript segments with corresponding PPT pages → outputs structured notes in a dual-pane view (slide thumbnails on left, notes on right).

## Current State

This repository is in the **pre-code / PRD stage**. The product requirements document is in `LiberStudy-PRD.md`. No application code has been written yet.

## Planned Tech Stack (from PRD)

- **Frontend**: React or Next.js (responsive web app, desktop-first)
- **Backend**: FastAPI (Python) or Next.js full-stack
- **ASR**: Whisper (local) or OpenAI Whisper API
- **PPT Understanding**: GPT-4o Vision / Qwen-VL / LLaVA
- **Note Generation**: GPT-4o / Claude / Qwen2.5
- **Slide Transition Detection**: OpenCV frame differencing + perceptual hash (pHash), with SSIM or CLIP as fallback if accuracy < 85%
- **File Storage**: Local filesystem for MVP, S3/OSS for scale

Three technical approaches (A: pure API, B: pure open-source, C: hybrid) are being evaluated. The PRD recommends starting with approach C (hybrid) for MVP.

## Target Users

Primary: Chinese university students (STEM and humanities). Secondary: professionals attending PPT-driven meetings. The product language is Chinese.

## Key MVP Features (P0)

1. File upload (PPT/PPTX + MP4/WebM/MP3/WAV)
2. PPT page transition detection via video frame analysis
3. ASR transcription with timestamps
4. Multimodal alignment (transcript segments ↔ PPT pages)
5. Structured note generation via LLM
6. Dual-pane viewing interface (slide nav + notes)

## Constraints

- MVP: single language only (Chinese or English), no mixed-language support
- One PPT per video (no multi-PPT support)
- Per-user limits: max 2 videos/day, max 120 minutes per video
- Uploaded files auto-deleted from server within 24 hours
- No user account system in MVP (session URL sharing instead)
