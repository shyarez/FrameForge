import "server-only";
import { nanoid } from "nanoid";
import { alignToScript, captionCues, captionElements, type CaptionCue } from "@/lib/engine/narration";
import { keywordTerms, splitScript } from "@/lib/engine/shorts";
import { createProject, createScene, createShape, createVideo, PALETTE } from "@/lib/schema/factory";
import { CANVAS_SIZES, type AspectRatio, type Music, type Project, type Scene } from "@/lib/schema/project";
import { readAsset, saveAsset, type AssetInfo } from "./assets";
import { deleteProject, saveProject } from "./storage";
import { downloadClip, matchesOrientation, PROVIDER_NAMES, searchStock, stockProviders, stockFailure, type Orientation } from "./stock";
import { resolveNarrator, speak, transcribe, VoiceError } from "./voice";
import { planShort, searchTerms } from "./writer";

/**
 * Short-video generator, following MoneyPrinterTurbo's pipeline (script → search terms → voice →
 * captions → stock footage → music) but producing an ordinary, fully editable FrameForge project
 * instead of a flat MP4. Every scene, clip, caption and audio track can be changed afterwards.
 */

export interface ShortRequest {
  name?: string;
  /** Either a topic for the language model to write about… */
  topic?: string;
  /** …or the user's own script. */
  script?: string;
  language?: string;
  style?: string;
  /** Target number of scenes when writing from a topic. */
  scenes: number;
  aspectRatio: AspectRatio;
  /** VoiceStudio voice id, or null for no narration. */
  voice: string | null;
  speed: number;
  captions: boolean;
  /** "stock": Pixabay/Pexels clips; "mine": the uploaded clips in order (stock fills any extra scenes); "none": plain backgrounds. */
  footage: "stock" | "mine" | "none";
  /** The user's own clips for footage "mine", in scene order. */
  myClips?: Uint8Array[];
  music?: Uint8Array;
}

export type StepKey = "script" | "voice" | "captions" | "footage" | "music" | "assemble";
export type StepState = "pending" | "running" | "done" | "skipped" | "error";

