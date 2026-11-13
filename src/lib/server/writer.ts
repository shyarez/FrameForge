import "server-only";
import { VoiceError } from "./voice";

/**
 * Optional narration writer using a local Ollama model. Configure with:
 *   FF_OLLAMA_URL    default http://127.0.0.1:11434
 *   FF_OLLAMA_MODEL  default llama3.2
 * It only rewrites text the scene already shows. Any number in its output that is not in the source
 * text is rejected, so the model can never introduce a statistic.
 */

export const ollamaUrl = () => (process.env.FF_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
export const ollamaModel = () => process.env.FF_OLLAMA_MODEL || "llama3.2";

export interface WriterStatus {
  connected: boolean;
  url: string;
  model: string;
  modelInstalled?: boolean;
  error?: string;
}

export async function writerStatus(): Promise<WriterStatus> {
  const url = ollamaUrl();
  const model = ollamaModel();
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return { connected: false, url, model, error: `Ollama answered ${res.status}` };
    const body = (await res.json()) as { models?: { name?: string; model?: string }[] };
    const names = (body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean) as string[];
    const installed = names.some((n) => n === model || n === `${model}:latest` || n.split(":")[0] === model);
    return { connected: true, url, model, modelInstalled: installed };
  } catch {
    return { connected: false, url, model, error: `Can't reach Ollama at ${url}` };
  }
}

/** Numbers as values (1,234.50 → "1234.5"; 12% → "12"), so formatting differences don't count as changes. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => String(Number(m[0].replace(/,/g, ""))));
}

/** Every number in `out` must appear in `source`. */
export function introducesNumbers(source: string, out: string): string[] {
  const allowed = new Set(numbersIn(source));
  return numbersIn(out).filter((n) => !allowed.has(n));
}

/** Call Ollama in JSON mode and return the parsed object. */
async function ollamaJson(system: string, prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        system,
        prompt,
        stream: false,
        // Ollama cloud models ("…:cloud") don't support structured outputs; the prompt asks for JSON and
        // the reply is parsed leniently below instead.
        ...(ollamaModel().endsWith(":cloud") ? {} : { format: "json" }),
        options: { temperature: opts.temperature ?? 0.7, num_predict: opts.maxTokens ?? 1200 },
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch {
    throw new VoiceError(`Can't reach Ollama at ${ollamaUrl()}. Install it from ollama.com and run "ollama pull ${ollamaModel()}".`, 503);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = String(body?.error ?? res.status);
    throw new VoiceError(/not found|pull/i.test(msg) ? `Ollama model "${ollamaModel()}" is not installed. Run "ollama pull ${ollamaModel()}".` : `Ollama error: ${msg}`, 502);
  }
  const text = String(((await res.json()) as { response?: string }).response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in prose; take the outermost object.
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) return JSON.parse(m[0]);
    throw new VoiceError("The model did not return valid JSON; try again", 502);
  }
}

const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[*#`_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export interface ShortPlan {
  title: string;
  scenes: { text: string; search: string }[];
}

/**
 * Write a short-video script about a topic: one narration sentence per scene plus an English stock
 * footage search term for each (the MoneyPrinterTurbo approach, in a single structured call).
 */
export async function planShort(topic: string, opts: { scenes: number; language?: string; style?: string }): Promise<ShortPlan> {
  const system = [
    "You write scripts for short vertical videos (like YouTube Shorts) narrated by a voice-over.",
    'Reply with JSON only: {"title": string, "scenes": [{"text": string, "search": string}]}.',
    "Each scene's text is ONE or two short spoken sentences (under 25 words) that flow into the next scene.",
    "Each search is 1–3 English words describing concrete, filmable stock footage for that scene (no names, no text overlays).",
    "Start with a hook and end with a short takeaway. No hashtags, emojis, stage directions or markdown.",
    "Do not state precise statistics unless they are well-known facts.",
  ].join(" ");
  const prompt = [
    `Topic: ${topic}`,
    `Number of scenes: ${opts.scenes}`,
    opts.language ? `Write the scene text in: ${opts.language} (search terms stay in English).` : "",
    opts.style ? `Tone: ${opts.style}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = (await ollamaJson(system, prompt)) as { title?: unknown; scenes?: unknown };
    const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
      .map((s: { text?: unknown; search?: unknown }) => ({ text: clean(s?.text, 400), search: clean(s?.search, 60) }))
      .filter((s) => s.text.length > 0)
      .slice(0, opts.scenes + 2);
    if (scenes.length >= Math.min(2, opts.scenes)) return { title: clean(raw?.title, 100) || topic.slice(0, 100), scenes };
  }
  throw new VoiceError("The model did not produce a usable script; try again or write the script yourself", 502);
}

/** English stock-footage search terms for each line of a user-written script. */
export async function searchTerms(lines: string[]): Promise<string[]> {
  const system = [
    'Reply with JSON only: {"terms": [string]} with exactly one entry per numbered line, in order.',
    "Each term is 1–3 English words describing concrete, filmable stock footage that fits the line.",
  ].join(" ");
  const prompt = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const raw = (await ollamaJson(system, prompt, { temperature: 0.3, maxTokens: 400 })) as { terms?: unknown };
  const terms = Array.isArray(raw?.terms) ? raw.terms.map((t) => clean(t, 60)) : [];
  return lines.map((_, i) => terms[i] ?? "");
}

const SYSTEM = [
  "You write short voice-over narration for one scene of a video.",
  "Rewrite the scene's on-screen text as natural spoken sentences.",
  "Rules: use ONLY facts and numbers that appear in the scene text; never add, round or change a number;",
  "no greetings, no markdown, no lists, no stage directions, no quotes around the answer.",
  "Write at most 3 short sentences.",
].join(" ");

export async function writeNarration(sceneText: string, opts: { style?: string; language?: string } = {}): Promise<string> {
  const prompt = [
    `Scene text:\n${sceneText}`,
    opts.style ? `Tone: ${opts.style}` : "",
    opts.language ? `Write in this language: ${opts.language}` : "",
    "Narration:",
  ]
    .filter(Boolean)
    .join("\n\n");
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: ollamaModel(), system: SYSTEM, prompt, stream: false, options: { temperature: 0.4, num_predict: 200 } }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch {
    throw new VoiceError(`Can't reach Ollama at ${ollamaUrl()}. Install it from ollama.com and run "ollama pull ${ollamaModel()}".`, 503);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = String(body?.error ?? res.status);
    throw new VoiceError(/not found|pull/i.test(msg) ? `Ollama model "${ollamaModel()}" is not installed. Run "ollama pull ${ollamaModel()}".` : `Ollama error: ${msg}`, 502);
  }
  const body = (await res.json()) as { response?: string };
  const text = String(body.response ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*#`_]/g, "")
    .replace(/^\s*(narration|voice-?over)\s*:\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  if (!text) throw new VoiceError("The model returned no text");
  const added = introducesNumbers(sceneText, text);
  if (added.length) throw new VoiceError(`The model added numbers that are not on screen (${added.slice(0, 3).join(", ")}). Use the scene text instead, or try again.`, 422);
  return text;
}
