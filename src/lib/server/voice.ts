import "server-only";
import type { Transcript, TimedWord } from "@/lib/engine/narration";

/**
 * Voice engine client. The default is VoiceStudio's local API (OpenAI-compatible, port 3900); any server
 * that speaks the same routes works. Configure with:
 *   FF_VOICE_URL      base URL (default http://127.0.0.1:3900)
 *   FF_VOICE_API_KEY  only if the engine requires one (VoiceStudio needs none on localhost)
 * Audio never leaves this machine unless FF_VOICE_URL points elsewhere.
 */

export class VoiceError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface VoiceStatus {
  connected: boolean;
  url: string;
  version?: string;
  device?: string;
  modelsReady?: boolean;
  missing?: string[];
  error?: string;
}

export interface Voice {
  id: string;
  name: string;
  /** "preset" ships with the engine; "profile" is a cloned or designed voice. */
  kind: "preset" | "profile";
  language?: string;
}

export const voiceUrl = () => (process.env.FF_VOICE_URL || "http://127.0.0.1:3900").replace(/\/+$/, "");

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (process.env.FF_VOICE_API_KEY) headers.set("authorization", `Bearer ${process.env.FF_VOICE_API_KEY}`);
  let res: Response;
  try {
    res = await fetch(`${voiceUrl()}${path}`, { ...init, headers, signal: AbortSignal.timeout(init.timeoutMs ?? 15_000), cache: "no-store" });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    throw new VoiceError(timeout ? "The voice engine took too long to answer" : `Can't reach the voice engine at ${voiceUrl()}. Is VoiceStudio running?`, timeout ? 504 : 503);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      detail = String(j?.error?.message ?? j?.error ?? j?.detail ?? j?.message ?? detail);
    } catch {
      // Not JSON; keep the text.
    }
    throw new VoiceError(`Voice engine error (${res.status})${detail ? `: ${detail}` : ""}`, res.status === 404 ? 501 : 502);
  }
  return res;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

export async function voiceStatus(): Promise<VoiceStatus> {
  const url = voiceUrl();
  try {
    const health = await (await call("/health", { timeoutMs: 4000 })).json().catch(() => ({}));
    const status: VoiceStatus = { connected: true, url, version: str(health?.version), device: str(health?.device) };
    // Model readiness is a VoiceStudio extension; other engines simply don't report it.
    const setup = await call("/setup/status", { timeoutMs: 4000 }).then((r) => r.json(), () => null);
    if (setup && typeof setup.models_ready === "boolean") {
      status.modelsReady = setup.models_ready;
      if (Array.isArray(setup.missing)) status.missing = setup.missing.map(String).slice(0, 10);
    }
    return status;
  } catch (err) {
    return { connected: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Accept the common shapes: [...], {voices:[...]}, {data:[...]}, {profiles:[...]}; items as strings or objects. */
function parseVoices(body: unknown, kind: Voice["kind"]): Voice[] {
  const b = body as Record<string, unknown> | unknown[];
  const list = Array.isArray(b) ? b : ((b?.voices ?? b?.data ?? b?.profiles ?? b?.items ?? []) as unknown[]);
  if (!Array.isArray(list)) return [];
  const out: Voice[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ id: item, name: item, kind });
      continue;
    }
    const o = item as Record<string, unknown>;
    const id = str(o?.id) ?? str(o?.voice_id) ?? str(o?.profile_id) ?? str(o?.name);
    if (!id) continue;
    out.push({ id, name: str(o.name) ?? str(o.display_name) ?? id, kind, language: str(o.language) });
  }
  return out;
}

export async function listVoices(): Promise<Voice[]> {
  const presets = await call("/v1/audio/voices").then((r) => r.json()).then((b) => parseVoices(b, "preset"), () => [] as Voice[]);
  // Cloned and designed voices (VoiceStudio profiles).
  const profiles = await call("/profiles").then((r) => r.json()).then((b) => parseVoices(b, "profile"), () => [] as Voice[]);
  const seen = new Set<string>();
  const all = [...profiles, ...presets].filter((v) => !seen.has(v.id) && seen.add(v.id));
  if (!all.some((v) => v.id === "default")) all.unshift({ id: "default", name: "Default", kind: "preset" });
  return all;
}

/** Resolve once per Auto Mode job. VoiceStudio's OpenAI aliases do not identify a speaker. */
export async function resolveNarrator(selected: string): Promise<string> {
  const catalog = await call("/v1/audio/voices").then((r) => r.json());
  const profilesBody = await call("/profiles").then((r) => r.json());
  const profiles = parseVoices(profilesBody, "profile");
  // An exact profile id wins, matching VoiceStudio's own resolution rules.
  const exact = profiles.find((p) => p.id === selected);
  if (exact) return exact.id;
  const key = selected.trim().toLowerCase();
  const entries = Array.isArray(catalog) ? catalog : catalog.voices ?? catalog.data ?? [];
  const aliases = entries.filter((v: { type?: string }) => v?.type === "openai_alias");
  const isAlias = aliases.some((v: { id?: string; voice_id?: string }) => (v.id ?? v.voice_id)?.toLowerCase() === key);
  if (isAlias || (key === "default" && aliases.length > 0)) {
    const demo = profiles.find((p) => p.id === "demo0001");
    if (!demo) throw new VoiceError("A fixed narrator is required: the Demo Voice profile is unavailable. Select an existing voice profile.", 422);
    return demo.id;
  }
  const named = profiles.filter((p) => p.name.trim().toLowerCase() === key);
  if (named.length > 1) throw new VoiceError("Several voice profiles have this name. Select a profile by its id.", 422);
  return named[0]?.id ?? selected;
}

