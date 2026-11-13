import { createText } from "@/lib/schema/factory";
import { CANVAS_SIZES, type AspectRatio, type Scene, type TextElement } from "@/lib/schema/project";

/**
 * Narration scripts and timed captions, as pure functions.
 *
 * Scripts for data-story scenes are read from the scene's own on-screen text, which the evidence engine
 * keeps in sync with the data, so a voice-over never states a number the scene doesn't show.
 */

/** The scene's on-screen text in reading order (top to bottom, then left to right), excluding captions. */
export function sceneSpokenText(scene: Pick<Scene, "elements">): string {
  return scene.elements
    .filter((e): e is TextElement => e.type === "text" && e.role !== "caption" && e.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => {
      const t = e.text.replace(/\s+/g, " ").trim();
      // Separate blocks so headline, number and caption are read as distinct sentences.
      return /[.!?:;…]$/.test(t) ? t : `${t}.`;
    })
    .join(" ");
}

export type NarrationState = "none" | "manual" | "current" | "outdated";

/**
 * Whether a scene's voice-over still matches it: "outdated" when it was generated from the scene's text
 * and that text has since changed (for example after a dataset update).
 */
export function narrationState(scene: Pick<Scene, "elements" | "narration">): NarrationState {
  const n = scene.narration;
  if (!n) return "none";
  if (!n.script || n.script.fromSceneText === undefined) return "manual";
  return n.script.fromSceneText === sceneSpokenText(scene) ? "current" : "outdated";
}

export interface TimedWord {
  word: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  segments: { start: number; end: number; text: string }[];
  /** Word timings when the engine provides them. */
  words?: TimedWord[];
}

export interface CaptionCue {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

const MAX_WORDS = 4;
const MAX_CHARS = 28;
const PAUSE_SEC = 0.45;

/** Spread a segment's words across its time span, weighted by length, when the engine gives no word timings. */
function interpolateWords(seg: { start: number; end: number; text: string }): TimedWord[] {
  const words = seg.text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, seg.end - seg.start);
  let t = seg.start;
  return words.map((word, i) => {
    const d = (span * weights[i]) / total;
    const out = { word, start: t, end: t + d };
    t += d;
    return out;
  });
}

/**
 * Show the script's exact words with the engine's timings. Speech recognition can mishear or
 * mis-spell words; when it heard the same number of words as the script, the script's spelling wins.
 * Otherwise the transcript is used as heard.
 */
export function alignToScript(tr: Transcript, script: string): Transcript {
  const scriptWords = script.split(/\s+/).filter(Boolean);
  const timed = tr.words?.length ? tr.words : null;
  if (timed && timed.length === scriptWords.length) {
    return { ...tr, text: script, words: timed.map((w, i) => ({ ...w, word: scriptWords[i] })) };
  }
  if (!timed && tr.segments.length) {
    // No word timings: spread the script over the span the engine says was spoken.
    const start = tr.segments[0].start;
    const end = tr.segments[tr.segments.length - 1].end;
    if (end > start) return { text: script, segments: [{ start, end, text: script }] };
  }
  return tr;
}

/** Group words into short cues (a few words each), breaking at sentence ends and pauses. */
export function captionCues(tr: Transcript): CaptionCue[] {
  const words = tr.words?.length ? tr.words : tr.segments.flatMap(interpolateWords);
  const cues: CaptionCue[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ text: cur.map((w) => w.word.trim()).join(" "), start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const word = w.word.trim();
    if (!word) continue;
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.word.trim().length + 1, 0) + word.length;
    if (prev && (cur.length >= MAX_WORDS || len > MAX_CHARS || w.start - prev.end > PAUSE_SEC)) flush();
    cur.push({ ...w, word });
    if (/[.!?]$/.test(word)) flush();
  }
  flush();
  return cues;
}

/** Caption text elements for a scene: one per cue, popping in at its start and gone at its end. */
export function captionElements(cues: CaptionCue[], scene: Pick<Scene, "durationMs" | "narration">, aspect: AspectRatio): TextElement[] {
  const { width, height } = CANVAS_SIZES[aspect];
  const portrait = height > width;
  const fontSize = portrait ? 76 : aspect === "1:1" ? 64 : 58;
  const margin = Math.round(width * 0.08);
  const boxH = Math.round(fontSize * 1.25 * 2);
  const y = Math.round(height * (portrait ? 0.7 : 0.8) - boxH / 2);
  const offset = scene.narration?.offsetMs ?? 0;
  const out: TextElement[] = [];
  cues.forEach((cue, i) => {
    const start = Math.round(offset + cue.start * 1000);
    const nextStart = cues[i + 1] ? Math.round(offset + cues[i + 1].start * 1000) : Infinity;
    // Hold each caption until the next one (or a moment after the last word), never past the scene.
    const end = Math.min(scene.durationMs, nextStart, Math.round(offset + cue.end * 1000) + (cues[i + 1] ? 600 : 400));
    if (start >= scene.durationMs || end - start < 80) return;
    const exitMs = 60;
    out.push(
      createText({
        name: `Caption ${out.length + 1}`,
        role: "caption",
        text: cue.text,
        x: margin,
        y,
        width: width - margin * 2,
        height: boxH,
        fontSize,
        fontWeight: 800,
        fontFamily: "display",
        color: "#ffffff",
        align: "center",
        lineHeight: 1.15,
        enter: { preset: "pop", delayMs: start, durationMs: 160, easing: "backOut" },
        // Exit delay is measured back from the end of the scene.
        exit: { preset: "fade", delayMs: Math.max(0, scene.durationMs - end), durationMs: exitMs, easing: "linear" },
      }),
    );
  });
  return out;
}
