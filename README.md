# FrameForge Studio

### An Intelligent Visual Video Editor with Evidence-Aware Data Storytelling

**FrameForge Studio** is a web-based video editing and generation platform that combines intuitive visual editing, programmatic video rendering, and intelligent data storytelling.

The application aims to make video creation accessible through a drag-and-drop editing workspace while retaining the flexibility of structured, code-driven video generation.

Unlike a conventional video editor, FrameForge also explores how structured datasets can be transformed into animated, editable visual narratives, with analytical claims connected to their underlying data.

## Overview

FrameForge brings together two primary workflows:

- **Visual Video Editing:** Create and customize videos using an interactive canvas, editable elements, layers, scenes, animations, and timeline controls.
- **Intelligent Data Storytelling:** Import structured datasets, generate analytical insights, and transform them into animated infographic-style video scenes.

Rather than treating videos solely as finished media files, FrameForge represents them as structured compositions that can be edited, previewed, and rendered.

## Current working status

Status reviewed on **13 November 2026**, against the current working tree, including in-progress changes.

FrameForge is a substantial local prototype: it already supports useful manual video editing, evidence-linked data stories, project persistence, and real MP4 exports. Its strongest workflows are **editing existing scenes** and **turning CSV data into editable, traceable visual stories**. Auto Mode adds script writing, speech, captions, and stock footage, but it is still experimental and is not yet dependable as a one-click video generator on a CPU-only laptop.

| Workflow | Current position |
|---|---|
| Manual video editing | Implemented: arrange elements, edit scenes, animate, preview, save, and export. |
| Data storytelling | Implemented: import CSV data, generate evidence-linked scenes, review dataset changes, and selectively update content. |
| Local accounts | Implemented: registration, login/logout, hashed passwords, sessions, and per-user project storage. |
| Topic-to-script writing | Verified with local Ollama and `qwen3:1.7b`; response time depends on the machine and model. |
| Stock footage | Real Pixabay footage has been verified in the editor preview and exported MP4. Subject relevance is not yet validated. |
| Narration and Auto Mode | Integration exists, but the current Demo Voice reference path timed out during real CPU synthesis. Consistent multi-scene narration is not yet verified in real generation. |

No defensible overall completion percentage is available. The core editor is usable, while reliable automation, narrator consistency, footage relevance, and generation speed still need work.

## Key Features

- **Visual Editor:** Interactive canvas for arranging and customizing text, images, shapes, and charts, with snapping guides, in-place text editing, duplicate/copy/paste, layers and undo/redo.
- **Scene-Based Timeline:** Organize video scenes, drag to set durations, reorder, and configure animations and transitions.
- **Editable Compositions:** Modify generated content instead of being restricted to fixed templates.
- **Data-Driven Storytelling:** Import a CSV and generate a 3–5 scene animated story (intro, key metric, comparison, trend or distribution, summary) — only the scenes the data supports.
- **Evidence-Aware Analytics:** Numerical claims in generated data stories come from stored, deterministic calculations linked to the exact dataset version and the scenes that show them. This evidence guarantee does not extend to Ollama-written topic scripts.
- **Evidence-Aware Updates:** Upload a new version of a dataset and only the affected claims and scenes are refreshed, with a before/after review; manual styling and unrelated scenes are preserved.
- **Video Preview and Export:** Preview in the browser and export real H.264 MP4 files (720p/1080p, 24/30 fps, 16:9, 9:16 or 1:1), each verified by a full decode.
- **Evaluation:** An in-editor panel that re-runs every claim against its stored data and measures evidence coverage, update selectivity and export speed.
- **Structured Project Management:** Store and reload editable video projects.

