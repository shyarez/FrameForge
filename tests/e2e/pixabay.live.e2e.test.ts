import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { chromePath, probeVideo } from "@/lib/server/render";
import { ffmpegPath } from "@/lib/server/media";
import type { Project } from "@/lib/schema/project";

/** Opt-in real provider test against a running app with FF_PIXABAY_API_KEY configured.
 * FF_LIVE_PIXABAY=1 npm run test:e2e -- pixabay.live
 * No mock providers. Uses the existing localhost developer sign-in; deletes only its own project.
 */
it.skipIf(process.env.FF_LIVE_PIXABAY !== "1")("renders real Pixabay footage in a square preview and MP4", async () => {
  const base = process.env.FF_BASE_URL ?? "http://localhost:3000";
  const login = await fetch(`${base}/api/auth/dev-login`, { method: "POST" });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const api = (url: string, init: RequestInit = {}) => fetch(`${base}${url}`, { ...init, headers: { ...init.headers, cookie } });
  const status = await (await api("/api/shorts/status")).json();
  expect(status.stock.providers).toContain("Pixabay");
  console.log("Live status:", JSON.stringify(status.stock));
  const options = { name: "Pixabay live verification", script: "Forest forest forest.", scenes: 2, aspectRatio: "1:1", voice: null, speed: 1, captions: true, footage: "stock" };
  const form = new FormData();
  form.set("options", JSON.stringify(options));
  const res = await api("/api/shorts", { method: "POST", body: form });
  expect(res.status).toBe(202);
  let { job } = await res.json();
  let projectId: string | undefined;
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    for (let i = 0; i < 240 && !["done", "error"].includes(job.status); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      job = (await (await api(`/api/shorts/${job.id}`)).json()).job;
    }
    projectId = job.projectId;
    console.log("Live footage:", JSON.stringify({ status: job.status, warnings: job.warnings, diagnostics: job.footageDiagnostics }));
    expect(job.status).toBe("done");
    const p: Project = (await (await api(`/api/projects/${projectId}`)).json()).project;
    const video = p.scenes[0].elements.find((e) => e.type === "video");
    expect(video).toMatchObject({ type: "video", credit: { provider: "Pixabay" } });
    // Keep the verification export small; generation itself used the normal defaults.
    p.scenes[0].durationMs = 1500;
    p.exportSettings = { fps: 24, resolution: 720 };
    expect((await api(`/api/projects/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) })).ok).toBe(true);
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const [name, value] = cookie.split("=");
    await ctx.addCookies([{ name, value, url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/editor/${projectId}`);
    const clip = page.locator("[data-stage] video[data-ff-video]").first();
    await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30000 }).toBeGreaterThanOrEqual(2);
    const previewRange = await clip.evaluate((v: HTMLVideoElement) => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(v, 0, 0, 32, 32);
      const rgb = [...ctx.getImageData(0, 0, 32, 32).data].filter((_, i) => i % 4 !== 3);
      return Math.max(...rgb) - Math.min(...rgb);
    });
    expect(previewRange).toBeGreaterThan(20);
    const dir = mkdtempSync(path.join(tmpdir(), "ff-pixabay-live-"));
    await page.locator("[data-stage]").screenshot({ path: path.join(dir, "preview.png") });
    let exportJob = (await (await api(`/api/projects/${projectId}/export`, { method: "POST" })).json()).job;
    for (let i = 0; i < 180 && !["done", "error"].includes(exportJob.status); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      exportJob = (await (await api(`/api/exports/${exportJob.id}`)).json()).job;
    }
    expect(exportJob.status).toBe("done");
    const file = path.join(dir, "real-pixabay.mp4");
    writeFileSync(file, Buffer.from(await (await api(`/api/exports/${exportJob.id}/file`)).arrayBuffer()));
    expect((await probeVideo(file)).decodedOk).toBe(true);
    const decoded = spawnSync(ffmpegPath(), ["-v", "error", "-i", file, "-frames:v", "1", "-vf", "crop=200:200:0:0,scale=32:32", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    expect(decoded.status).toBe(0);
    expect(Math.max(...decoded.stdout) - Math.min(...decoded.stdout)).toBeGreaterThan(20);
    console.log("Real preview and MP4 verified:", dir);
  } finally {
    await browser.close();
    if (projectId) await api(`/api/projects/${projectId}`, { method: "DELETE" });
  }
}, 300000);
