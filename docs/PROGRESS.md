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

## Day 3 — status: done

**Pipeline** (`src/lib/data/`, all pure and deterministic):
`csv.ts` validate/parse → `profile.ts` column typing → `stats.ts` serialisable `CalcSpec` calculations → `story.ts` scene generation → `binding.ts` evidence-bound text.

| Feature | Verified by |
|---|---|
| CSV validation: 5 MB / 50k rows / 100 cols; empty, header-only and binary rejected; BOM/CRLF normalised; blank/duplicate headers renamed; ragged rows padded with a warning | unit + e2e (header-only CSV rejected in UI) |
| Column typing: numeric (handles `1,234.5`, `$12`, `45%`), strict dates, categorical, text; missing-value placeholders; id and time-column detection | unit |
| Statistics: row count, sum/mean/count/min/max, group-by, top-group share, trend with day→month→year bucketing, trend change, histogram | unit (hand-computed expected values) |
| Story generation: intro → key metric → comparison → trend *or* distribution → summary, including only scenes the data supports, with skip reasons | unit (3 dataset shapes) + e2e |
| Evidence: each claim stores dataset id, version, sha256, calculation spec, result, format and dependent scene ids | unit + e2e recomputes every claim independently from the CSV |
| No invented numbers: narrative templates contain no digits; every number is a `{n}` token filled from evidence | unit |
| Count-up animation for the key metric, computed in the pure evaluator (same in preview and export) | unit |
| Datasets tab, preview dialog (typed column chips, missing counts, 25-row table), role pickers, storyboard plan, insert as editable scenes | e2e + screenshots |
| Evidence section in the inspector (calculation, value, dataset version, linked scenes) | e2e |
| Editing bound text by hand unlinks it, with a visible note | manual |
| Generated story exports to a verified MP4 (31 s, full decode) | e2e |

**AI narration:** not enabled. No `ANTHROPIC_API_KEY` is configured, so narration uses deterministic templates, as the spec allows. Statistics never depend on an LLM.

**Sample data:** `public/samples/sample_sales_2024.csv` is **synthetic** (generated with a fixed seed) and labelled as such in the UI.

Totals: 108 unit tests, 19 browser e2e tests (Days 1–3), typecheck and lint clean.

**Next (Day 4):** dataset replacement/versioning, change detection, recompute evidence, mark affected scenes stale, regenerate data-bound content while preserving manual styling and unrelated scenes, an update report, before/after comparison, and the full Evidence Inspector panel.

## Day 4 — status: done

**Evidence-aware scene update engine** (`src/lib/data/update.ts`, pure and deterministic). When a dataset gets a new version:
1. recompute every evidence record from that dataset;
2. classify each as **unchanged / changed / broken** (the calculation can no longer run, e.g. a column was removed);
3. find dependent scenes through each record's `sceneIds` (the dependency registry);
4. refresh only data-bound content (bound text plus its cached values, bound chart data), never styling, layout, animation or unrelated scenes;
5. mark scenes **stale** with reasons when a claim they show is broken, keeping the last good value;
6. return the new project and an update report (counts and timing).

| Feature | Verified by |
|---|---|
| Versioned dataset storage; identical re-upload detected by sha256 (CRLF-insensitive); any version loadable | unit (`datasets.test.ts`) + e2e |
| Update engine: unchanged/changed/broken, selective refresh, stale marking, input never mutated, deterministic | unit (`update.test.ts`, 6 tests): refreshed claims equal a fresh analysis of the new data |
| Manual styling on bound elements preserved; hand-edited (unbound) text untouched; unrelated scenes byte-identical | unit + e2e |
| Sign-dependent wording ("On the rise" / "Losing ground") and coverage text derived from evidence, so updates keep them true | unit |
| Update review dialog: metrics, claim before → after with change badges (relative %, or percentage points for percentage claims), animated before/after wipe per scene, stale reasons | e2e + screenshots |
| Apply as one undo step | unit (`editorStore.test.ts`) + e2e |
| Story generation and preview use the dataset version the project is on, so a stored-but-not-applied version never leaks in | e2e + code review |
| Evidence Inspector tab: every claim, previous → current, calculation, hash, linked scenes; hover outlines elements on the canvas; per-claim broken detection | e2e + screenshots |
| Stale badges on timeline cards and a banner in the scene inspector | e2e |
| Export still works after updates | e2e |

**Honest limits.** Scene **content** updates selectively, but **video rendering does not**: export re-renders every frame (no segment caching). The UI says so in the update dialog.

**Bugs found in review and fixed:** percentage claims showed relative change ("▲ 49.1%") instead of percentage points ("▲ 16.8 pts"); the Evidence Inspector flagged healthy claims as broken when they shared a stale scene; the dashboard still labelled Data story as "Coming soon".

Totals: 131 unit tests, 25 browser e2e tests (Days 1–4), typecheck and lint clean.

## Day 5 — evaluation, cleanup and documentation

| Feature | Verified by |
|---|---|
| Export performance log per project (frames, resolution, render/total time, frames per second, size; last 50) | unit + a real export |
| Update history recorded in the project (claims changed/broken, elements refreshed of total, scenes preserved, plan time) | unit |
| Evaluation panel (**Evaluate** in the top bar): claim reproducibility against the recorded dataset version, evidence coverage of on-screen numbers and charts, text consistency, stale scenes, update history, export performance | unit (`audit.test.ts`) + e2e |
| Benchmark `npm run eval` → `docs/EVALUATION.md` (pipeline speed at 1k/10k/50k rows; five update scenarios with correctness, preservation and reproducibility checks; exits non-zero if any check fails) | run and reviewed |
| Housekeeping: browser tests delete the projects they create; deleting a project deletes its exported videos | unit + e2e (dashboard and `data/exports` clean after a full run) |
| README rewritten with real feature status, stack, setup, scripts, evaluation summary and structure | review |

**Fixed in review:** the benchmark first timed project construction together with the update, making updates look twice as slow as regeneration; inputs are now built before timing.

Totals: 138 unit tests, 26 browser e2e tests, typecheck and lint clean.
