import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElement } from "@/lib/engine/evaluate";
import { captionCues, captionElements, narrationState, sceneSpokenText } from "@/lib/engine/narration";
import { createScene, createShape, createText } from "@/lib/schema/factory";
import type { Scene } from "@/lib/schema/project";
import { cloneVoice, listVoices, parseTranscript, speak, transcribe, voiceStatus } from "@/lib/server/voice";
import { introducesNumbers, writeNarration, writerStatus } from "@/lib/server/writer";
import { SEC_PER_WORD, startMockOllama, startMockVoice, type MockVoice } from "../../scripts/mock-voice";

const storyScene = (): Scene =>
  createScene("Metric", {
    elements: [
      createText({ name: "Number", text: "$1,234,500", y: 400 }),
      createText({ name: "Title", text: "Total revenue", y: 100 }),
      createShape(),
      createText({ name: "Note", text: "Up 12% on last year", y: 700 }),
    ],
  });

describe("narration script", () => {
  it("reads on-screen text top to bottom as sentences, skipping captions", () => {
    const s = storyScene();
    s.elements.push(createText({ role: "caption", text: "old caption", y: 0 }));
    expect(sceneSpokenText(s)).toBe("Total revenue. $1,234,500. Up 12% on last year.");
  });

  it("reports a generated voice-over as outdated when the scene text changes", () => {
    const s = storyScene();
    expect(narrationState(s)).toBe("none");
    s.narration = { src: "asset:aud_abcdefghijkl.wav", durationMs: 3000, volume: 1, offsetMs: 0, script: { text: "x", voice: "default", speed: 1, fromSceneText: sceneSpokenText(s) } };
    expect(narrationState(s)).toBe("current");
    (s.elements[0] as { text: string }).text = "$2,000,000";
    expect(narrationState(s)).toBe("outdated");
    delete s.narration.script!.fromSceneText;
    expect(narrationState(s)).toBe("manual");
  });
});

describe("captions", () => {
  const words = "Revenue grew strongly this year. North led every month".split(" ").map((w, i) => ({ word: w, start: i * 0.3, end: i * 0.3 + 0.25 }));

  it("groups words into short cues, breaking at sentence ends", () => {
    const cues = captionCues({ text: "", segments: [], words });
    expect(cues.map((c) => c.text)).toEqual(["Revenue grew strongly this", "year.", "North led every month"]);
    expect(cues[0]).toMatchObject({ start: 0, end: 0.9 + 0.25 });
  });

  it("interpolates word times from segments when the engine gives none", () => {
    const cues = captionCues({ text: "", segments: [{ start: 1, end: 3, text: "one two three four five six" }] });
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[1].end).toBeCloseTo(3);
  });

  it("breaks at long pauses", () => {
    const cues = captionCues({ text: "", segments: [], words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "again", start: 2, end: 2.4 }] });
    expect(cues.map((c) => c.text)).toEqual(["Hello", "again"]);
  });

  it("makes caption elements visible exactly during their cue, shifted by the narration offset", () => {
    const scene = { durationMs: 5000, narration: { src: "asset:aud_abcdefghijkl.wav", durationMs: 3000, volume: 1, offsetMs: 500 } };
    const cues = captionCues({ text: "", segments: [], words });
    const els = captionElements(cues, scene, "9:16");
    expect(els).toHaveLength(3);
    expect(els.every((e) => e.role === "caption" && e.align === "center")).toBe(true);
    const visible = (i: number, t: number) => evaluateElement(els[i], scene.durationMs, t).opacity > 0.5;
    // Cue 0 starts at 0 s → 500 ms into the scene; cue 1 starts at 1.2 s → 1700 ms.
    expect(visible(0, 400)).toBe(false);
    expect(visible(0, 800)).toBe(true);
    expect(visible(0, 1750)).toBe(false);
    expect(visible(1, 1800)).toBe(true);
    // Last cue: "North" (word 5) at 1.5 s → 2000 ms; "month" ends 2.65 s → held 400 ms → gone at 3550 ms.
    expect(visible(1, 1950)).toBe(true);
    expect(visible(2, 2050)).toBe(true);
    expect(visible(2, 3500)).toBe(true);
    expect(visible(2, 3600)).toBe(false);
  });

  it("drops cues that start after the scene ends", () => {
    const els = captionElements([{ text: "late", start: 10, end: 11 }], { durationMs: 2000 }, "16:9");
    expect(els).toHaveLength(0);
  });

  it("parses OpenAI verbose_json and nested segment words", () => {
    const t = parseTranscript({ text: "Hi there", segments: [{ start: 0, end: 1, text: " Hi there", words: [{ word: " Hi", start: 0, end: 0.4 }, { word: "there", start: 0.5, end: 1 }] }] });
    expect(t.words).toEqual([{ word: "Hi", start: 0, end: 0.4 }, { word: "there", start: 0.5, end: 1 }]);
    expect(t.segments[0].text).toBe("Hi there");
    expect(parseTranscript({ text: "x", segments: "nope" }).segments).toEqual([]);
  });
});