export interface ShortJob {
  id: string;
  ownerId: string;
  status: "queued" | "running" | "done" | "error";
  steps: { key: StepKey; label: string; state: StepState; detail?: string }[];
  /** 0–1 across the whole run. */
  progress: number;
  projectId?: string;
  title?: string;
  warnings: string[];
  footageDiagnostics?: string[];
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

const g = globalThis as unknown as { __ffShorts?: Map<string, ShortJob>; __ffShortQueue?: Promise<void> };
const jobs = (g.__ffShorts ??= new Map());

export const getShortJob = (owner: string, id: string): ShortJob | undefined => {
  const job = jobs.get(id);
  return job && job.ownerId === owner ? job : undefined;
};

const STEP_LABELS: Record<StepKey, string> = {
  script: "Writing the script",
  voice: "Recording the voice-over",
  captions: "Timing captions",
  footage: "Finding stock footage",
  music: "Adding music",
  assemble: "Assembling the project",
};

/** Narration tail and the minimum length of a scene without narration. */
const TAIL_MS = 350;
const SILENT_MS_PER_WORD = 380;
const MIN_SCENE_MS = 1500;
const BACKGROUNDS = [PALETTE.ink, PALETTE.night, "#1b1440", "#2a0f2e", "#0c2f24", "#33210a"];

export const DEFAULT_SHORT_MUSIC: Omit<Music, "src" | "durationMs"> = { volume: 0.25, loop: true, fadeInMs: 800, fadeOutMs: 1500, duck: 0.35 };

type StockCredit = { provider: string; author: string; url: string };

const orientationOf = (a: AspectRatio): Orientation => (a === "9:16" ? "portrait" : a === "16:9" ? "landscape" : "square");

export function startShort(owner: string, req: ShortRequest): ShortJob {
  const keys: StepKey[] = ["script", "voice", "captions", "footage", "music", "assemble"];
  const job: ShortJob = {
    id: `shr_${nanoid(12)}`,
    ownerId: owner,
    status: "queued",
    steps: keys.map((key) => ({ key, label: STEP_LABELS[key], state: "pending" })),
    progress: 0,
    warnings: [],
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  const run = () => runShort(owner, req, job);
  // One generation at a time: each can run many voice syntheses and downloads.
  g.__ffShortQueue = (g.__ffShortQueue ?? Promise.resolve()).then(run, run);
  return job;
}

async function runShort(owner: string, req: ShortRequest, job: ShortJob) {
  job.status = "running";
  const step = (key: StepKey) => job.steps.find((s) => s.key === key)!;
  const begin = (key: StepKey, detail?: string) => Object.assign(step(key), { state: "running", detail });
  const finish = (key: StepKey, state: StepState = "done", detail?: string) => Object.assign(step(key), { state, ...(detail !== undefined ? { detail } : {}) });
  const warn = (message: string) => { if (!job.warnings.includes(message)) job.warnings.push(message); };
  const diagnose = (message: string) => { (job.footageDiagnostics ??= []).push(message); };
  const weights: Record<StepKey, number> = { script: 0.15, voice: 0.35, captions: 0.15, footage: 0.3, music: 0.02, assemble: 0.03 };
  const progressAt = (key: StepKey, frac: number) => {
    let acc = 0;
    for (const k of Object.keys(weights) as StepKey[]) {
      if (k === key) {
        job.progress = Math.min(1, acc + weights[k] * frac);
        return;
      }
      acc += weights[k];
    }
  };

  let project: Project | null = null;
  try {
    // 1. Script and search terms.
    begin("script");
    let title = req.name?.trim() || "";
    let lines: { text: string; search: string }[];
    if (req.script?.trim()) {
      const texts = splitScript(req.script);
      if (!texts.length) throw new VoiceError("The script is empty", 400);
      let terms: string[] = [];
      if (req.footage !== "none") {
        terms = await searchTerms(texts).catch(() => {
          job.warnings.push("Ollama is not available, so footage search terms were taken from the script's keywords.");
          return [];
        });
      }
      lines = texts.map((text, i) => ({ text, search: terms[i] || keywordTerms(text) }));
      title ||= texts[0].slice(0, 60);
    } else {
      const topic = req.topic?.trim();
      if (!topic) throw new VoiceError("Enter a topic or your own script", 400);
      const plan = await planShort(topic, { scenes: req.scenes, language: req.language, style: req.style });
      lines = plan.scenes.map((s) => ({ text: s.text, search: s.search || keywordTerms(s.text) }));
      title ||= plan.title;
    }
    job.title = title;
    finish("script", "done", `${lines.length} scenes`);
    progressAt("script", 1);

    // The project exists from here on, so generated audio and clips are stored as its assets.
    project = createProject(title.slice(0, 120) || "Short video", req.aspectRatio, "blank");
    project.exportSettings = { fps: 30, resolution: 1080 };
    await saveProject(owner, project);
    job.projectId = project.id;
    const projectId = project.id;
    const canvas = CANVAS_SIZES[req.aspectRatio];

    // 2. Voice-over, one take per scene.
    const voices: (AssetInfo | null)[] = [];
    let narrator: string | null = null;
    if (req.voice !== null) {
      begin("voice");
      narrator = await resolveNarrator(req.voice);
      for (let i = 0; i < lines.length; i++) {
        step("voice").detail = `Scene ${i + 1} of ${lines.length}`;
        const audio = await speak({ text: lines[i].text, voice: narrator, speed: req.speed, language: req.language });
        voices.push(await saveAsset(owner, projectId, audio));
        progressAt("voice", (i + 1) / lines.length);
      }
      finish("voice", "done", `${lines.length} takes`);
    } else {
      finish("voice", "skipped", "No narration");
    }

    const durations = lines.map((l, i) => {
      const v = voices[i];
      const ms = v?.durationMs ? v.durationMs + TAIL_MS : l.text.split(/\s+/).length * SILENT_MS_PER_WORD;
      return Math.min(120_000, Math.max(MIN_SCENE_MS, Math.ceil(ms / 100) * 100));
    });

    // 3. Captions: word timings from the voice engine, or spread evenly when that is unavailable.
    const cues: CaptionCue[][] = [];
    if (req.captions) {
      begin("captions");
      let estimated = 0;
      for (let i = 0; i < lines.length; i++) {
        const v = voices[i];
        let c: CaptionCue[] | null = null;
        if (v) {
          c = await transcribe(await readBytes(owner, projectId, v.name), v.name, req.language)
            .then((t) => captionCues(alignToScript(t, lines[i].text)))
            .catch(() => null);
        }
        if (!c?.length) {
          estimated++;
          const spoken = v?.durationMs ?? durations[i] - TAIL_MS;
          c = captionCues({ text: lines[i].text, segments: [{ start: 0, end: spoken / 1000, text: lines[i].text }] });
        }
        cues.push(c);
        progressAt("captions", (i + 1) / lines.length);
      }
      finish("captions", "done", estimated ? `${estimated} estimated from text` : undefined);
      if (estimated && voices.length) job.warnings.push("Some captions are timed from the script because transcription was unavailable.");
    } else {
      finish("captions", "skipped");
    }

    // 4. Footage: the user's own clips first (in order), stock footage for the rest.
    const clips: ({ asset: AssetInfo; credit?: StockCredit; trimStartMs: number } | null)[] = lines.map(() => null);
    const stockReady = stockProviders().length > 0;
    if (req.footage !== "none") {
      begin("footage");
      const own: AssetInfo[] = [];
      if (req.footage === "mine") {
        for (const [k, bytes] of (req.myClips ?? []).entries()) {
          step("footage").detail = `Your clip ${k + 1}`;
          const a = await saveAsset(owner, projectId, bytes);
          if (a.media !== "video" || !a.durationMs) throw new VoiceError(`Clip ${k + 1} is not a video`, 415);
          own.push(a);
        }
        if (!own.length) throw new VoiceError("Add at least one video clip, or choose stock footage", 400);
      }
      const used = new Set<string>();
      const minShortEdge = project.exportSettings.resolution;
      let missing = 0;
      let stockUsed = 0;
      for (let i = 0; i < lines.length; i++) {
        if (i < own.length) {
          clips[i] = { asset: own[i], trimStartMs: 0 };
          continue;
        }
        if (stockReady) {
          step("footage").detail = `“${lines[i].search}”`;
          const queries = [...new Set([lines[i].search, keywordTerms(lines[i].text), keywordTerms(title)])].filter(Boolean);
          for (const q of queries) {
            const found = await searchStock(q, { orientation: orientationOf(req.aspectRatio), minDurationMs: Math.min(durations[i], 6000), minShortEdge, onDiagnostic: (m) => {
              diagnose(`Scene ${i + 1}: ${m}`);
              if (m.includes("search:")) warn(m);
            } }).catch((e) => {
              warn(`Scene ${i + 1} stock search: ${stockFailure(e)}.`);
              if (e instanceof VoiceError && (e.status === 502 || e.status === 429)) throw e; // bad key or rate limit: stop
              return [];
            });
            for (const picked of found.filter((c) => !used.has(c.id))) {
              let bytes: Uint8Array;
              try {
                bytes = await downloadClip(picked.fileUrl);
              } catch (e) {
                warn(`Scene ${i + 1} ${PROVIDER_NAMES[picked.provider]} download: ${stockFailure(e)}.`);
                continue;
              }
              try {
                const asset = await saveAsset(owner, projectId, bytes);
                if (asset.media !== "video" || !asset.durationMs) throw new Error("Not a video");
                clips[i] = { asset, trimStartMs: 0, credit: { provider: PROVIDER_NAMES[picked.provider], author: picked.author, url: picked.pageUrl } };
                used.add(picked.id);
                stockUsed++;
                diagnose(`Scene ${i + 1}: selected ${picked.id}; validated video ${asset.width}x${asset.height}, ${asset.durationMs} ms.`);
                if (!matchesOrientation(picked.width, picked.height, orientationOf(req.aspectRatio))) warn(`Scene ${i + 1}: stock footage is cropped to fill ${req.aspectRatio} because matching footage was unavailable.`);
                break;
              } catch {
                warn(`Scene ${i + 1} ${PROVIDER_NAMES[picked.provider]} asset validation failed: clip could not be stored as a decodable video.`);
              }
            }
            if (clips[i]) break;
          }
        }
        if (!clips[i] && own.length) {
          // Out of stock options: reuse the user's clips, starting further in so repeats look different.
          const a = own[i % own.length];
          const round = Math.floor(i / own.length);
          clips[i] = { asset: a, trimStartMs: Math.max(0, Math.floor(((round * a.durationMs!) / 3) % Math.max(1, a.durationMs! - 1000))) };
        }
        if (!clips[i]) missing++;
        progressAt("footage", (i + 1) / lines.length);
      }
      const parts = [own.length ? `${Math.min(own.length, lines.length)} yours` : "", stockUsed ? `${stockUsed} stock` : ""].filter(Boolean).join(", ");
      finish("footage", "done", parts || undefined);
      if (missing) {
        job.warnings.push(
          stockReady
            ? `No suitable footage was found for ${missing} scene${missing === 1 ? "" : "s"}; they use a plain background.`
            : "Stock footage was skipped: set FF_PIXABAY_API_KEY (free at pixabay.com/api/docs) or upload your own clips.",
        );
      }
    } else {
      finish("footage", "skipped");
    }

    // 5. Music.
    if (req.music?.byteLength) {
      begin("music");
      const m = await saveAsset(owner, projectId, req.music);
      if (m.media !== "audio" || !m.durationMs) throw new VoiceError("The music file is not audio", 415);
      project.music = { ...DEFAULT_SHORT_MUSIC, src: m.ref, durationMs: m.durationMs };
      finish("music");
    } else {
      finish("music", "skipped");
    }

    // 6. Scenes.
    begin("assemble");
    project.scenes = lines.map((line, i) => {
      const scene: Scene = createScene(`Scene ${i + 1}`, {
        durationMs: durations[i],
        background: BACKGROUNDS[i % BACKGROUNDS.length],
        transition: i === 0 ? { type: "none", durationMs: 0 } : { type: "fade", durationMs: 300 },
      });
      const c = clips[i];
      if (c) {
        scene.elements.push(
          createVideo(c.asset.ref, c.asset.durationMs!, req.aspectRatio, {
            name: "Footage",
            trimStartMs: c.trimStartMs,
            ...(c.credit ? { credit: c.credit } : {}),
          }),
          // Dims the footage so white captions stay readable.
          createShape({ name: "Shade", x: 0, y: 0, width: canvas.width, height: canvas.height, radius: 0, fill: "#000000", opacity: 0.3, enter: { preset: "none", delayMs: 0, durationMs: 0, easing: "linear" } }),
        );
      }
      const v = voices[i];
      if (v?.durationMs) {
        scene.narration = {
          src: v.ref,
          durationMs: v.durationMs,
          volume: 1,
          offsetMs: 0,
          script: { text: line.text, voice: narrator ?? "default", speed: req.speed },
        };
      }
      if (cues[i]?.length) scene.elements.push(...captionElements(cues[i], scene, req.aspectRatio));
      return scene;
    });
    await saveProject(owner, project);
    finish("assemble");
    job.progress = 1;
    job.status = "done";
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    const running = job.steps.find((s) => s.state === "running");
    if (running) running.state = "error";
    // Don't leave a half-built project behind.
    if (project) await deleteProject(owner, project.id).catch(() => undefined);
    job.projectId = undefined;
    job.status = "error";
  } finally {
    job.finishedAt = Date.now();
  }
}

async function readBytes(owner: string, projectId: string, name: string): Promise<Uint8Array> {
  return new Uint8Array((await readAsset(owner, projectId, name)).data);
}
