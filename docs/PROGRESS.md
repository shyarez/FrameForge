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

## UI refresh — pixel theme (ocean palette)

- Design language studied from the Codédex reference (pixel display type, layered pixel landscape, yellow arcade buttons, bordered cards). All artwork is **original**: no Codédex logos, characters or illustrations are used.
- Fonts (Google Fonts, OFL): Pixelify Sans (headings), Press Start 2P (labels and chips), Mulish (body).
- `src/components/pixel/`: sprite system (`sprites.ts` grids → crisp SVG via `Sprite.tsx`), procedural `PixelOcean` hero (seeded, with parallax, two-frame swaying seagrass and kelp, coral, rising bubbles, schools of fish in both directions, jellyfish, light rays, and a sunken TV playing a looping chart); `FishCursor` pixel-fish cursors.
- Pixel UI kit in `globals.css`: `.px-box` notched borders, `.px-btn` bevelled press buttons, `.px-range` scrubber, stepped keyframes. All animation respects `prefers-reduced-motion`.
- Dashboard: hero, quest map (Data story is honestly marked "Coming soon"), save-file project cards with hover playback, template cards.
- Editor: same layout and density, with the pixel styling applied; export dialog has a spinning reel sprite and a segmented progress bar.
- New video text fonts: `pixel` and `arcade` (schema enum extended; existing projects remain valid).
- Verified: typecheck and lint clean; 23 unit tests (sprite grid validation added); 6/6 browser e2e tests pass, including a real UI export.

## Themes — light/dark + time-of-day ocean

- **Light/dark theme** for the whole app (`src/components/theme/`). It defaults to the system preference, a toggle in the dashboard nav and editor top bar overrides it, and the choice persists in localStorage. An inline boot script sets `data-theme` before first paint, so there is no flash. Colours are role tokens (`*-ink` accent text, `onaccent`, `edge`, `shadow`, `grid`), so both themes share all components.
- **Contrast is tested**: `tests/unit/themeContrast.test.ts` parses both theme blocks from `globals.css` and asserts WCAG AA (≥ 4.5:1) for 16 text/background pairs per theme.
- **Time-of-day ocean** (dashboard hero only, always in dark scope): `oceanPhases.ts` defines dawn / day / sunset / night palettes keyframed by local hour and blends every colour between neighbouring phases. Night adds jellyfish halos, glowing plankton and moonlight on the surface; rays fade out. A hero button cycles Auto → Dawn → Day → Sunset → Night for demos, with CSS colour transitions. The editor workspace deliberately does not change with time.

## Day 2 — status: done

| Feature | Verified by |
|---|---|
| Image upload API (`/api/projects/[id]/assets`): type detected from magic bytes (PNG/JPEG/GIF/WebP), SVG rejected, 8 MB limit, server-generated names, path-safe | unit (`assets.test.ts`) + e2e (fake `.png` rejected) |
| Assets tab: click/drag-drop upload, thumbnails, add to scene at the image's true aspect ratio, delete (warns if in use) | e2e |
| Image inspector: swap source, fit (cover/contain), corner radius | manual + screenshot |
| Uploaded images render in exported MP4 | e2e samples the last video frame and finds the image's magenta pixels |
| Inline text editing (double-click; Ctrl+Enter or blur commits, Esc cancels) | e2e |
| Snapping to canvas edges/centre and other elements, with guides; Alt disables | unit (`snap.test.ts`) + e2e |
| Duplicate (Ctrl+D / button), copy/paste (Ctrl+C/V) with fresh ids | unit (`editorStore.test.ts`) + e2e |
| Layers list in scene inspector | manual + screenshot |
| Drag a scene's right edge to change duration (100 ms steps, one undo step) | e2e (4.0 s → 5.0 s) |

**Bug found and fixed:** on a blank scene the playhead sat at 0 ms, so newly added elements were selected but invisible (before their entrance animation). Adding, pasting, duplicating or re-animating an element now moves the playhead to the scene's rest pose. A regression test covers it.

Totals: 80 unit tests, 13 browser e2e tests (Day 1 + Day 2), typecheck and lint clean.

**Next (Day 3):** CSV import and preview, column typing and missing values, deterministic statistics, animated chart scenes, editable story generation.
