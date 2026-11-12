/**
 * Stand-in for VoiceStudio's local API and Ollama, for tests and for developing without either installed.
 *
 *   npx tsx scripts/mock-voice.ts            # VoiceStudio mock on :3990, Ollama mock on :11499
 *   FF_VOICE_URL=http://127.0.0.1:3990 FF_OLLAMA_URL=http://127.0.0.1:11499 npm run dev
 *
 * Speech is a quiet tone (0.3 s per word at 1× speed) and transcription returns exact word timings for
 * audio this mock generated, so captions can be checked precisely. It implements only the routes
 * FrameForge uses, with the request and response shapes documented for VoiceStudio and Ollama.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const SEC_PER_WORD = 0.3;
const RATE = 16_000;

export function wavTone(seconds: number, freq = 330): Buffer {
  const n = Math.max(1, Math.round(seconds * RATE));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 8000), 44 + i * 2);
  return buf;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const send = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

export interface MockVoice {
  url: string;
  server: Server;
  /** Requests received, for assertions. */
  log: { method: string; path: string; json?: unknown }[];
  close(): Promise<void>;
}

/** Find the first file part in a multipart body (enough for tests; not a general parser). */
function firstFilePart(raw: Buffer, contentType: string): Buffer | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;
  const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = raw.indexOf(sep);
  while (at >= 0) {
    const next = raw.indexOf(sep, at + sep.length);
    if (next < 0) break;
    const part = raw.subarray(at + sep.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd > 0 && /filename=/.test(part.subarray(0, headerEnd).toString())) return part.subarray(headerEnd + 4);
    at = next;
  }
  return null;
}

export async function startMockVoice(port = 0): Promise<MockVoice> {
  const spoken = new Map<string, { words: string[]; speed: number }>();
  const profiles: { id: string; name: string }[] = [];
  const log: MockVoice["log"] = [];
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const raw = await body(req);
    const isJson = (req.headers["content-type"] ?? "").includes("json");
    const json = isJson && raw.length ? JSON.parse(raw.toString()) : undefined;
    log.push({ method: req.method ?? "GET", path, json });

    if (path === "/health") return send(res, 200, { status: "ok", device: "mock", version: "mock-1" });
    if (path === "/setup/status") return send(res, 200, { models_ready: true, missing: [] });
    if (path === "/v1/audio/voices") return send(res, 200, { voices: [{ id: "default", name: "Default" }, { id: "nova", name: "Nova", language: "en" }] });
    if (path === "/profiles" && req.method === "GET") return send(res, 200, profiles);
    if (path === "/profiles" && req.method === "POST") {
      if (!firstFilePart(raw, req.headers["content-type"] ?? "")) return send(res, 400, { detail: "ref_audio required" });
      const name = /name="name"\r\n\r\n([^\r]*)/.exec(raw.toString("latin1"))?.[1] ?? "Voice";
      const p = { id: `prof_${profiles.length + 1}`, name };
      profiles.push(p);
      return send(res, 200, p);
    }
    if (path === "/v1/audio/speech" && req.method === "POST") {
      const input = String(json?.input ?? "").trim();
      if (!input) return send(res, 422, { detail: "input is required" });
      if (json?.voice === "broken") return send(res, 500, { detail: "engine crashed" });
      const words = input.split(/\s+/);
      const speed = Number(json?.speed ?? 1);
      const wav = wavTone((words.length * SEC_PER_WORD) / speed);
      spoken.set(createHash("sha256").update(wav).digest("hex"), { words, speed });
      res.writeHead(200, { "content-type": "audio/wav" });
      return res.end(wav);
    }
    if (path === "/v1/audio/transcriptions" && req.method === "POST") {
      const file = firstFilePart(raw, req.headers["content-type"] ?? "");
      const hit = file && spoken.get(createHash("sha256").update(file).digest("hex"));
      if (!hit) return send(res, 200, { text: "", segments: [] });
      const step = SEC_PER_WORD / hit.speed;
      const words = hit.words.map((word, i) => ({ word, start: +(i * step).toFixed(3), end: +((i + 1) * step - 0.05).toFixed(3) }));
      return send(res, 200, {
        text: hit.words.join(" "),
        segments: [{ start: 0, end: words[words.length - 1].end, text: hit.words.join(" ") }],
        words,
      });
    }
    send(res, 404, { detail: "Not Found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, server, log, close: () => new Promise((r) => server.close(() => r())) };
}

/** Ollama: /api/tags and a deterministic /api/generate that echoes the scene text as narration. */
export async function startMockOllama(port = 0, model = "llama3.2"): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const raw = await body(req);
    if (path === "/api/tags") return send(res, 200, { models: [{ name: `${model}:latest`, model: `${model}:latest` }] });
    if (path === "/api/generate" && req.method === "POST") {
      const { prompt } = JSON.parse(raw.toString());
      const scene = /Scene text:\n([\s\S]*?)\n\n/.exec(String(prompt))?.[1] ?? "";
      // A prompt containing "INVENT" makes the mock add a number, to exercise the guard.
      const response = /INVENT/.test(scene) ? "Sales grew 999 percent." : `Here is the picture. ${scene}`;
      return send(res, 200, { model, response, done: true });
    }
    send(res, 404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise((r) => server.close(() => r())) };
}

if (process.argv[1] && /mock-voice\.ts$/.test(process.argv[1])) {
  void (async () => {
    const voice = await startMockVoice(Number(process.env.MOCK_VOICE_PORT ?? 3990));
    const ollama = await startMockOllama(Number(process.env.MOCK_OLLAMA_PORT ?? 11499));
    console.log(`Mock VoiceStudio: ${voice.url}\nMock Ollama:      ${ollama.url}`);
  })();
}
