import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { runFfmpeg } from "@/lib/server/media";
import { chromePath, probeVideo } from "@/lib/server/render";
import type { Project } from "@/lib/schema/project";

/**
 * Phase 1 audio against a running app: FF_BASE_URL=http://localhost:3210 npm run test:e2e -- audio
 * Signs up a throwaway account, uploads a voice-over and a music track through the UI, wires them up in
 * the inspector, plays the preview, and exports an MP4 whose audio track is verified.
 */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e-audio-"));
let browser: Browser;
let page: Page;
let cookie = "";
let projectId = "";

const api = (url: string, init: RequestInit = {}) => fetch(`${BASE}${url}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
const getProject = async (): Promise<Project> => (await (await api(`/api/projects/${projectId}`)).json()).project;

async function tone(name: string, seconds: number, freq: number) {
  const out = path.join(tmp, name);
  const { code, err } = await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`, out]);
  if (code !== 0) throw new Error(err);
  return out;
}

beforeAll(async () => {
  const email = `audio-${Date.now()}@e2e.local`;
  const reg = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery staple" }) });
  expect(reg.status).toBeLessThan(300);
  cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  projectId = (await (await api("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Audio", aspectRatio: "16:9", template: "blank" }) })).json()).project.id;

  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  const [name, value] = cookie.split("=");
  await ctx.addCookies([{ name, value, url: BASE }]);
  // Record every media play() so the preview test can see which files actually started.
  await ctx.addInitScript(() => {
    const w = window as unknown as { __plays: string[] };
    w.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push(this.currentSrc || this.src);
      return orig.call(this);
    };
  });
  page = await ctx.newPage();
  await page.goto(`${BASE}/editor/${projectId}`);
  await page.locator("[data-stage]").waitFor();
});

afterAll(async () => {
  await browser?.close();
  if (projectId) await api(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  rmSync(tmp, { recursive: true, force: true });
});

describe("audio: narration and music", () => {
  it("uploads audio in the Assets tab", async () => {
    await page.getByRole("tab", { name: /Assets/ }).click();
    await page.getByLabel("Upload image, audio or video files").setInputFiles([await tone("voice.wav", 2.2, 660), await tone("music.mp3", 3, 220)]);
    await expect.poll(async () => page.getByText(/^Audio \d$/).count(), { timeout: 30_000 }).toBe(2);
  });

  it("serves audio with byte ranges so the browser can seek", async () => {
    const assets = (await (await api(`/api/projects/${projectId}/assets`)).json()).assets as { name: string; media: string; durationMs: number }[];
    const wav = assets.find((a) => a.name.endsWith(".wav"))!;
    expect(Math.abs(wav.durationMs - 2200)).toBeLessThan(80);
    const res = await api(`/api/projects/${projectId}/assets/${wav.name}`, { headers: { range: "bytes=100-199" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 100-199\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("sets narration, fits the scene to it, and adds music", async () => {
    const wavRow = page.locator("li", { hasText: "WAV" });
    await wavRow.getByRole("button", { name: "Narrate scene" }).click();
    await page.getByRole("button", { name: "Fit scene length to narration" }).click();
    const mp3Row = page.locator("li", { hasText: "MP3" });
    await mp3Row.getByRole("button", { name: "Use as music" }).click();
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await getProject()).music?.src, { timeout: 10_000 }).toMatch(/^asset:aud_.*\.mp3$/);
    const p = await getProject();
    expect(p.scenes[0].narration?.src).toMatch(/\.wav$/);
    // 2.2 s of voice + 0.4 s tail, rounded up to 100 ms.
    expect(p.scenes[0].durationMs).toBe(2600);
    expect(p.music).toMatchObject({ loop: true, duck: 0.3 });
    if (process.env.FF_SHOTS_DIR) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(process.env.FF_SHOTS_DIR, "audio-editor.png") });
    }
  });

  it("plays narration in the preview", async () => {
    await page.getByRole("button", { name: "Back to start" }).click();
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(800);
    const plays = await page.evaluate(() => (window as unknown as { __plays: string[] }).__plays);
    expect(plays.some((s) => /\/assets\/aud_.*\.wav$/.test(s))).toBe(true);
    expect(plays.some((s) => /\/assets\/aud_.*\.mp3$/.test(s))).toBe(true);
    await page.getByRole("button", { name: "Pause" }).click();
  });

  it("exports an MP4 with a verified audio track", async () => {
    const { job } = await (await api(`/api/projects/${projectId}/export`, { method: "POST" })).json();
    let status = job.status;
    let final: { status: string; error?: string; probe?: { audio: unknown } } = job;
    for (let i = 0; i < 240 && status !== "done" && status !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      final = (await (await api(`/api/exports/${job.id}`)).json()).job;
      status = final.status;
    }
    expect(final.error).toBeUndefined();
    expect(status).toBe("done");
    const mp4 = path.join(tmp, "out.mp4");
    writeFileSync(mp4, Buffer.from(await (await api(`/api/exports/${job.id}/file`)).arrayBuffer()));
    const probe = await probeVideo(mp4);
    expect(probe.decodedOk).toBe(true);
    expect(probe.audio).toMatchObject({ codec: "aac", sampleRate: 48000 });
    expect(Math.abs(probe.durationSec - 2.6)).toBeLessThan(0.15);

    // The voice (660 Hz) is present in the first scene: measure its level with a band-pass.
    const { err } = await runFfmpeg(["-hide_banner", "-i", mp4, "-ss", "0.3", "-t", "1.5", "-af", "bandpass=f=660:w=40,volumedetect", "-vn", "-f", "null", "-"]);
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(err)?.[1] ?? -99);
    expect(mean).toBeGreaterThan(-30);
  });
});
