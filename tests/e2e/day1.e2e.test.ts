import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { chromePath } from "@/lib/server/render";
import type { Project } from "@/lib/schema/project";

/**
 * Drives the real UI against a running app: FF_BASE_URL=http://localhost:3210 npm run test:e2e
 * Screenshots go to FF_SHOTS_DIR when set.
 */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.FF_SHOTS_DIR;

let browser: Browser;
let page: Page;

const getProject = async (id: string): Promise<Project> => (await (await fetch(`${BASE}/api/projects/${id}`)).json()).project;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
});
let projectId = "";

afterAll(async () => {
  await browser?.close();
  // Leave no test projects behind (also removes their assets and datasets).
  if (projectId) await fetch(`${BASE}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
});

describe("Day 1 vertical slice", () => {

  it("creates a project from the dashboard and opens the editor", async () => {
    await page.goto(BASE);
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByLabel("Project name").fill("E2E Day One");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/editor\/prj_/);
    projectId = page.url().split("/editor/")[1];
    await page.locator("[data-stage]").waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor.png` });
    expect((await getProject(projectId)).name).toBe("E2E Day One");
  });

  it("adds a rectangle, drags it, and supports undo/redo", async () => {
    await page.getByRole("button", { name: /Rectangle/ }).click();
    await expect.poll(() => page.getByRole("tab", { name: "Element", exact: true, selected: true }).count()).toBe(1);

    const stage = await page.locator("[data-stage]").boundingBox();
    const cx = stage!.x + stage!.width / 2;
    const cy = stage!.y + stage!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 8 });
    await page.mouse.up();

    const xField = page.getByLabel("X", { exact: true });
    const movedX = Number(await xField.inputValue());
    expect(movedX).toBeGreaterThan(780); // created centred at x=780 on a 1920-wide canvas

    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    expect(Number(await xField.inputValue())).toBe(780);
    await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
    expect(Number(await xField.inputValue())).toBe(movedX);

    await page.keyboard.press("Control+s");
    await expect.poll(async () => page.getByText("Saved", { exact: true }).count(), { timeout: 10_000 }).toBe(1);
    const saved = await getProject(projectId);
    const rect = saved.scenes[0].elements.find((e) => e.name === "Rectangle");
    expect(rect?.x).toBe(movedX);
  });

  it("persists across reload", async () => {
    await page.reload();
    await page.locator("[data-stage]").waitFor();
    const saved = await getProject(projectId);
    const rect = saved.scenes[0].elements.find((e) => e.name === "Rectangle")!;
    await expect.poll(() => page.locator(`[data-stage] [data-element-id="${rect.id}"]`).count()).toBe(1);
  });

  it("adds and deletes scenes from the timeline", async () => {
    const before = (await getProject(projectId)).scenes.length;
    await page.getByRole("button", { name: "Add scene after selected" }).click();
    await page.getByRole("button", { name: "Delete scene" }).click();
    await page.getByRole("button", { name: "Add scene after selected" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await getProject(projectId)).scenes.length, { timeout: 10_000 }).toBe(before + 1);
  });

  it("exports a verified MP4 through the UI", async () => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("button", { name: "Start export" }).click();
    await page.getByText("Export complete").waitFor({ timeout: 240_000 });
    const verified = await page.getByText(/^Verified:/).textContent();
    expect(verified).toContain("h264 1280×720 @ 30fps");
    expect(verified).toContain("decoded without errors");
    const src = await page.locator("video").getAttribute("src");
    const res = await fetch(`${BASE}${src}`);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/export.png` });
  });

  it("renders the dashboard with the project card", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "E2E Day One" }).first().waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard.png` });
  });
});
