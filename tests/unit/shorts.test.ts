import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { resolveNarrator } from "@/lib/server/voice";
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
  // The same mock also answers Pixabay's API; tests switch providers by setting/clearing keys.
  process.env.FF_PIXABAY_URL = pexels.url;
  closers.push(voice.close, ollama.close, pexels.close);
  mockUrl = pexels.url;
});
afterAll(async () => {
  await Promise.all(closers.map((c) => c()));
  rmSync(dir, { recursive: true, force: true });
  for (const k of ["FF_DATA_DIR", "FF_VOICE_URL", "FF_OLLAMA_URL", "FF_PEXELS_URL", "FF_PEXELS_API_KEY", "FF_PIXABAY_URL", "FF_PIXABAY_API_KEY"]) delete process.env[k];
});
let mockUrl = "";

/** Run a block with only Pixabay configured (as for users who can't get a Pexels key). */
async function withPixabayOnly<T>(fn: () => Promise<T>): Promise<T> {
  const pexelsKey = process.env.FF_PEXELS_API_KEY;
  delete process.env.FF_PEXELS_API_KEY;
  process.env.FF_PIXABAY_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    process.env.FF_PEXELS_API_KEY = pexelsKey;
    delete process.env.FF_PIXABAY_API_KEY;
  }
}

/** A real decodable clip from the mock (colour index 0–3, portrait). */
async function mockClip(i: number): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(`${mockUrl}/files/${i}p.mp4`)).arrayBuffer());
}

describe("Pixabay", () => {
  it("searches Pixabay when it is the only provider, with credits and orientation", async () => {
    await withPixabayOnly(async () => {
      const clips = await searchStock("forest", { orientation: "portrait", minDurationMs: 3000, minShortEdge: 1080 });
      expect(clips.length).toBe(8); // matching orientation first, then crop fallbacks
      expect(clips[0]).toMatchObject({ provider: "pixabay", width: 540, height: 960, author: "pix_yellow" });
      expect(clips[0].pageUrl).toMatch(/^https:\/\/pixabay\.com\/videos\//);
      const asset = await saveAsset(OWNER, "prj_pixabay001", await downloadClip(clips[0].fileUrl));
      expect(asset.media).toBe("video");
    });
  });

  it("reports a bad Pixabay key clearly", async () => {
    await withPixabayOnly(async () => {
      process.env.FF_PIXABAY_API_KEY = "wrong";
      await expect(searchStock("x", { orientation: "portrait", minDurationMs: 0, minShortEdge: 720 })).rejects.toThrow(/Pixabay/);
    });
  });

  it("generates a short with Pixabay footage and credits it", async () => {
    await withPixabayOnly(async () => {
      const job = await finished(startShort(OWNER, { ...base, script: "The forest wakes up slowly. Birds begin their morning song.", voice: null }));
      expect(job.status).toBe("done");
      const p = await loadProject(OWNER, job.projectId!);
      const v = p.scenes[0].elements.find((e) => e.type === "video");
      expect(v).toMatchObject({ credit: { provider: "Pixabay", author: "pix_yellow" } });
    });
  });

  it("fills a square canvas from non-square Pixabay clips and reports why", async () => {
    await withPixabayOnly(async () => {
      const job = await finished(startShort(OWNER, { ...base, aspectRatio: "1:1", script: "The forest wakes up slowly.", voice: null }));
      expect(job.status).toBe("done");
      const p = await loadProject(OWNER, job.projectId!);
      expect(p.scenes[0].elements.find((e) => e.type === "video")).toMatchObject({ fit: "cover", credit: { provider: "Pixabay" } });
      expect(job.warnings.join(" ")).toContain("cropped to fill 1:1");
      expect(job.footageDiagnostics?.join(" ")).toContain("orientation matches 0");
    });
  });

  it("warns and retries after a download failure without leaking request credentials", async () => {
    await withPixabayOnly(async () => {
      const original = globalThis.fetch;
      let failed = false;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).includes("/files/") && !failed) {
          failed = true;
          throw new Error("https://pixabay.com/?key=secret-never-log");
        }
        return original(input, init);
      });
      try {
        const job = await finished(startShort(OWNER, { ...base, script: "The forest wakes up slowly.", voice: null }));
        expect(job.status).toBe("done");
        expect(job.warnings.join(" ")).toContain("download:");
        expect(JSON.stringify(job)).not.toContain("secret-never-log");
        const p = await loadProject(OWNER, job.projectId!);
        expect(p.scenes[0].elements.some((e) => e.type === "video")).toBe(true);
      } finally { spy.mockRestore(); }
    });
  });

  it("reports why real-shaped API hits are filtered and keeps untrusted URLs rejected", async () => {
    await withPixabayOnly(async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ hits: [
        { id: 1, duration: 1, videos: {} },
        { id: 2, duration: 10, videos: {} },
        { id: 3, duration: 10, videos: { small: { url: "https://evil.example/clip.mp4", width: 1920, height: 1080 } } },
        { id: 4, duration: 10, videos: { small: { url: "https://cdn.pixabay.com/video/test.mp4", width: 1920, height: 1080 } } },
      ] }), { status: 200 }));
      try {
        const messages: string[] = [];
        const clips = await searchStock("forest", { orientation: "square", minDurationMs: 3000, minShortEdge: 720, onDiagnostic: (m) => messages.push(m) });
        expect(clips.map((c) => c.id)).toEqual(["pixabay-4"]);
        expect(messages.join(" ")).toContain("rejected duration/metadata 1, rendition 1, host 1; crop candidates 1");
      } finally { spy.mockRestore(); }
    });
  });

  it("warns and tries another candidate when downloaded bytes fail asset validation", async () => {
    await withPixabayOnly(async () => {
      const original = globalThis.fetch;
      let failed = false;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).includes("/files/") && !failed) {
          failed = true;
          return new Response("not a video");
        }
        return original(input, init);
      });
      try {
        const job = await finished(startShort(OWNER, { ...base, script: "The forest wakes up slowly.", voice: null }));
        expect(job.status).toBe("done");
        expect(job.warnings.join(" ")).toContain("asset validation failed");
        expect((await loadProject(OWNER, job.projectId!)).scenes[0].elements.some((e) => e.type === "video")).toBe(true);
      } finally { spy.mockRestore(); }
    });
  });
});

