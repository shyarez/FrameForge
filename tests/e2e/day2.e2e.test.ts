import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { chromePath, ffmpegPath } from "@/lib/server/render";
import type { Project } from "@/lib/schema/project";

/** Day 2 editing features against a running app: FF_BASE_URL=http://localhost:3210 npm run test:e2e */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e2-"));
const PNG = path.join(tmp, "magenta.png");
const FAKE = path.join(tmp, "not-really.png");

let browser: Browser;
let page: Page;
let projectId = "";

const getProject = async (): Promise<Project> => (await (await fetch(`${BASE}/api/projects/${projectId}`)).json()).project;
const scene0 = async () => (await getProject()).scenes[0];
const save = async () => {
  await page.keyboard.press("Control+s");
  const status = page.locator("[aria-live=polite]").first();
  await expect.poll(async () => (await status.textContent())?.trim(), { timeout: 10_000 }).toBe("Saved");
};
const xField = () => page.getByLabel("X", { exact: true });

beforeAll(async () => {
  // A solid magenta 320x180 PNG we can find again in the exported video.
  execFileSync(ffmpegPath(), ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xff00ff:s=320x180", "-frames:v", "1", PNG]);
  writeFileSync(FAKE, "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>");
  const res = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Day Two", template: "blank" }) });
  projectId = (await res.json()).project.id;
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/editor/${projectId}`);
  await page.locator("[data-stage]").waitFor();
});
afterAll(async () => {
  await browser?.close();
  // Leave no test projects behind (also removes their assets and datasets).
  if (projectId) await fetch(`${BASE}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
});

describe("Day 2 editing", () => {
  it("rejects a non-image disguised as .png", async () => {
    await page.getByRole("tab", { name: /Assets/ }).click();
    await page.getByLabel("Upload image files").setInputFiles(FAKE);
    // (Next.js also renders a role=alert route announcer, so match the message itself.)
    await page.getByRole("alert").filter({ hasText: "Unsupported file" }).waitFor({ timeout: 10_000 });
  });

  it("uploads an image and adds it to the scene at its aspect ratio", async () => {
    await page.getByLabel("Upload image files").setInputFiles(PNG);
    const thumb = page.getByRole("button", { name: /^Add image img_/ });
    await thumb.waitFor({ timeout: 15_000 });
    await thumb.click();
    await page.getByRole("heading", { name: "Image" }).waitFor();
    await save();
    const img = (await scene0()).elements.find((e) => e.type === "image");
    expect(img?.type === "image" && img.src).toMatch(/^asset:img_.+\.png$/);
    expect(img!.width / img!.height).toBeCloseTo(16 / 9, 1);
  });

  it("edits text in place on the canvas", async () => {
    await page.getByRole("tab", { name: /Elements/ }).click();
    await page.getByRole("button", { name: /Heading/ }).click();
    const heading = page.locator("[data-stage] [data-element-id]", { hasText: "Your headline" });
    const id = (await heading.getAttribute("data-element-id")) ?? "";
    const box = await heading.boundingBox();
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const editor = page.getByLabel("Edit text");
    await editor.waitFor();
    await editor.fill("Hello Ocean");
    await editor.press("Control+Enter");
    await expect.poll(() => editor.count()).toBe(0);
    await save();
    expect((await scene0()).elements.find((e) => e.id === id)).toMatchObject({ type: "text", text: "Hello Ocean" });
  });

  it("snaps to the canvas centre unless Alt is held", async () => {
    await page.getByRole("button", { name: /Rectangle/ }).click();
    expect(Number(await xField().inputValue())).toBe(780); // created centred
    const stage = (await page.locator("[data-stage]").boundingBox())!;
    const cx = stage.x + stage.width / 2;
    const cy = stage.y + stage.height / 2;
    // A 3px nudge is inside the snap threshold: the box stays centred.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3, cy, { steps: 3 });
    await page.mouse.up();
    expect(Number(await xField().inputValue())).toBe(780);
    // With Alt, the same nudge moves it.
    await page.keyboard.down("Alt");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3, cy, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    expect(Number(await xField().inputValue())).toBeGreaterThan(780);
  });

  it("duplicates with Ctrl+D", async () => {
    // The rectangle is still selected from the previous test.
    await save();
    const before = await page.locator("[data-stage] [data-element-id]").count();
    const rect = (await scene0()).elements.length;
    await page.keyboard.press("Control+d");
    await expect.poll(() => page.locator("[data-stage] [data-element-id]").count()).toBe(before + 1);
    await save();
    expect((await scene0()).elements.length).toBe(rect + 1);
  });

  it("drags a scene edge to change its duration", async () => {
    const handle = page.getByTitle("Drag to change duration").first();
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 45, hb.y + hb.height / 2, { steps: 6 }); // 45px ≈ 1000ms
    await page.mouse.up();
    await save();
    expect((await scene0()).durationMs).toBe(5000);
  });

  it("exports an MP4 that actually contains the uploaded image", async () => {
    const { job } = await (await fetch(`${BASE}/api/projects/${projectId}/export`, { method: "POST" })).json();
    let status = job.status;
    for (let i = 0; i < 240 && status !== "done" && status !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      status = (await (await fetch(`${BASE}/api/exports/${job.id}`)).json()).job.status;
    }
    expect(status).toBe("done");
    const mp4 = path.join(tmp, "out.mp4");
    writeFileSync(mp4, Buffer.from(await (await fetch(`${BASE}/api/exports/${job.id}/file`)).arrayBuffer()));
    // Last frame as raw RGB; sample a point inside the image but outside the shapes and text.
    const raw = execFileSync(ffmpegPath(), ["-v", "error", "-sseof", "-0.2", "-i", mp4, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 16 * 1024 * 1024 });
    const [w, x, y] = [1280, Math.round((500 / 1920) * 1280), Math.round((260 / 1080) * 720)];
    const i = (y * w + x) * 3;
    const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeGreaterThan(200);
    expect(readFileSync(mp4).length).toBeGreaterThan(10_000);
  });
});