See [Feature status](#feature-status) for exactly what is implemented and how it is tested.

## What Makes FrameForge Different?

FrameForge's distinguishing direction is the integration of **visual video editing, evidence-linked analytics, and dependency-aware content generation**.

Traditional editors focus primarily on arranging and animating media. Programmatic video frameworks focus on defining and rendering video through code.

FrameForge combines these approaches while introducing a stronger connection between a video's content and the data supporting it.

### Evidence-Aware Incremental Video Generation (EAIVG)

FrameForge implements a mechanism called **Evidence-Aware Incremental Video Generation (EAIVG)** for scene content.

It tracks relationships between:

**Dataset → Calculations → Verified Insights → Visual Elements → Video Scenes**

Each numerical claim is stored as an *evidence record*: dataset id, dataset version and SHA-256 hash, the calculation definition, the computed value, and the scenes that display it. When source data changes, FrameForge recomputes the affected calculations, classifies each claim as **unchanged, changed or broken**, refreshes only the data-bound text and chart data, marks scenes **stale** (with reasons) when a claim can no longer be computed, and shows an update report before anything is applied.

This delivers three goals:

1. **Traceability:** Numerical claims are linked to their source calculations and can be re-verified at any time.
2. **Editability:** Automatically generated visualizations remain customizable, and manual styling survives updates.
3. **Incremental Updates:** Data changes propagate to the relevant scene elements without regenerating unrelated content.

True incremental *video rendering* — segment caching and selective re-rendering — is a separate capability and is **not implemented**: every export renders all frames. The application states this wherever it is relevant.

## How It Works

```text
        Visual Editing
              |
              v
      Structured Scene Model <------ Dataset Import
              |                          |
              |                          v
              |                  Data Analysis
              |                          |
              |                          v
              |                  Evidence & Insights
              |                          |
              +-------------+------------+
                            |
                            v
                     Video Timeline
                            |
                            v
                    Preview & Render
                            |
                            v
                       Video Export
```

Users can create scenes manually or use the data-storytelling features to generate editable visual content. The structured scene model connects the editor to the video-rendering pipeline.

Key design decisions:

- **One versioned scene document**, validated with Zod on every read and write.
- **One pure animation evaluator**, `evaluateProject(project, timeMs)`, supplies animation state to both the browser preview and every exported frame. Media loading and real-time playback still depend on browser behavior.
- **MP4 export** follows the HyperFrames capture pattern (seekable page → per-frame screenshot → FFmpeg) with FrameForge's own seek contract: headless Chrome is driven by Playwright and frames are encoded by FFmpeg. No HyperFrames code is copied.
- **All statistics are deterministic JavaScript**, computed on the server from the stored CSV version. Narrative text is a template whose numbers come only from evidence, so no number is invented.

## Feature status

The following capabilities are implemented, with unit and browser end-to-end coverage across the main workflows. Coverage does not mean every external service or hardware configuration is reliable; see the current limitations below.

| Area | Features |
|---|---|
| Projects | Dashboard (create from template, list with hover previews, delete), autosave and Ctrl+S, reload persistence |
| Accounts | Sign up, sign in, sign out, server-side sessions, password hashing, and user-isolated local project storage; optional development-only login shortcut |
| Editing | Text, shapes, images, charts; drag, resize, snapping guides (Alt disables); in-place text editing; duplicate, copy/paste; layers list; undo/redo; keyboard shortcuts |
| Scenes and animation | Add, delete, duplicate, reorder scenes; drag scene duration; fade / slide / scale / pop presets with easing; enter and exit animations; fade and slide transitions |
| Assets | Image upload (type checked by file content; PNG, JPEG, GIF, WebP; SVG rejected; 8 MB limit) and an Assets tab |
| Export | H.264 MP4, 720p/1080p, 24/30 fps, three aspect ratios, progress and errors, full-decode verification, download; uploaded images verified to appear in the video |
| Data | CSV validation and preview; column typing (numeric, date, categorical, text); missing values; count, sum, mean, min, max, group-by, top share, trend (with date bucketing), trend change, histogram |
| Data stories | Storyboard plan with reasons for skipped scenes; evidence-linked claims; count-up numbers; Evidence section in the inspector |
| Evidence-aware updates | Dataset versioning (identical uploads detected); update review with before/after comparison; selective refresh; stale scenes; apply as one undo step; Evidence Inspector with canvas highlighting |
| Evaluation | Evaluation panel; per-export performance log; update history; benchmark script |
| Audio | MP3/WAV/OGG upload (checked by content and fully decoded; 25 MB); per-scene narration with volume and start offset; background music with loop, fades and ducking under speech; waveforms on the timeline; synced preview playback; mixed into the export as AAC and verified |
| Voice (VoiceStudio) | Text-to-speech integration, voice selection, existing voice-cloning controls, optional voice description, scene fitting, transcription, and caption creation. The current Auto Mode narrator-resolution change uses the Demo Voice profile for default/OpenAI-style aliases and preserves existing profile selections. Mock tests pass, but real CPU reference synthesis timed out; this path is not yet a verified working fix. |
| Video clips | MP4/WebM upload (100 MB, checked with FFmpeg); video elements with fit, start offset, loop or hold; each frame is a pure function of scene time, so preview, thumbnails and export agree; export streams clips to the render browser through short-lived, project-scoped URLs |
| Short-video generator | A topic or your own script becomes an editable scene project, with optional speech, captions, uploaded clips, Pixabay/Pexels footage, and music. Matching orientations are preferred; validated clips can be cropped to fill the canvas. Stock credits and sanitized search/download diagnostics are retained. Speech synthesis can fail a job, and footage relevance remains unresolved. The pipeline follows MoneyPrinterTurbo's approach, re-implemented in TypeScript. |
| Narration writing (Ollama) | Optional "Write with AI" rewrites a scene's on-screen text as narration with a local model; output that introduces a number not on screen is rejected |
| Interface | Original pixel-art ocean theme; light and dark modes; dashboard colours follow the time of day (dawn, day, sunset, night); WCAG AA contrast tested for every colour combination |

### Current limitations and unfinished work

- **CPU narration reliability:** the latest real reference-voice test exceeded the existing five-minute synthesis timeout on its first scene. Mock tests verify profile routing, not audible speaker consistency. No lightweight-engine replacement has been installed or integrated as a fix.
- **Footage relevance:** selection checks duration, orientation/renditions, and trusted download hosts, but does not validate whether the footage depicts the narration's subject. Broad fallback queries can produce unrelated clips. Plain backgrounds are supported, but unrelated footage is not yet consistently rejected.
- **Speed controls:** the scene voice-panel selector sets synthesis speed for the next generation request; it does not change existing audio immediately. The requested `0.5× / 1× / 1.5× / 2×` replacement and its end-to-end verification have not been implemented.
- **Caption synchronization after edits:** caption wording/timing can fall back to transcription or estimates. Existing caption elements are not automatically rebuilt after changes to narration offsets or scene length; manual re-timing is available.
- **Generation latency:** speech, transcription, and footage processing run largely scene by scene. No representative nine-scene before/after performance improvement has been verified.
- **LLM-written analytical stories:** CSV story wording remains deterministic. Ollama can write topic-based short scripts or rewrite scene narration, but the evidence calculations do not depend on it.
- **Stock images:** automatic stock retrieval currently supports video clips only. Image elements and manual image uploads are supported separately.
- **Selective video re-rendering** — every export renders all frames.
- **Production infrastructure:** cloud storage/deployment, durable background job queues, keyframe curves, and real-time collaboration are not implemented. Storage remains local to the host machine.

## Technology

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4; Motion (Framer Motion) for interface animation |
| Editor state | Zustand, with a custom snapshot history for undo/redo |
| Validation | Zod 4 (scene documents, API inputs, calculation definitions) |
| Data | PapaParse for CSV parsing; custom deterministic statistics |
| Rendering | React DOM / SVG scene renderer; Playwright Core driving the installed Chrome or Edge; FFmpeg via `ffmpeg-static` |
| Storage | Local JSON files and assets under `data/`, with id validation, path containment and atomic writes |
| Testing | Vitest (unit), Playwright (browser end-to-end) |
| Fonts | Pixelify Sans, Press Start 2P, Mulish, Bricolage Grotesque, Geist Mono (Google Fonts, OFL) |

## Getting started

**Prerequisites:** Node.js 20.9 or newer and Google Chrome or Microsoft Edge installed (used for MP4 export). FFmpeg is bundled through `ffmpeg-static`.

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account or sign in, and create a project. In the editor, try the **Data** tab → *Try the synthetic sample* for the data-story workflow. Manual editing and data stories do not require Ollama or VoiceStudio.

For topic-based scripts with the model verified on the current development machine, add these server-side settings to `.env.local`:

```env
FF_OLLAMA_URL=http://localhost:11434
FF_OLLAMA_MODEL=qwen3:1.7b
```

The integration's fallback model remains `llama3.2` when `FF_OLLAMA_MODEL` is unset. Configure the exact installed model rather than assuming that a running Ollama server alone enables topic generation. Restart the development server if it does not pick up environment changes.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `FF_CHROME_PATH` | Path to a Chrome/Chromium executable if it is not in a standard location |
| `FF_FFMPEG_PATH` | Use a system FFmpeg instead of the bundled one |
| `FF_DATA_DIR` | Where projects, assets, datasets and exports are stored (default `./data`) |
| `FF_VOICE_URL` | Voice engine (VoiceStudio's local API, or any server with the same OpenAI-style routes); default `http://127.0.0.1:3900` |
| `FF_VOICE_API_KEY` | Only if the voice engine requires one (VoiceStudio needs none on localhost) |
| `FF_OLLAMA_URL` / `FF_OLLAMA_MODEL` | Local script and narration writer; defaults `http://127.0.0.1:11434` and `llama3.2` |
| `FF_PIXABAY_API_KEY` | Stock footage for generated shorts (free; shown on pixabay.com/api/docs when logged in) |
| `FF_PEXELS_API_KEY` | Alternative stock source. Without any stock key, use your own clips or plain backgrounds |
| `FF_DEV_LOGIN` | Set to `1` to enable the localhost-only developer login shortcut outside production |

**Voice setup and limits:** VoiceStudio runs separately; its health endpoint is `http://localhost:3900/health`. A healthy server or a ready-model status does not establish acceptable CPU synthesis speed. The current Demo Voice reference path has failed live verification as described above; do not treat it as a completed narrator-consistency fix.

**Mock services:** `npx tsx scripts/mock-voice.ts` starts stand-ins for VoiceStudio, Ollama, Pexels and Pixabay on ports 3990, 11499 and 3991. Point `FF_VOICE_URL`, `FF_OLLAMA_URL`, and `FF_PEXELS_URL`/`FF_PIXABAY_URL` at those services, use stock key `test-key`, and set `FF_OLLAMA_MODEL=llama3.2` for the default mock writer. The mock voice produces tones, not realistic speech: it is useful for timing and API tests, not for judging speaker identity or speech quality. Stock attribution is stored on video elements and shown in the inspector.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run typecheck` | Generate route types and type-check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run test:e2e` | Browser end-to-end tests against a running app (`FF_BASE_URL`, default `http://localhost:3000`) |
| `npm run eval` | Benchmark; writes `docs/EVALUATION.md` |

## Evaluation

The recorded `npm run eval` benchmark from **29 October 2026** uses seeded synthetic data (full results in [docs/EVALUATION.md](docs/EVALUATION.md)):

- **Speed:** a 50,000-row CSV was parsed in about 70 ms, profiled in about 136 ms, and turned into a full story in about 37 ms.
- **Selectivity:** editing one cell in a 10,000-row dataset refreshed 1 of 27 elements; doubling one region refreshed 9 of 27; removing a column marked 2 scenes stale instead of guessing.
- **Correctness:** in every scenario, every updated claim matched a fresh analysis of the new data, manual work was preserved, and every stored claim reproduced exactly from its recorded dataset version.

These are historical data-processing measurements, not Auto Mode generation or MP4 export timings. Timings differ between machines. The in-editor **Evaluate** panel reports evidence checks and recorded export speed for saved projects.

## Project structure

```text
src/
  app/                 Dashboard, auth, editor, render target, and API route handlers
  components/
    dashboard/         Dashboard, ocean time-of-day colours
    editor/            Canvas, timeline, inspector, dialogs (export, data story, update, evaluation)
    pixel/             Original pixel-art sprites, ocean scene, fish cursor
    render/            Scene and chart renderer shared by preview and export
  lib/
    engine/            Pure animation evaluator, snapping
    data/              CSV parsing, profiling, statistics, story generation, bindings, update engine, audit
    schema/            Versioned scene document (Zod) and factories
    server/            Auth, storage, assets, datasets, voice, script writing, stock footage, jobs, rendering, metrics
  store/               Editor state (Zustand)
tests/
  unit/                Vitest unit tests
  e2e/                 Editor/data/audio/voice/shorts tests and opt-in live Pixabay verification
scripts/eval.ts        Evaluation benchmark
docs/                  Progress log and evaluation results
public/samples/        Synthetic sample dataset
```

## Project Objectives

FrameForge aims to:

- Simplify video creation through an accessible visual workspace.
- Combine manual editing with structured video generation.
- Support reliable, data-driven animated storytelling.
- Improve transparency through evidence-linked numerical claims.
- Investigate selective content updates when source datasets change.

## Project Status

FrameForge Studio is an academic software project (B.Tech CSE minor project) with a functioning editing and data-storytelling foundation. Implemented workflows include creating projects, editing animated scenes, generating and updating evidence-linked CSV stories, and exporting MP4 files. Auto Mode is an additional integration workflow whose reliability still depends on external services and the unresolved issues above.

The latest focused narration/shorts/audio regression run passed **56 tests**; TypeScript and targeted ESLint checks also passed. This was not a fresh run of the entire test suite. Real Pixabay footage was separately verified in preview and MP4 output with voice disabled, and real Qwen topic-to-script generation succeeded. Real Demo Voice synthesis timed out, so neither that test nor mock coverage establishes a working CPU narration pipeline.

[docs/PROGRESS.md](docs/PROGRESS.md) records earlier milestones and their historical test totals. Its early storage paths and unfinished-feature lists reflect those milestones, not the complete current working tree.

## Potential for improvement

The structured project document, shared renderer, and evidence system provide a useful foundation for a more reliable video-creation tool. The next improvements should build on that foundation:

1. **Reliable CPU narration:** use a verified fixed-speaker path with predictable synthesis time, while keeping deliberate voice choices explicit.
2. **Relevant visual storytelling:** validate scene subjects and topic relevance, reject unsuitable footage, and make plain-background fallback dependable.
3. **Clear timing controls:** explain when speech must be regenerated and keep narration, captions, and scene duration synchronized after edits.
4. **Measured performance work:** profile real multi-scene projects, then optimize demonstrated bottlenecks without lowering default output quality or overloading the laptop.
5. **More capable editing and export:** explore finer audio control, reusable scene assets, and selective rendering after the current workflows are stable.
6. **Deployment and collaboration:** consider durable storage, recoverable jobs, and shared editing as later extensions.

These are development opportunities, not completed features or promised speedups. The project's potential is in combining editable video, transparent data claims, and local automation; its immediate priority is making the existing automation dependable.

## Credits

- Rendering approach inspired by [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0); FrameForge does not include HyperFrames code.
- All pixel art is original. The interface design is inspired by the playful style of Codédex, without using any of its artwork or branding.
- The sample dataset in `public/samples/` is synthetic, generated with a fixed seed.

## Vision

**Create visually. Analyze reliably. Tell stories that stay connected to their data.**

FrameForge explores a future where videos are not only visually editable, but also structured, traceable, and adaptable as the information behind them changes.