describe("my own clips", () => {
  it("puts the user's clips into scenes in order, filling extra scenes with stock", async () => {
    const mine = [await mockClip(2), await mockClip(3)];
    const job = await finished(startShort(OWNER, { ...base, topic: "rivers", scenes: 3, footage: "mine", myClips: mine, voice: null }));
    expect(job.error).toBeUndefined();
    expect(job.steps.find((s) => s.key === "footage")?.detail).toBe("2 yours, 1 stock");
    const p = await loadProject(OWNER, job.projectId!);
    const vids = p.scenes.map((s) => s.elements.find((e) => e.type === "video") as { src: string; credit?: unknown; trimStartMs: number });
    expect(vids.every(Boolean)).toBe(true);
    expect(vids[0].credit).toBeUndefined(); // the user's own clip
    expect(vids[1].credit).toBeUndefined();
    expect(vids[2].credit).toMatchObject({ provider: "Pexels" });
    expect(new Set(vids.map((v) => v.src)).size).toBe(3);
  });

  it("reuses the user's clips from a later point when there is no stock key", async () => {
    const saved = process.env.FF_PEXELS_API_KEY;
    delete process.env.FF_PEXELS_API_KEY;
    try {
      const job = await finished(startShort(OWNER, { ...base, topic: "rivers", scenes: 3, footage: "mine", myClips: [await mockClip(1)], voice: null }));
      expect(job.status).toBe("done");
      expect(job.warnings).toEqual([]);
      const p = await loadProject(OWNER, job.projectId!);
      const vids = p.scenes.map((s) => s.elements.find((e) => e.type === "video") as { src: string; trimStartMs: number });
      expect(new Set(vids.map((v) => v.src)).size).toBe(1);
      expect(vids.map((v) => v.trimStartMs)).toEqual([0, 2000, 4000]);
    } finally {
      process.env.FF_PEXELS_API_KEY = saved;
    }
  });

  it("rejects a 'clip' that is not a video and removes the project", async () => {
    const before = (await listProjects(OWNER)).length;
    const job = await finished(startShort(OWNER, { ...base, script: "Just one scene here now.", footage: "mine", myClips: [wavTone(1)], voice: null }));
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/not a video/);
    expect((await listProjects(OWNER)).length).toBe(before);
  });
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

const base: ShortRequest = { scenes: 3, aspectRatio: "9:16", voice: "nova", speed: 1, captions: true, footage: "stock" };

describe("fixed Auto Mode narrator", () => {
  async function withCatalog(run: (requests: Record<string, unknown>[]) => Promise<void>, demo = true) {
    const original = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/audio/voices")) return Response.json({ voices: [{ id: "fable", type: "openai_alias" }] });
      if (String(input).endsWith("/profiles")) return Response.json([
        ...(demo ? [{ id: "demo0001", name: "Demo Voice" }] : []),
        { id: "prof_mine", name: "My narrator" },
      ]);
      if (String(input).endsWith("/v1/audio/speech")) requests.push(JSON.parse(String(init?.body)));
      return original(input, init);
    });
    try { await run(requests); } finally { spy.mockRestore(); }
  }

  it("uses and persists the same reference for every scene without creating profiles", async () => {
    await withCatalog(async (requests) => {
      const job = await finished(startShort(OWNER, { ...base, voice: "fable", footage: "none", script: "The river flows through the forest. Birds sing among the trees. Sunlight warms the quiet valley." }));
      expect(job.status).toBe("done");
      expect(requests).toHaveLength(3);
      expect(requests.every((r) => r.voice === "demo0001" && r.speed === 1)).toBe(true);
      const p = await loadProject(OWNER, job.projectId!);
      expect(p.scenes.every((s) => s.narration?.script?.voice === "demo0001")).toBe(true);
      expect(p.scenes.every((s) => s.elements.some((e) => e.role === "caption"))).toBe(true);
    });
  });

  it("preserves fixed profile selections and resolves profile names", async () => {
    await withCatalog(async () => {
      expect(await resolveNarrator("prof_mine")).toBe("prof_mine");
      expect(await resolveNarrator("My narrator")).toBe("prof_mine");
      expect(await resolveNarrator("default")).toBe("demo0001");
    });
  });

  it("fails explicitly if an alias has no reference instead of choosing a random speaker", async () => {
    await withCatalog(async (requests) => {
      await expect(resolveNarrator("fable")).rejects.toThrow(/fixed narrator/);
      expect(requests).toHaveLength(0);
    }, false);
  });
});

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
    const job = await finished(startShort(OWNER, { ...base, script: "First we start here today. Then the story keeps going on.", voice: null, footage: "none" }));
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
    const job = startShort(OWNER, { ...base, script: "One small scene here please.", voice: null, footage: "none" });
    expect(getShortJob("usr_someoneelse1", job.id)).toBeUndefined();
    await finished(job);
  });
});
