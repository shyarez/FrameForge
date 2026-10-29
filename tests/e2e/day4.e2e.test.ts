import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { renderBinding } from "@/lib/data/binding";
import { parseCsv } from "@/lib/data/csv";
import { profileTable } from "@/lib/data/profile";
import { computeCalc } from "@/lib/data/stats";
import { createScene, createText } from "@/lib/schema/factory";
import { chromePath } from "@/lib/server/render";
import type { Project, TextElement } from "@/lib/schema/project";

/** Day 4 evidence-aware updates against a running app: FF_BASE_URL=http://localhost:3210 npm run test:e2e */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.FF_SHOTS_DIR;
const SAMPLE = readFileSync(path.join(import.meta.dirname, "../../public/samples/sample_sales_2024.csv"), "utf8");
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e4-"));

// v2: North's revenue doubles in every month (units unchanged) → totals, share and trend change.
const V2 = SAMPLE.split("\n")
  .map((line, i) => {
    const cols = line.split(",");
    return i > 0 && cols[1] === "North" ? [cols[0], cols[1], cols[2], (Number(cols[3]) * 2).toFixed(2)].join(",") : line;
  })
  .join("\n");
// v3: the region column is removed → the comparison claims can no longer be computed.
const V3 = V2.split("\n")
  .map((line) => line.split(",").filter((_, j) => j !== 1).join(","))
  .join("\n");
const files = { v2: path.join(tmp, "sales_v2.csv"), v3: path.join(tmp, "sales_v3.csv") };
writeFileSync(files.v2, V2);
writeFileSync(files.v3, V3);

let browser: Browser;
let page: Page;
let projectId = "";
let datasetId = "";
const json = async (url: string, init?: RequestInit) => (await fetch(`${BASE}${url}`, init)).json();
const getProject = async (): Promise<Project> => (await json(`/api/projects/${projectId}`)).project;
const save = async () => {
  await page.keyboard.press("Control+s");
  const status = page.locator("[aria-live=polite]").first();
  await expect.poll(async () => (await status.textContent())?.trim(), { timeout: 10_000 }).toBe("Saved");
};
const textsOf = (p: Project, kind: string) =>
  Object.fromEntries(p.scenes.find((s) => s.generated?.kind === kind)!.elements.flatMap((e) => (e.type === "text" ? [[e.name, e.text]] : [])));

beforeAll(async () => {
  // Arrange through the API: a hand-made scene plus a generated story from the v1 sample.
  projectId = (await json("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Day Four", template: "blank" }) })).project.id;
  const form = new FormData();
  form.append("file", new File([SAMPLE], "sales.csv", { type: "text/csv" }));
  const { dataset } = await json(`/api/projects/${projectId}/datasets`, { method: "POST", body: form });
  datasetId = dataset.ref.id;
  const { story } = await json(`/api/projects/${projectId}/datasets/${datasetId}/story`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: dataset.suggested, aspectRatio: "16:9" }),
  });
  const p = await getProject();
  p.scenes = [createScene("Hand-made intro", { elements: [createText({ name: "Mine", text: "My own title" })] }), ...story.scenes];
  p.evidence = story.evidence;
  p.datasets = [dataset.ref];
  // A manual style tweak on a data-bound number; updates must keep it.
  const total = p.scenes.find((s) => s.generated?.kind === "metric")!.elements.find((e) => e.name === "Total") as TextElement;
  Object.assign(total, { color: "#ff77a8", fontSize: 300, styleLocked: true });
  await fetch(`${BASE}/api/projects/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });

  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/editor/${projectId}`);
  await page.locator("[data-stage]").waitFor();
  await page.getByRole("tab", { name: /Data/ }).click();
});
afterAll(async () => {
  await browser?.close();
});