export interface SpeakRequest {
  text: string;
  voice: string;
  speed: number;
  language?: string;
  /** Natural-language voice description (voice design; only some engines support it). */
  description?: string;
}

/** Synthesize speech. Returns WAV bytes (lossless, so the export mix is the only lossy step). */
export async function speak(req: SpeakRequest): Promise<Uint8Array> {
  const body: Record<string, unknown> = { input: req.text, voice: req.voice || "default", speed: req.speed, response_format: "wav" };
  if (req.language) body.language = req.language;
  if (req.description) body.description = req.description;
  const res = await call("/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // Synthesis on CPU can be slow for long scripts.
    timeoutMs: 5 * 60_000,
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json") || type.startsWith("text/")) throw new VoiceError("The voice engine returned text instead of audio");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new VoiceError("The voice engine returned no audio");
  if (buf.byteLength > MAX_AUDIO_BYTES) throw new VoiceError("The generated audio is larger than 25 MB; shorten the script", 413);
  return buf;
}

/** Create a cloned voice from a short sample (VoiceStudio profile). */
export async function cloneVoice(name: string, sample: Uint8Array, fileName: string, refText?: string): Promise<Voice> {
  const form = new FormData();
  form.append("name", name);
  form.append("kind", "clone");
  form.append("ref_audio", new Blob([new Uint8Array(sample)]), fileName);
  if (refText) form.append("ref_text", refText);
  const res = await call("/profiles", { method: "POST", body: form, timeoutMs: 5 * 60_000 });
  const body = await res.json().catch(() => ({}));
  const [voice] = parseVoices([body?.profile ?? body], "profile");
  if (!voice) throw new VoiceError("The voice engine did not return the new voice");
  return { ...voice, name: voice.name === voice.id ? name : voice.name };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);

/** Normalize OpenAI verbose_json or VoiceStudio /transcribe output. */
export function parseTranscript(body: unknown): Transcript {
  const b = (body ?? {}) as Record<string, unknown>;
  const segments = (Array.isArray(b.segments) ? b.segments : [])
    .map((s: Record<string, unknown>) => ({ start: num(s.start), end: num(s.end), text: String(s.text ?? "").trim() }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start && s.text);
  const rawWords: unknown[] = Array.isArray(b.words)
    ? b.words
    : (Array.isArray(b.segments) ? b.segments : []).flatMap((s: Record<string, unknown>) => (Array.isArray(s.words) ? s.words : []));
  const words: TimedWord[] = rawWords
    .map((w) => w as Record<string, unknown>)
    .map((w) => ({ word: String(w.word ?? w.text ?? "").trim(), start: num(w.start), end: num(w.end) }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  const text = String(b.text ?? b.refined_text ?? segments.map((s) => s.text).join(" ")).trim();
  return { text, segments, ...(words.length ? { words } : {}) };
}

/** Transcribe audio with timings. Tries the OpenAI route with word timestamps, then VoiceStudio's aligned route. */
export async function transcribe(audio: Uint8Array, fileName: string, language?: string): Promise<Transcript> {
  const openai = new FormData();
  openai.append("file", new Blob([new Uint8Array(audio)]), fileName);
  openai.append("response_format", "verbose_json");
  openai.append("timestamp_granularities[]", "word");
  openai.append("timestamp_granularities[]", "segment");
  if (language) openai.append("language", language);
  let tr: Transcript | null = null;
  let firstError: unknown = null;
  try {
    tr = parseTranscript(await (await call("/v1/audio/transcriptions", { method: "POST", body: openai, timeoutMs: 5 * 60_000 })).json());
  } catch (err) {
    firstError = err;
  }
  if (tr?.words?.length) return tr;
  // VoiceStudio's native route does forced alignment ("accurate" mode) for tighter timings.
  try {
    const native = new FormData();
    native.append("audio", new Blob([new Uint8Array(audio)]), fileName);
    native.append("mode", "accurate");
    if (language) native.append("language", language);
    const alt = parseTranscript(await (await call("/transcribe", { method: "POST", body: native, timeoutMs: 5 * 60_000 })).json());
    if (alt.words?.length || (alt.segments.length && !tr?.segments.length)) return alt;
  } catch {
    // Fall back to whatever the first route gave.
  }
  if (tr && tr.segments.length) return tr;
  throw firstError instanceof Error ? firstError : new VoiceError("The voice engine returned no timed transcript");
}
