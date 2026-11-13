import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createScene, createText } from "@/lib/schema/factory";
import { chromePath, probeVideo } from "@/lib/server/render";
import type { Project } from "@/lib/schema/project";
import { SEC_PER_WORD, wavTone } from "../../scripts/mock-voice";

/**
 * Phase 2 voice features through the real UI, against the mock engines:
 *   npx tsx scripts/mock-voice.ts
 *   FF_VOICE_URL=http://127.0.0.1:3990 FF_OLLAMA_URL=http://127.0.0.1:11499 npm run dev
 *   FF_BASE_URL=http://localhost:3000 npm run test:e2e -- voice
 */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e-voice-"));
let browser: Browser;
let page: Page;
let cookie = "";
let projectId = "";
const voiceName = `Narrator ${Date.now()}`;

const api = (url: string, init: RequestInit = {}) => fetch(`${BASE}${url}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
const getProject = async (): Promise<Project> => (await (await api(`/api/projects/${projectId}`)).json()).project;
const panel = () => page.locator("section", { has: page.getByRole("heading", { name: "Narration" }) });
const save = async () => {
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await page.locator("[aria-live=polite]").first().textContent())?.trim(), { timeout: 10_000 }).toBe("Saved");
};

beforeAll(async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `voice-${Date.now()}@e2e.local`, password: "correct horse battery staple" }),
  });
  expect(reg.status).toBeLessThan(300);
  cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  const created = await api("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Voice", aspectRatio: "9:16", template: "blank" }) });
  projectId = (await created.json()).project.id;
  const p = await getProject();
  p.scenes = [
    createScene("Metric", {
      durationMs: 6000,
      elements: [createText({ name: "Title", text: "Total revenue", y: 200 }), createText({ name: "Number", text: "$1,234,500", y: 600 })],
    }),
  ];
  await api(`/api/projects/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });

  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const [name, value] = cookie.split("=");
  await ctx.addCookies([{ name, value, url: BASE }]);
  page = await ctx.newPage();
  await page.goto(`${BASE}/editor/${projectId}`);
  await page.locator("[data-stage]").waitFor();
});

afterAll(async () => {
  await browser?.close();
  if (projectId) await api(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  rmSync(tmp, { recursive: true, force: true });
});

describe("voice: VoiceStudio narration, captions and Ollama writing", () => {
  it("shows the engine as connected and lists its voices", async () => {
    const status = await (await api("/api/voice/status")).json();
    expect(status.voice).toMatchObject({ connected: true, modelsReady: true });
    expect(status.writer).toMatchObject({ connected: true, modelInstalled: true });
    await expect.poll(async () => panel().getByRole("option", { name: "Nova" }).count(), { timeout: 15_000 }).toBe(1);
    expect(await panel().getByText("VoiceStudio is not connected").count()).toBe(0);
  });

  it("fills the script from the scene text and rewrites it with the local model", async () => {
    await panel().getByRole("button", { name: "Scene text" }).click();
    await expect.poll(() => panel().getByLabel("Narration script").inputValue()).toBe("Total revenue. $1,234,500.");
    await panel().getByRole("button", { name: "Write with AI" }).click();
    await expect.poll(() => panel().getByLabel("Narration script").inputValue(), { timeout: 15_000 }).toBe("Here is the picture. Total revenue. $1,234,500.");
  });

  it("clones a voice from a sample and selects it", async () => {
    const sample = path.join(tmp, "me.wav");
    writeFileSync(sample, wavTone(2));
    await panel().getByRole("button", { name: /Clone a voice/ }).click();
    await panel().getByLabel("Voice name").fill(voiceName);
    await panel().getByLabel("Voice sample").setInputFiles(sample);
    await panel().getByRole("button", { name: "Create voice" }).click();
    await expect.poll(async () => panel().getByRole("option", { name: `${voiceName} (yours)` }).count(), { timeout: 15_000 }).toBe(1);
    const voiceSelect = panel().locator("select").filter({ has: page.getByRole("option", { name: "Nova" }) });
    expect(await voiceSelect.inputValue()).toMatch(/^prof_/);
  });

  it("generates the voice-over, fits the scene and adds timed captions", async () => {
    await panel().getByRole("button", { name: "Generate voice-over" }).click();
    await expect.poll(async () => page.getByRole("button", { name: /Re-time captions/ }).count(), { timeout: 30_000 }).toBe(1);
    await save();
    if (process.env.FF_SHOTS_DIR) await page.screenshot({ path: path.join(process.env.FF_SHOTS_DIR, "voice-panel.png"), fullPage: true });
    const scene = (await getProject()).scenes[0];
    // 7 words × 0.3 s from the mock engine.
    const words = 7;
    // Decoded length can include the final audio frame (tens of ms).
    expect(Math.abs(scene.narration!.durationMs - words * SEC_PER_WORD * 1000)).toBeLessThan(100);
    expect(scene.narration!.script).toMatchObject({ text: "Here is the picture. Total revenue. $1,234,500.", fromSceneText: "Total revenue. $1,234,500." });
    expect(scene.narration!.script!.voice).toMatch(/^prof_/);
    // Fitted: voice + 0.4 s tail, rounded up to 100 ms.
    expect(scene.durationMs).toBe(Math.ceil((scene.narration!.durationMs + 400) / 100) * 100);
    const caps = scene.elements.filter((e) => e.role === "caption");
    expect(caps.map((c) => (c.type === "text" ? c.text : ""))).toEqual(["Here is the picture.", "Total revenue.", "$1,234,500."]);
    // The second caption appears when its first word is spoken (word 4 → 1.2 s).
    expect(caps[1].enter.delayMs).toBe(Math.round(4 * SEC_PER_WORD * 1000));
  });

  it("flags the voice-over as out of date when the scene's text changes", async () => {
    // Select the "Number" layer, then edit its content in the inspector.
    await page.getByRole("button", { name: /^Number/ }).click({ timeout: 10_000 });
    const content = page.getByLabel("Content");
    await content.fill("$2,000,000", { timeout: 10_000 });
    await content.blur();
    await page.getByRole("button", { name: "← Scene settings" }).click({ timeout: 10_000 });
    await expect.poll(async () => panel().getByText(/text changed after this voice-over was made/).count(), { timeout: 10_000 }).toBe(1);
  });

  it("exports with the generated voice in the audio track", async () => {
    await save();
    const { job } = await (await api(`/api/projects/${projectId}/export`, { method: "POST" })).json();
    let final = job;
    for (let i = 0; i < 240 && !["done", "error"].includes(final.status); i++) {
      await new Promise((r) => setTimeout(r, 500));
      final = (await (await api(`/api/exports/${job.id}`)).json()).job;
    }
    expect(final.error).toBeUndefined();
    const mp4 = path.join(tmp, "voice.mp4");
    writeFileSync(mp4, Buffer.from(await (await api(`/api/exports/${job.id}/file`)).arrayBuffer()));
    const probe = await probeVideo(mp4);
    expect(probe.decodedOk).toBe(true);
    expect(probe.audio?.codec).toBe("aac");
    expect(probe.height).toBeGreaterThan(probe.width);
  });
});
