import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { renderBinding } from "@/lib/data/binding";
import { parseCsv } from "@/lib/data/csv";
import { profileTable } from "@/lib/data/profile";
import { computeCalc } from "@/lib/data/stats";
import { chromePath } from "@/lib/server/render";
import { projectDurationMs, type Project } from "@/lib/schema/project";

/** Day 3 data storytelling against a running app: FF_BASE_URL=http://localhost:3210 npm run test:e2e */
const BASE = process.env.FF_BASE_URL ?? "http://localhost:3000";
const SAMPLE = path.join(import.meta.dirname, "../../public/samples/sample_sales_2024.csv");
const SHOTS = process.env.FF_SHOTS_DIR;
const tmp = mkdtempSync(path.join(tmpdir(), "ff-e2e3-"));

let browser: Browser;
let page: Page;
let projectId = "";
const getProject = async (): Promise<Project> => (await (await fetch(`${BASE}/api/projects/${projectId}`)).json()).project;
const save = async () => {
  await page.keyboard.press("Control+s");
  const status = page.locator("[aria-live=polite]").first();
  await expect.poll(async () => (await status.textContent())?.trim(), { timeout: 10_000 }).toBe("Saved");
};

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Day Three", template: "blank" }) });
  projectId = (await res.json()).project.id;
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/editor/${projectId}`);
  await page.locator("[data-stage]").waitFor();
  await page.getByRole("tab", { name: /Data/ }).click();
});
afterAll(async () => {
  await browser?.close();
  // Leave no test projects behind (also removes their assets and datasets).
  if (projectId) await fetch(`${BASE}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
});

describe("Day 3 data storytelling", () => {
  it("rejects an invalid CSV with a clear message", async () => {
    const bad = path.join(tmp, "header-only.csv");
    writeFileSync(bad, "a,b,c\n");
    await page.getByLabel("Upload CSV file").setInputFiles(bad);
    await page.getByRole("alert").filter({ hasText: "no data rows" }).waitFor({ timeout: 10_000 });
  });

  it("uploads a CSV and previews typed columns with suggested roles", async () => {
    await page.getByLabel("Upload CSV file").setInputFiles(SAMPLE);
    const dialog = page.getByRole("dialog", { name: /sample_sales_2024/ });
    await dialog.waitFor({ timeout: 15_000 });
    await expect.poll(() => dialog.locator("table tbody tr").count()).toBe(25);
    for (const t of ["month", "region", "units", "revenue"]) await dialog.getByText(t, { exact: true }).first().waitFor();
    expect(await dialog.getByLabel("Measure (numbers)").inputValue()).toBe("revenue");
    expect(await dialog.getByLabel("Compare by (category)").inputValue()).toBe("region");
    expect(await dialog.getByLabel("Over time (date/period)").inputValue()).toBe("month");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d3-preview.png` });
  });

  it("generates a storyboard and inserts editable scenes", async () => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Generate storyboard" }).click();
    await dialog.getByText(/Storyboard: 5 scenes · 8 evidence records/).waitFor({ timeout: 15_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d3-plan.png` });
    await dialog.getByRole("button", { name: /Insert 5 scenes/ }).click();
    await expect.poll(() => dialog.count()).toBe(0);
    await save();
    const p = await getProject();
    expect(p.scenes.map((s) => s.generated?.kind ?? "manual")).toEqual(["manual", "intro", "metric", "comparison", "trend", "summary"]);
    expect(p.datasets).toHaveLength(1);
    expect(p.evidence).toHaveLength(8);
  });

  it("every saved claim matches an independent recomputation from the CSV", async () => {
    const p = await getProject();
    const csv = parseCsv(readFileSync(SAMPLE, "utf8"));
    const table = profileTable(csv.headers, csv.rows);
    for (const e of p.evidence) {
      expect(e.datasetHash).toBe(p.datasets[0].hash);
      expect(computeCalc(table, e.calc), e.label).toEqual(e.result);
      expect(e.sceneIds.length).toBeGreaterThan(0);
    }
    const texts: string[] = [];
    for (const sc of p.scenes) for (const el of sc.elements) if (el.type === "text" && el.binding) {
      expect(el.text).toBe(renderBinding(el.binding));
      texts.push(el.text);
    }
    // Spot-check headline numbers against a direct sum of the file.
    const revenue = csv.rows.reduce((s, r) => s + Number(r[3]), 0);
    expect(texts).toContain(`${(revenue / 1000).toFixed(1)}K`);
  });

  it("shows the evidence behind a selected number", async () => {
    await page.getByRole("button", { name: /3\. Key metric/ }).click();
    await page.getByRole("button", { name: /^Total\b/ }).click(); // layers list entry ("Total" + its animation tag)
    await page.getByRole("heading", { name: "Evidence" }).waitFor();
    await page.getByText("Sum of revenue").waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d3-metric.png` });
    await page.getByRole("button", { name: /4\. Comparison/ }).click();
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d3-comparison.png` });
  });

  it("exports the generated story to a verified MP4", async () => {
    const p = await getProject();
    const { job } = await (await fetch(`${BASE}/api/projects/${projectId}/export`, { method: "POST" })).json();
    let j = job;
    for (let i = 0; i < 400 && j.status !== "done" && j.status !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      j = (await (await fetch(`${BASE}/api/exports/${job.id}`)).json()).job;
    }
    expect(j.error).toBeUndefined();
    expect(j.status).toBe("done");
    expect(j.probe.decodedOk).toBe(true);
    expect(j.probe.durationSec).toBeCloseTo(projectDurationMs(p) / 1000, 0);
  });
});
