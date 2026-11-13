import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { ffmpegPath } from "@/lib/server/media";
import { chromePath, probeVideo } from "@/lib/server/render";
import type { Project } from "@/lib/schema/project";
import { wavTone } from "../../scripts/mock-voice";

/**
 * Phase 3 short-video generator through the real UI, against the mock engines:
 *   npx tsx scripts/mock-voice.ts
 *   FF_VOICE_URL=http://127.0.0.1:3990 FF_OLLAMA_URL=http://127.0.0.1:11499 \
 *   FF_PEXELS_URL=http://127.0.0.1:3991 FF_PEXELS_API_KEY=test-key npm run dev
 *   FF_BASE_URL=http://localhost:3000 npm run test:e2e -- shorts
 * The mock's stock clips are solid red, green, blue and yellow, so the export can be checked by colour.
 */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e-shorts-"));
let browser: Browser;
let page: Page;
let cookie = "";
let projectId = "";

const api = (url: string, init: RequestInit = {}) => fetch(`${BASE}${url}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
const getProject = async (): Promise<Project> => (await (await api(`/api/projects/${projectId}`)).json()).project;

/** Average colour of the top-left 120×120 px of the frame at time t (away from the centred captions). */
function colourAt(file: string, t: number): [number, number, number] {
  const r = spawnSync(ffmpegPath(), ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "crop=120:120:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const b = r.stdout;
  return [b[0], b[1], b[2]];
}

beforeAll(async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `shorts-${Date.now()}@e2e.local`, password: "correct horse battery staple" }),
  });
  expect(reg.status).toBeLessThan(300);
  cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const [name, value] = cookie.split("=");
  await ctx.addCookies([{ name, value, url: BASE }]);
  page = await ctx.newPage();
});

afterAll(async () => {
  await browser?.close();
  if (projectId) await api(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  rmSync(tmp, { recursive: true, force: true });
});

describe("shorts: topic → editable short video", () => {
  it("reports the voice engine, script writer and stock footage as available", async () => {
    const s = await (await api("/api/shorts/status")).json();
    expect(s.voice.connected).toBe(true);
    expect(s.writer.connected).toBe(true);
    expect(s.stock).toMatchObject({ configured: true, providers: ["Pexels", "Pixabay"] });
    expect(s.voices.map((v: { id: string }) => v.id)).toContain("nova");
  });

  it("generates a short from the dashboard and opens it in the editor", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Generate short" }).click();
    const dialog = page.getByRole("dialog", { name: "Generate a short video" });
    await expect.poll(() => dialog.getByText(/Stock footage: Pexels, Pixabay$/).count(), { timeout: 15_000 }).toBe(1);
    await dialog.getByLabel("Topic").fill("deep sea creatures");
    await dialog.getByLabel("Length").selectOption("4");
    await dialog.locator("select").filter({ has: page.getByRole("option", { name: "Nova" }) }).selectOption("nova");
    const music = path.join(tmp, "music.wav");
    writeFileSync(music, wavTone(5, 196));
    await dialog.getByLabel("Music file").setInputFiles(music);
    await dialog.getByRole("button", { name: "Generate video" }).click();
    await page.waitForURL(/\/editor\/prj_/, { timeout: 90_000 });
    projectId = /\/editor\/(prj_[A-Za-z0-9_-]+)/.exec(page.url())![1];
    await page.locator("[data-stage]").waitFor();

    const p = await getProject();
    expect(p.name).toBe("All about deep sea creatures");
    expect(p.scenes).toHaveLength(4);
    expect(p.scenes.every((s) => s.narration && s.elements.some((e) => e.type === "video") && s.elements.some((e) => e.role === "caption"))).toBe(true);
    expect(p.music).toBeDefined();
  });

  it("shows the stock clip on the editor canvas", async () => {
    const video = page.locator("[data-stage] video[data-ff-video]").first();
    await video.waitFor({ timeout: 15_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(540);
    // Footage credit is shown for the selected video.
    await page.getByRole("button", { name: /^Footage/ }).first().click();
    expect(await page.getByText(/on Pexels/).count()).toBe(1);
  });

  it("exports a 1080×1920 MP4 with sound, each scene showing its own clip", async () => {
    const { job } = await (await api(`/api/projects/${projectId}/export`, { method: "POST" })).json();
    let final = job;
    for (let i = 0; i < 600 && !["done", "error"].includes(final.status); i++) {
      await new Promise((r) => setTimeout(r, 500));
      final = (await (await api(`/api/exports/${job.id}`)).json()).job;
    }
    expect(final.error).toBeUndefined();
    const mp4 = path.join(tmp, "short.mp4");
    writeFileSync(mp4, Buffer.from(await (await api(`/api/exports/${job.id}/file`)).arrayBuffer()));
    const probe = await probeVideo(mp4);
    expect(probe.decodedOk).toBe(true);
    expect([probe.width, probe.height]).toEqual([1080, 1920]);
    expect(probe.audio?.codec).toBe("aac");

    // Mock clips in search order are red, green, blue, yellow; each scene takes the next unused one.
    const p = await getProject();
    let t = 0;
    const expected: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    for (const [i, s] of p.scenes.entries()) {
      const [r, g, b] = colourAt(mp4, (t + s.durationMs / 2) / 1000);
      // FFmpeg "green" is #008000, and the 30% shade darkens every clip, so "on" means clearly above black.
      const on = (v: number) => (v > 55 ? 1 : v < 25 ? 0 : -1);
      expect([on(r), on(g), on(b)], `scene ${i + 1} colour ${r},${g},${b}`).toEqual(expected[i]);
      t += s.durationMs;
    }
  });

  it("accepts uploads larger than the proxy's 10 MB default", async () => {
    // ~13 MB WAV: 70 s of 48 kHz stereo is too big for a 10 MB buffered body.
    const big = path.join(tmp, "big.wav");
    const r = spawnSync(ffmpegPath(), ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=70:sample_rate=48000", "-ac", "2", big]);
    expect(r.status).toBe(0);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(readFileSync(big))]), "big.wav");
    const res = await api(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(Math.abs(body.asset.durationMs - 70_000)).toBeLessThan(200);
  });

  it("generates from my own script and my own clips through the dialog", async () => {
    // Two "own" clips: solid magenta and cyan, which the stock mock never serves.
    const own = ["magenta", "cyan"].map((c) => {
      const f = path.join(tmp, `${c}.mp4`);
      spawnSync(ffmpegPath(), ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${c}:s=540x960:r=25:d=4`, "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
      return f;
    });
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Generate short" }).click();
    const dialog = page.getByRole("dialog", { name: "Generate a short video" });
    await dialog.getByRole("tab", { name: "My own script" }).click();
    await dialog.getByLabel("Script").fill("Rivers carve the land over time. Water always finds a way forward.");
    await dialog.getByLabel("Footage").selectOption("mine");
    await dialog.getByLabel("Your video clips").setInputFiles(own);
    await dialog.getByRole("button", { name: "Generate video" }).click();
    await page.waitForURL((u) => /\/editor\/prj_/.test(u.toString()) && !u.toString().endsWith(projectId), { timeout: 90_000 });
    const ownId = /\/editor\/(prj_[A-Za-z0-9_-]+)/.exec(page.url())![1];
    try {
      const p: Project = (await (await api(`/api/projects/${ownId}`)).json()).project;
      expect(p.scenes).toHaveLength(2);
      const vids = p.scenes.map((s) => s.elements.find((e) => e.type === "video") as { credit?: unknown } | undefined);
      expect(vids.every((v) => v && !v.credit)).toBe(true);
    } finally {
      await api(`/api/projects/${ownId}`, { method: "DELETE" });
    }
  });
});
