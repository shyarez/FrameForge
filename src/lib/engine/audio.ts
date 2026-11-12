import { projectDurationMs, type Project } from "@/lib/schema/project";
import { sceneStartTimes } from "./evaluate";

/**
 * Audio timing, as pure functions of the project document. The browser preview and the MP4 exporter
 * both use this plan, so what you hear in the editor is what ends up in the file.
 */

/** Music fades in/out of ducking over this long instead of jumping. */
export const DUCK_RAMP_MS = 250;

export interface NarrationClip {
  sceneId: string;
  src: string;
  /** Project time the clip starts and stops playing. */
  startMs: number;
  endMs: number;
  volume: number;
}

export interface MusicPlan {
  src: string;
  durationMs: number;
  volume: number;
  loop: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  duck: number;
}

export interface AudioPlan {
  totalMs: number;
  narration: NarrationClip[];
  music: MusicPlan | null;
  /** Merged project-time ranges where narration plays (used for ducking). */
  speech: [number, number][];
}

/** Merge ranges that overlap or sit closer than `gap` ms, so ducking never dips twice in a row. */
export function mergeRanges(ranges: [number, number][], gap = 0): [number, number][] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function audioPlan(project: Pick<Project, "scenes" | "music">): AudioPlan {
  const totalMs = projectDurationMs(project);
  const starts = sceneStartTimes(project);
  const narration: NarrationClip[] = [];
  project.scenes.forEach((scene, i) => {
    const n = scene.narration;
    if (!n) return;
    const startMs = starts[i] + n.offsetMs;
    // A voice-over never runs into the next scene: it is cut where its scene ends.
    const endMs = Math.min(startMs + n.durationMs, starts[i] + scene.durationMs);
    if (endMs <= startMs || n.volume <= 0) return;
    narration.push({ sceneId: scene.id, src: n.src, startMs, endMs, volume: n.volume });
  });
  const m = project.music;
  const music = m && m.volume > 0 ? { src: m.src, durationMs: m.durationMs, volume: m.volume, loop: m.loop, fadeInMs: m.fadeInMs, fadeOutMs: m.fadeOutMs, duck: m.duck } : null;
  return { totalMs, narration, music, speech: mergeRanges(narration.map((c) => [c.startMs, c.endMs]), DUCK_RAMP_MS * 2) };
}

export const hasAudio = (plan: AudioPlan) => plan.narration.length > 0 || plan.music !== null;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Ducking multiplier at time t: `duck` inside speech, ramping linearly over DUCK_RAMP_MS on either side. */
export function duckFactor(speech: [number, number][], duck: number, t: number): number {
  let depth = 0;
  for (const [a, b] of speech) {
    const d = clamp01(Math.min((t - (a - DUCK_RAMP_MS)) / DUCK_RAMP_MS, (b + DUCK_RAMP_MS - t) / DUCK_RAMP_MS));
    depth = Math.max(depth, d);
  }
  return 1 - (1 - duck) * depth;
}

/** Music gain (0–1) at project time t, including fades and ducking. */
export function musicGainAt(plan: AudioPlan, t: number): number {
  const m = plan.music;
  if (!m || t < 0 || t >= plan.totalMs) return 0;
  if (!m.loop && t >= m.durationMs) return 0;
  const end = m.loop ? plan.totalMs : Math.min(plan.totalMs, m.durationMs);
  const fadeIn = m.fadeInMs > 0 ? clamp01(t / m.fadeInMs) : 1;
  const fadeOut = m.fadeOutMs > 0 ? clamp01((end - t) / m.fadeOutMs) : 1;
  return m.volume * fadeIn * fadeOut * duckFactor(plan.speech, m.duck, t);
}

/** Position (ms) inside the music file at project time t. */
export function musicPositionMs(plan: AudioPlan, t: number): number {
  const m = plan.music;
  if (!m) return 0;
  return m.loop ? t % m.durationMs : Math.min(t, m.durationMs);
}

const sec = (ms: number) => (Math.round(ms) / 1000).toFixed(3);

/**
 * FFmpeg filtergraph that mixes the plan into one stereo track of exactly totalMs.
 * Input 0 is the video, input 1 a silent bed of the full length; narration clips follow in plan
 * order, then the music (opened with -stream_loop -1 when looping).
 */
export function buildAudioFilter(plan: AudioPlan): { filter: string; inputs: { src: string; loop: boolean }[] } {
  const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  const inputs: { src: string; loop: boolean }[] = [];
  const parts: string[] = [`[1:a]${fmt}[bed]`];
  const labels = ["[bed]"];
  plan.narration.forEach((c, k) => {
    const idx = 2 + inputs.length;
    inputs.push({ src: c.src, loop: false });
    const delay = Math.round(c.startMs);
    parts.push(
      `[${idx}:a]${fmt},atrim=0:${sec(c.endMs - c.startMs)},asetpts=PTS-STARTPTS,volume=${c.volume.toFixed(3)},adelay=${delay}|${delay}[n${k}]`,
    );
    labels.push(`[n${k}]`);
  });
  if (plan.music) {
    const m = plan.music;
    const idx = 2 + inputs.length;
    inputs.push({ src: m.src, loop: m.loop });
    const playMs = m.loop ? plan.totalMs : Math.min(plan.totalMs, m.durationMs);
    const chain = [fmt, `atrim=0:${sec(playMs)}`, "asetpts=PTS-STARTPTS"];
    // Same gain curve as musicGainAt: base volume × fades × ducking.
    const terms = [m.volume.toFixed(3)];
    if (m.fadeInMs > 0) terms.push(`min(1,t/${sec(m.fadeInMs)})`);
    if (m.fadeOutMs > 0) terms.push(`max(0,min(1,(${sec(playMs)}-t)/${sec(m.fadeOutMs)}))`);
    if (m.duck < 1 && plan.speech.length) {
      const r = sec(DUCK_RAMP_MS);
      const dips = plan.speech.map(([a, b]) => `max(0,min(1,min((t-${sec(a - DUCK_RAMP_MS)})/${r},(${sec(b + DUCK_RAMP_MS)}-t)/${r})))`);
      // Speech ranges are merged with a gap of two ramps, so at most one dip is non-zero at any time.
      terms.push(`(1-${(1 - m.duck).toFixed(3)}*(${dips.join("+")}))`);
    }
    chain.push(`volume='${terms.join("*")}':eval=frame`);
    parts.push(`[${idx}:a]${chain.join(",")}[mus]`);
    labels.push("[mus]");
  }
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,atrim=0:${sec(plan.totalMs)}[aout]`);
  return { filter: parts.join(";"), inputs };
}