describe("Day 4 evidence-aware updates", () => {
  let before: Project;

  it("reviews an update: changed claims, affected scenes, before/after", async () => {
    before = await getProject();
    await page.getByRole("button", { name: /^Update$/ }).click();
    await page.getByLabel("Upload new CSV version").setInputFiles(files.v2);
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/v1\s*v2/).waitFor({ timeout: 20_000 });
    await dialog.getByText("Claims changed").waitFor();
    // Total, mean, top share, group-by, trend and change all move; record counts do not.
    await dialog.getByText("Sum of revenue", { exact: true }).waitFor();
    expect(await dialog.getByRole("slider", { name: /Compare before and after/ }).count()).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(1600); // let the wipe animation run for the screenshot
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d4-review.png` });
  });

  it("applies the update: only data-bound content changes, and matches a fresh recomputation", async () => {
    await page.getByRole("dialog").getByRole("button", { name: /Apply update/ }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    await save();
    const after = await getProject();
    expect(after.datasets[0].version).toBe(2);
    const csv = parseCsv(V2);
    const table = profileTable(csv.headers, csv.rows);
    for (const e of after.evidence) {
      expect(e.datasetVersion).toBe(2);
      expect(computeCalc(table, e.calc), e.label).toEqual(e.result);
    }
    for (const sc of after.scenes) for (const el of sc.elements) if (el.type === "text" && el.binding) expect(el.text).toBe(renderBinding(el.binding));
    // Unrelated scene untouched; manual styling on the bound number kept; its text changed.
    expect(after.scenes[0]).toEqual(before.scenes[0]);
    const total = after.scenes.find((s) => s.generated?.kind === "metric")!.elements.find((e) => e.name === "Total") as TextElement;
    expect(total).toMatchObject({ color: "#ff77a8", fontSize: 300, styleLocked: true });
    expect(total.text).not.toBe(textsOf(before, "metric").Total);
    // Unchanged claims keep their text.
    expect(textsOf(after, "intro")["Record count"]).toBe(textsOf(before, "intro")["Record count"]);
    expect(after.evidence.find((e) => e.label === "Sum of revenue")!.previous?.datasetVersion).toBe(1);
  });

  it("detects an identical re-upload", async () => {
    await page.getByRole("button", { name: /^Update$/ }).click();
    await page.getByLabel("Upload new CSV version").setInputFiles(files.v2);
    await page.getByRole("status").filter({ hasText: "identical to version 2" }).waitFor({ timeout: 15_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  });

  it("marks scenes stale when a column they depend on disappears", async () => {
    await page.getByRole("button", { name: /^Update$/ }).click();
    await page.getByLabel("Upload new CSV version").setInputFiles(files.v3);
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/v2\s*v3/).waitFor({ timeout: 20_000 });
    await dialog.getByText(/can't be recomputed: Unknown column "region"/).first().waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d4-broken.png` });
    await dialog.getByRole("button", { name: /Apply update/ }).click();
    await save();
    const p = await getProject();
    const comparison = p.scenes.find((s) => s.generated?.kind === "comparison")!;
    expect(comparison.stale).toMatchObject({ version: 3 });
    await expect.poll(() => page.locator("button").filter({ hasText: /Comparison/ }).filter({ hasText: "Stale" }).count()).toBe(1);
  });

  it("evidence inspector lists claims and outlines them on the canvas", async () => {
    await page.getByRole("button", { name: /3\. Key metric/ }).click();
    await page.getByRole("tab", { name: /Evidence/ }).click();
    const card = page.locator("li", { hasText: "Sum of revenue" }).first();
    await card.waitFor();
    await card.getByText(/v1:/).waitFor(); // previous value shown
    await card.hover();
    await expect.poll(() => page.locator('[data-stage] div[style*="dashed"]').count()).toBeGreaterThan(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d4-evidence.png` });
  });

  it("still exports a verified MP4 after updates", async () => {
    const { job } = await json(`/api/projects/${projectId}/export`, { method: "POST" });
    let j = job;
    for (let i = 0; i < 400 && j.status !== "done" && j.status !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      j = (await json(`/api/exports/${job.id}`)).job;
    }
    expect(j.error).toBeUndefined();
    expect(j.probe.decodedOk).toBe(true);
  });
});
