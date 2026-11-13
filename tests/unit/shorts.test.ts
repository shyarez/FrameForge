import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alignToScript } from "@/lib/engine/narration";
import { keywordTerms, splitScript } from "@/lib/engine/shorts";
import { videoTimeMs } from "@/lib/engine/video";
import { ProjectSchema } from "@/lib/schema/project";
import { listAssets, saveAsset, sniffVideo } from "@/lib/server/assets";
import { inlineAssets } from "@/lib/server/inlineAssets";
import { grantRenderMedia, lookupRenderMedia, revokeRenderMedia } from "@/lib/server/renderMedia";
import { getShortJob, startShort, type ShortJob, type ShortRequest } from "@/lib/server/shorts";
import { downloadClip, pickRendition, searchStock } from "@/lib/server/stock";
import { listProjects, loadProject } from "@/lib/server/storage";
import { startMockOllama, startMockPexels, startMockVoice, wavTone } from "../../scripts/mock-voice";

const OWNER = "usr_testshorts01";
let dir = "";
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-shorts-"));
  process.env.FF_DATA_DIR = dir;
  const [voice, ollama, pexels] = await Promise.all([startMockVoice(), startMockOllama(), startMockPexels()]);
  process.env.FF_VOICE_URL = voice.url;
  process.env.FF_OLLAMA_URL = ollama.url;
  process.env.FF_PEXELS_URL = pexels.url;
  process.env.FF_PEXELS_API_KEY = "test-key";
  closers.push(voice.close, ollama.close, pexels.close);
});
afterAll(async () => {
  await Promise.all(closers.map((c) => c()));
  rmSync(dir, { recursive: true, force: true });
  for (const k of ["FF_DATA_DIR", "FF_VOICE_URL", "FF_OLLAMA_URL", "FF_PEXELS_URL", "FF_PEXELS_API_KEY"]) delete process.env[k];
});

