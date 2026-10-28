# FrameForge Studio — Progress Log

## Architecture decisions

- **HyperFrames (Apache-2.0)** was inspected. Its engine captures a *seekable* HTML page frame-by-frame in headless Chrome and pipes frames to FFmpeg. We reuse that **pattern**, not its code: HyperFrames is a Bun monorepo built around GSAP-timeline HTML compositions, while FrameForge uses a JSON scene document with a pure evaluator.
- **One evaluator, two consumers.** `evaluateProject(project, timeMs)` (`src/lib/engine/evaluate.ts`) is pure. The editor preview and the `/render` export page both mount the same `<SceneView>` from its output.
- **Export contract.** `/render` exposes `window.__ffInit(project, w, h)` and `window.__ffSeek(ms)`. Playwright drives the system Chrome, takes a JPEG per frame, and pipes it to `ffmpeg-static` (libx264, yuv420p, faststart). Each output is then fully decoded to verify it.
- **Storage.** `data/projects/<id>.json`. IDs are regex-validated, every resolved path is checked to stay inside `data/`, writes are atomic (tmp + rename), and documents are validated with Zod on every read and write. Client-supplied paths are never accepted.
- **Undo/redo** is a custom snapshot stack. A whole drag is one undo step (`beginGesture`/`endGesture`).

## Day 1 — status: acceptance criteria met

| Feature | Status | Verified by |
|---|---|---|
| Next.js 16 + TS + Tailwind 4 scaffold | ✅ | typecheck, lint |
| Versioned scene schema (Zod) | ✅ | unit tests |
| Pure evaluator + presets (fade, slide-up, slide-left, scale, pop) + exit anims | ✅ | unit tests |
| Scene transitions (none / fade / slide) | ✅ | unit tests + frames extracted from MP4 |
| Local JSON persistence (CRUD API) | ✅ | e2e (save → reload) |
| Dashboard (create / list / delete, live hover previews) | ✅ | e2e |
| Editor shell (top bar, left panel, canvas, inspector, timeline, playback) | ✅ | e2e + screenshot |
| Select / drag / resize, undo/redo, autosave, Ctrl+S, shortcuts | ✅ | e2e (drag + undo/redo) |
| Scene add / duplicate / delete / reorder | ✅ | e2e (add/delete) |
| Charts (bar / line / donut) with animated reveal | ✅ | frames extracted from MP4 |
| Real MP4 export with progress, errors, verification | ✅ | API + UI e2e; 16:9 and 9:16 |

Measured: 8 s at 720p30 (240 frames) rendered in ~29 s; 12 s (360 frames) in 26.8 s; 9:16 8 s in 18.8 s.

## Not built yet (honest list)

- Image upload / Assets tab (schema supports `asset:` refs; upload route not built)
- Inline text editing on canvas (edited via the inspector for now)
- CSV import, statistics, story generation, evidence registry, dataset update engine (Days 3–4)
- Segment caching / selective re-rendering: **not implemented**. All exports are full renders.

## Commands

```
npm run dev                      # app
npm run typecheck                # next typegen + tsc
npm test                         # unit tests
FF_BASE_URL=http://localhost:3000 npm run test:e2e   # browser e2e (app must be running)
```

Env overrides: `FF_CHROME_PATH`, `FF_FFMPEG_PATH`, `FF_DATA_DIR`.
