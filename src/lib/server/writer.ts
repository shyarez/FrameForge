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