describe("script helpers", () => {
  it("splits a script into scene sentences, merging fragments and keeping decimals", () => {
    expect(splitScript("Octopuses have three hearts. Wow! Their blood is blue, with 1.5 times more copper. **Amazing** (really).")).toEqual([
      "Octopuses have three hearts. Wow!",
      "Their blood is blue, with 1.5 times more copper. Amazing.",
    ]);
    expect(splitScript("   ")).toEqual([]);
  });

  it("caps the number of scenes by joining neighbours", () => {
    const script = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i + 1} here.`).join(" ");
    const out = splitScript(script, 5);
    expect(out).toHaveLength(5);
    expect(out.join(" ").split("sentence").length - 1).toBe(20);
  });

  it("finds fallback search keywords", () => {
    expect(keywordTerms("The octopuses were swimming through the coral reef")).toBe("octopuses swimming");
    expect(keywordTerms("is it?")).toBe("abstract background");
  });

  it("uses the script's words with the engine's timings when counts match", () => {
    const tr = { text: "hello wurld", segments: [{ start: 0, end: 1, text: "hello wurld" }], words: [{ word: "hello", start: 0, end: 0.4 }, { word: "wurld", start: 0.5, end: 1 }] };
    expect(alignToScript(tr, "Hello, world!").words?.map((w) => w.word)).toEqual(["Hello,", "world!"]);
    expect(alignToScript(tr, "Something else entirely")).toBe(tr);
    expect(alignToScript({ text: "x", segments: [{ start: 0.2, end: 2, text: "x" }] }, "a b c").segments[0]).toEqual({ start: 0.2, end: 2, text: "a b c" });
  });
});

describe("video", () => {
  it("maps scene time to file time with trim, loop and hold", () => {
    const el = { durationMs: 3000, trimStartMs: 1000, loop: true };
    expect(videoTimeMs(el, 0)).toBe(1000);
    expect(videoTimeMs(el, 500)).toBe(1500);
    expect(videoTimeMs(el, 1960)).toBe(1000); // looped after 1960 ms of playable span
    expect(videoTimeMs({ ...el, loop: false }, 9000)).toBe(2960); // holds the last frame
  });

  it("sniffs MP4 and WebM but not audio-only MP4", () => {
    const ftyp = (brand: string) => Uint8Array.from([0, 0, 0, 24, ...Buffer.from(`ftyp${brand}`)]);
    expect(sniffVideo(ftyp("isom"))).toBe("mp4");
    expect(sniffVideo(ftyp("M4A "))).toBeNull();
    expect(sniffVideo(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
  });

  it("picks the smallest rendition that covers the target, else the largest", () => {
    const files = [
      { link: "a", width: 640, height: 360 },
      { link: "b", width: 1920, height: 1080 },
      { link: "c", width: 1280, height: 720 },
      { link: "d", width: 3840, height: 2160 },
    ];
    expect(pickRendition(files, 720)?.link).toBe("c");
    expect(pickRendition(files, 4000)?.link).toBe("d");
    expect(pickRendition([], 720)).toBeNull();
  });

  it("issues render-media grants that expire and can be revoked", () => {
    const t = grantRenderMedia(OWNER, "prj_abcdefgh", 1000);
    expect(lookupRenderMedia(t)).toMatchObject({ owner: OWNER, projectId: "prj_abcdefgh" });
    revokeRenderMedia(t);
    expect(lookupRenderMedia(t)).toBeNull();
    expect(lookupRenderMedia(grantRenderMedia(OWNER, "prj_abcdefgh", -1))).toBeNull();
  });
});

describe("stock footage (mock Pexels)", () => {
  it("searches by orientation and downloads a real, decodable clip", async () => {
    const clips = await searchStock("ocean", { orientation: "portrait", minDurationMs: 3000, minShortEdge: 1080 });
    expect(clips.length).toBeGreaterThan(1);
    expect(clips[0]).toMatchObject({ width: 540, height: 960, author: "Mock red" });
    const bytes = await downloadClip(clips[0].fileUrl);
    const asset = await saveAsset(OWNER, "prj_stocktest1", bytes);
    expect(asset).toMatchObject({ media: "video", kind: "mp4", width: 540, height: 960 });
    expect(Math.abs(asset.durationMs! - 6000)).toBeLessThan(100);
    expect((await listAssets(OWNER, "prj_stocktest1"))[0]).toMatchObject({ media: "video", width: 540 });
  });

  it("refuses downloads from other hosts", async () => {
    await expect(downloadClip("https://evil.example.com/x.mp4")).rejects.toThrow(/unexpected host/);
    await expect(downloadClip("file:///etc/passwd")).rejects.toThrow(/unexpected host/);
  });

  it("filters out clips that are too short", async () => {
    expect(await searchStock("ocean", { orientation: "landscape", minDurationMs: 10_000, minShortEdge: 720 })).toEqual([]);
  });
});

async function finished(job: ShortJob): Promise<ShortJob> {
  for (let i = 0; i < 600; i++) {
    const j = getShortJob(OWNER, job.id)!;
    if (j.status === "done" || j.status === "error") return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("generation timed out");
}

const base: ShortRequest = { scenes: 3, aspectRatio: "9:16", voice: "nova", speed: 1, captions: true, footage: true };

describe("short-video generator", () => {
  it("turns a topic into an editable, voiced, captioned project with footage and music", async () => {
    const job = await finished(startShort(OWNER, { ...base, topic: "octopuses", music: wavTone(4, 220) }));
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("done");
    expect(job.warnings).toEqual([]);
    expect(job.steps.every((s) => s.state === "done")).toBe(true);

    const p = await loadProject(OWNER, job.projectId!);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.name).toBe("All about octopuses");
    expect(p.aspectRatio).toBe("9:16");
    expect(p.scenes).toHaveLength(3);
    for (const [i, s] of p.scenes.entries()) {
      expect(s.narration?.script?.text).toBe(`Fact number ${i + 1} about octopuses is surprising.`);
      // Scene fitted to the voice: 6 words × 0.3 s + 350 ms tail, rounded up.
      expect(s.durationMs).toBe(Math.ceil((s.narration!.durationMs + 350) / 100) * 100);
      const video = s.elements.find((e) => e.type === "video");
      expect(video).toMatchObject({ x: 0, y: 0, width: 1080, height: 1920, loop: true, credit: { provider: "Pexels" } });
      const caps = s.elements.filter((e) => e.role === "caption").map((e) => (e.type === "text" ? e.text : ""));
      expect(caps.join(" ")).toBe(`Fact number ${i + 1} about octopuses is surprising.`);
    }
    // Different clips for different scenes.
    const srcs = p.scenes.flatMap((s) => s.elements.flatMap((e) => (e.type === "video" ? [e.src] : [])));
    expect(new Set(srcs).size).toBe(3);
    expect(p.music).toMatchObject({ loop: true, duck: 0.35 });

    // Exports stream videos via a grant instead of embedding them.
    const renderable = await inlineAssets(OWNER, p, "tok_abcdefghijklmnopqrstuvwxyz");
    const v = renderable.scenes[0].elements.find((e) => e.type === "video") as { src: string };
    expect(v.src).toMatch(/^\/api\/render-media\/tok_abcdefghijklmnopqrstuvwxyz\/vid_.*\.mp4$/);
    expect(ProjectSchema.safeParse(renderable).success).toBe(true);
  });

  it("works from the user's own script, without voice or footage", async () => {
    const job = await finished(startShort(OWNER, { ...base, script: "First we start here today. Then the story keeps going on.", voice: null, footage: false }));
    expect(job.status).toBe("done");
    expect(job.steps.find((s) => s.key === "voice")?.state).toBe("skipped");
    const p = await loadProject(OWNER, job.projectId!);
    expect(p.scenes).toHaveLength(2);
    expect(p.scenes.every((s) => !s.narration && !s.elements.some((e) => e.type === "video"))).toBe(true);
    // Captions still appear, spread across the scene.
    expect(p.scenes[0].elements.filter((e) => e.role === "caption").length).toBeGreaterThan(0);
  });

  it("fails cleanly and removes the half-built project when the voice engine errors", async () => {
    const before = (await listProjects(OWNER)).length;
    const job = await finished(startShort(OWNER, { ...base, topic: "anything", voice: "broken" }));
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/engine crashed/);
    expect(job.steps.find((s) => s.key === "voice")?.state).toBe("error");
    expect(job.projectId).toBeUndefined();
    expect((await listProjects(OWNER)).length).toBe(before);
  });

  it("hides jobs from other users", async () => {
    const job = startShort(OWNER, { ...base, script: "One small scene here please.", voice: null, footage: false });
    expect(getShortJob("usr_someoneelse1", job.id)).toBeUndefined();
    await finished(job);
  });
});
