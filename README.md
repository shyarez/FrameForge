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

## Key Features

- **Visual Editor:** Interactive canvas for arranging and customizing text, images, shapes, and charts, with snapping guides, in-place text editing, duplicate/copy/paste, layers and undo/redo.
- **Scene-Based Timeline:** Organize video scenes, drag to set durations, reorder, and configure animations and transitions.
- **Editable Compositions:** Modify generated content instead of being restricted to fixed templates.
- **Data-Driven Storytelling:** Import a CSV and generate a 3–5 scene animated story (intro, key metric, comparison, trend or distribution, summary) — only the scenes the data supports.
- **Evidence-Aware Analytics:** Every generated number is produced by a stored, deterministic calculation linked to the exact dataset version and the scenes that show it.
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
- **One pure animation evaluator**, `evaluateProject(project, timeMs)`, renders both the browser preview and every exported frame, so preview and video match frame for frame.
- **MP4 export** follows the HyperFrames capture pattern (seekable page → per-frame screenshot → FFmpeg) with FrameForge's own seek contract: headless Chrome is driven by Playwright and frames are encoded by FFmpeg. No HyperFrames code is copied.
- **All statistics are deterministic JavaScript**, computed on the server from the stored CSV version. Narrative text is a template whose numbers come only from evidence, so no number is invented.

## Feature status

**Implemented and tested** (unit tests plus browser end-to-end tests that drive the real UI):

| Area | Features |
|---|---|
| Projects | Dashboard (create from template, list with hover previews, delete), autosave and Ctrl+S, reload persistence |
| Editing | Text, shapes, images, charts; drag, resize, snapping guides (Alt disables); in-place text editing; duplicate, copy/paste; layers list; undo/redo; keyboard shortcuts |
| Scenes and animation | Add, delete, duplicate, reorder scenes; drag scene duration; fade / slide / scale / pop presets with easing; enter and exit animations; fade and slide transitions |
| Assets | Image upload (type checked by file content; PNG, JPEG, GIF, WebP; SVG rejected; 8 MB limit) and an Assets tab |
| Export | H.264 MP4, 720p/1080p, 24/30 fps, three aspect ratios, progress and errors, full-decode verification, download; uploaded images verified to appear in the video |
| Data | CSV validation and preview; column typing (numeric, date, categorical, text); missing values; count, sum, mean, min, max, group-by, top share, trend (with date bucketing), trend change, histogram |
| Data stories | Storyboard plan with reasons for skipped scenes; evidence-linked claims; count-up numbers; Evidence section in the inspector |
| Evidence-aware updates | Dataset versioning (identical uploads detected); update review with before/after comparison; selective refresh; stale scenes; apply as one undo step; Evidence Inspector with canvas highlighting |
| Evaluation | Evaluation panel; per-export performance log; update history; benchmark script |
| Interface | Original pixel-art ocean theme; light and dark modes; dashboard colours follow the time of day (dawn, day, sunset, night); WCAG AA contrast tested for every colour combination |

**Not implemented:**

- **AI narration** — no LLM is configured; story wording uses deterministic templates. Statistics would never depend on an LLM.
- **Selective video re-rendering** — every export renders all frames.
- **User accounts** — out of scope for this prototype; all projects are local to the machine.
- Cloud deployment, audio, keyframe curves and real-time collaboration (out of scope).

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

Open http://localhost:3000. Try the **Data** tab → *Try the synthetic sample* to generate a data story in under a minute.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `FF_CHROME_PATH` | Path to a Chrome/Chromium executable if it is not in a standard location |
| `FF_FFMPEG_PATH` | Use a system FFmpeg instead of the bundled one |
| `FF_DATA_DIR` | Where projects, assets, datasets and exports are stored (default `./data`) |

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

Measured with `npm run eval` on seeded synthetic data (full results in [docs/EVALUATION.md](docs/EVALUATION.md)):

- **Speed:** a 50,000-row CSV is parsed in about 90 ms, profiled in about 150 ms, and turned into a full story in about 35 ms.
- **Selectivity:** editing one cell in a 10,000-row dataset refreshed 1 of 27 elements; doubling one region refreshed 9 of 27; removing a column marked 2 scenes stale instead of guessing.
- **Correctness:** in every scenario, every updated claim matched a fresh analysis of the new data, manual work was preserved, and every stored claim reproduced exactly from its recorded dataset version.

Timings differ between machines. The in-editor **Evaluate** panel reports the same checks for any saved project, plus measured export speed.

## Project structure

```text
src/
  app/                 Pages (dashboard, editor, render target) and API route handlers
  components/
    dashboard/         Dashboard, ocean time-of-day colours
    editor/            Canvas, timeline, inspector, dialogs (export, data story, update, evaluation)
    pixel/             Original pixel-art sprites, ocean scene, fish cursor
    render/            Scene and chart renderer shared by preview and export
  lib/
    engine/            Pure animation evaluator, snapping
    data/              CSV parsing, profiling, statistics, story generation, bindings, update engine, audit
    schema/            Versioned scene document (Zod) and factories
    server/            Storage, assets, datasets, export jobs, rendering, metrics
  store/               Editor state (Zustand)
tests/
  unit/                Vitest unit tests
  e2e/                 Browser end-to-end tests (Days 1–4)
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

FrameForge Studio is an academic software project (B.Tech CSE minor project). The full workflow works end to end: create a project → edit animated scenes → import a CSV → generate an editable data story → update the dataset → refresh only the affected scenes → export an MP4.

The test suite has 138 unit tests and 26 browser end-to-end tests. The day-by-day build log, including bugs found and fixed, is in [docs/PROGRESS.md](docs/PROGRESS.md).

## Credits

- Rendering approach inspired by [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0); FrameForge does not include HyperFrames code.
- All pixel art is original. The interface design is inspired by the playful style of Codédex, without using any of its artwork or branding.
- The sample dataset in `public/samples/` is synthetic, generated with a fixed seed.

## Vision

**Create visually. Analyze reliably. Tell stories that stay connected to their data.**

FrameForge explores a future where videos are not only visually editable, but also structured, traceable, and adaptable as the information behind them changes.