describe("voice engine client (mock VoiceStudio)", () => {
  let mock: MockVoice;
  beforeAll(async () => {
    mock = await startMockVoice();
    process.env.FF_VOICE_URL = mock.url;
  });
  afterAll(async () => {
    await mock.close();
    delete process.env.FF_VOICE_URL;
  });

  it("reports status and lists voices including cloned profiles", async () => {
    expect(await voiceStatus()).toMatchObject({ connected: true, version: "mock-1", modelsReady: true });
    const v = await cloneVoice("My voice", new Uint8Array([1, 2, 3]), "sample.wav", "hello");
    expect(v).toMatchObject({ kind: "profile", name: "My voice" });
    const voices = await listVoices();
    expect(voices[0]).toMatchObject({ id: v.id, kind: "profile" });
    expect(voices.map((x) => x.id)).toContain("nova");
  });

  it("synthesizes WAV and transcribes it with word timings", async () => {
    const wav = await speak({ text: "one two three four", voice: "nova", speed: 2 });
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe("RIFF");
    expect(mock.log.find((l) => l.path === "/v1/audio/speech")?.json).toMatchObject({ input: "one two three four", voice: "nova", speed: 2, response_format: "wav" });
    const tr = await transcribe(wav, "a.wav");
    expect(tr.words?.map((w) => w.word)).toEqual(["one", "two", "three", "four"]);
    expect(tr.words![1].start).toBeCloseTo(SEC_PER_WORD / 2);
  });

  it("turns engine errors into readable messages", async () => {
    await expect(speak({ text: "x", voice: "broken", speed: 1 })).rejects.toThrow(/engine crashed/);
  });

  it("reports a missing engine as not connected", async () => {
    process.env.FF_VOICE_URL = "http://127.0.0.1:9";
    const s = await voiceStatus();
    expect(s.connected).toBe(false);
    expect(s.error).toMatch(/Is VoiceStudio running/);
    process.env.FF_VOICE_URL = mock.url;
  });
});

describe("narration writer (mock Ollama)", () => {
  let ollama: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    ollama = await startMockOllama();
    process.env.FF_OLLAMA_URL = ollama.url;
  });
  afterAll(async () => {
    await ollama.close();
    delete process.env.FF_OLLAMA_URL;
  });

  it("detects numbers that are not in the source", () => {
    expect(introducesNumbers("Revenue was $1,234.50, up 12%", "Revenue hit 1234.5, a 12 percent rise")).toEqual([]);
    expect(introducesNumbers("Revenue was 10", "Revenue was 11")).toEqual(["11"]);
  });

  it("writes narration from scene text and rejects invented numbers", async () => {
    expect(await writerStatus()).toMatchObject({ connected: true, modelInstalled: true });
    expect(await writeNarration("Total revenue. $1,234,500.")).toBe("Here is the picture. Total revenue. $1,234,500.");
    await expect(writeNarration("INVENT something")).rejects.toThrow(/added numbers/);
  });
});
