import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/data/csv";
import { profileTable } from "@/lib/data/profile";
import { generateStory, suggestRoles } from "@/lib/data/story";
import { planUpdate } from "@/lib/data/update";
import { createProject, createScene, createShape, createText } from "@/lib/schema/factory";
import { ProjectSchema, type Project, type TextElement } from "@/lib/schema/project";

const V1 = `month,region,revenue
2024-01,North,100
2024-01,South,80
2024-02,North,120
2024-02,South,90
2024-03,North,150
2024-03,South,85
`;
// North's March revenue drops sharply: totals, shares and the trend change; South is the same.
const V2 = V1.replace("2024-03,North,150", "2024-03,North,40");
// The region column is gone: the comparison can no longer be computed.
const V3 = `month,revenue
2024-01,100
2024-01,80
2024-02,120
2024-02,90
2024-03,150
2024-03,85
`;

const table = (csv: string) => {
  const p = parseCsv(csv);
  return profileTable(p.headers, p.rows);
};
const ds = { id: "ds_update1234", name: "sales.csv", version: 1, hash: "h1" };
const ver = (csv: string, version: number, hash: string) => ({ version, hash, rowCount: table(csv).rowCount, columnCount: table(csv).headers.length });
const det = () => {
  let n = 0;
  return { now: "2026-01-01T00:00:00.000Z", id: (p: string) => `${p}_${String(++n).padStart(4, "0")}` };
};

/** A project with a manual scene plus a generated story, with some hand edits. */
function baseProject(): Project {
  const p = createProject("Update test", "16:9", "blank");
  const manual = createScene("My intro", { elements: [createText({ text: "Hand-made title" }), createShape()] });
  const story = generateStory(table(V1), ds, suggestRoles(table(V1)), "16:9", det());
  p.scenes = [manual, ...story.scenes];
  p.evidence = story.evidence;
  p.datasets = [{ id: ds.id, name: ds.name, version: 1, hash: "h1", rowCount: 6, columnCount: 3, addedAt: "2026-01-01T00:00:00.000Z" }];
  // Manual styling on a data-bound element must survive updates.
  const metric = p.scenes.find((s) => s.generated?.kind === "metric")!;
  const total = metric.elements.find((e) => e.name === "Total") as TextElement;
  Object.assign(total, { color: "#123456", fontSize: 333, x: 77, styleLocked: true });
  return p;
}

const texts = (p: Project, kind: string) =>
  Object.fromEntries(p.scenes.find((s) => s.generated?.kind === kind)!.elements.flatMap((e) => (e.type === "text" ? [[e.name, e.text]] : [])));

describe("planUpdate", () => {
  it("re-uploading identical data changes no content", () => {
    const p = baseProject();
    const { project, report } = planUpdate(p, ds.id, table(V1), ver(V1, 2, "h1"), "2026-02-01T00:00:00.000Z");
    expect(report.identical).toBe(true);
    expect(report.counts).toMatchObject({ evidenceChanged: 0, evidenceBroken: 0, elementsUpdated: 0, scenesUpdated: 0 });
    expect(JSON.stringify(project.scenes)).toBe(JSON.stringify(p.scenes));
  });

  it("refreshes exactly the affected claims to what a fresh analysis of the new data says", () => {
    const p = baseProject();
    const { project, report } = planUpdate(p, ds.id, table(V2), ver(V2, 2, "h2"), "2026-02-01T00:00:00.000Z");
    const fresh = generateStory(table(V2), { ...ds, version: 2, hash: "h2" }, suggestRoles(table(V2)), "16:9", det());
    const freshProject = { ...p, scenes: fresh.scenes };
    for (const kind of ["intro", "metric", "comparison", "trend", "summary"]) {
      const updated = texts(project, kind);
      for (const [name, text] of Object.entries(texts(freshProject, kind))) expect(updated[name], `${kind} › ${name}`).toBe(text);
    }
    // Charts carry the new data too.
    const chart = (pr: Project, kind: string) => pr.scenes.find((s) => s.generated?.kind === kind)!.elements.find((e) => e.type === "chart");
    expect(chart(project, "comparison")).toMatchObject({ data: chart(freshProject, "comparison")!.type === "chart" ? (chart(freshProject, "comparison") as { data: unknown }).data : [] });
    // The record count did not change, so its claim is unchanged; totals did.
    expect(report.evidence.find((e) => e.label === "Number of records")!.status).toBe("unchanged");
    expect(report.evidence.find((e) => e.label === "Sum of revenue")).toMatchObject({ status: "changed", before: "625", after: "515", deltaPct: -17.6, deltaKind: "relative" });
    // Percentage claims change by percentage points: North 370/625 = 59.2% → 260/515 = 50.5%.
    expect(report.evidence.find((e) => e.label.startsWith("Largest"))).toMatchObject({ status: "changed", deltaKind: "points", deltaPct: -8.7 });
    expect(project.evidence.every((e) => e.datasetVersion === 2 && e.datasetHash === "h2")).toBe(true);
    expect(project.evidence.find((e) => e.label === "Sum of revenue")!.previous).toMatchObject({ datasetVersion: 1, result: { kind: "scalar", value: 625 } });
    expect(project.datasets[0]).toMatchObject({ version: 2, hash: "h2" });
    // The applied update is recorded for evaluation, with the selectivity numbers.
    expect(project.updates).toHaveLength(1);
    expect(project.updates![0]).toMatchObject({ datasetId: ds.id, fromVersion: 1, toVersion: 2, evidenceChanged: report.counts.evidenceChanged, elementsUpdated: report.counts.elementsUpdated });
    expect(report.counts.elementsTotal).toBe(project.scenes.reduce((n, s) => n + s.elements.length, 0));
    expect(report.counts.elementsUpdated).toBeLessThan(report.counts.elementsTotal);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it("flips sign-dependent wording when the trend reverses", () => {
    expect(texts(baseProject(), "trend").Title).toBe("On the rise");
    const { project } = planUpdate(baseProject(), ds.id, table(V2), ver(V2, 2, "h2"), "t");
    expect(texts(project, "trend").Title).toBe("Losing ground");
  });

  it("preserves unrelated scenes, manual styling and hand-edited text", () => {
    const p = baseProject();
    // A hand-edited claim has no binding any more, so updates must leave it alone.
    const comparison = p.scenes.find((s) => s.generated?.kind === "comparison")!;
    const leader = comparison.elements.find((e) => e.name === "Leader") as TextElement;
    leader.text = "My own wording";
    delete leader.binding;
    const { project, report } = planUpdate(p, ds.id, table(V2), ver(V2, 2, "h2"), "t");
    expect(project.scenes[0]).toEqual(p.scenes[0]);
    const total = project.scenes.find((s) => s.generated?.kind === "metric")!.elements.find((e) => e.name === "Total") as TextElement;
    expect(total).toMatchObject({ color: "#123456", fontSize: 333, x: 77, styleLocked: true, text: "515" });
    expect((project.scenes.find((s) => s.generated?.kind === "comparison")!.elements.find((e) => e.name === "Leader") as TextElement).text).toBe("My own wording");
    expect(report.counts.scenesPreserved).toBeGreaterThanOrEqual(1);
    // Only data-bound fields differ between before and after for every element.
    for (const [i, sc] of project.scenes.entries()) {
      sc.elements.forEach((el, j) => {
        const was = p.scenes[i].elements[j];
        const strip = (e: object) => {
          const rest = { ...(e as Record<string, unknown>) };
          for (const k of ["text", "binding", "data"]) delete rest[k];
          return rest;
        };
        expect(strip(el), `${sc.name} › ${el.name}`).toEqual(strip(was));
      });
    }
  });

  it("marks scenes stale and keeps last good values when a claim can't be recomputed", () => {
    const p = baseProject();
    const { project, report } = planUpdate(p, ds.id, table(V3), ver(V3, 3, "h3"), "t");
    expect(report.counts.evidenceBroken).toBe(2); // group-by region and top share
    // Broken claims stay on the old version; healthy claims in the same (stale) scenes move on.
    const versions = Object.fromEntries(project.evidence.map((e) => [e.label, e.datasetVersion]));
    expect(versions["Number of records"]).toBe(3);
    expect(Object.entries(versions).filter(([, v]) => v === 1).map(([k]) => k).sort()).toEqual(["Largest region's share of total revenue", "Sum of revenue by region (top 6)"].sort());
    const comparison = project.scenes.find((s) => s.generated?.kind === "comparison")!;
    expect(comparison.stale).toMatchObject({ datasetId: ds.id, version: 3 });
    expect(comparison.stale!.reasons.join(" ")).toMatch(/Unknown column "region"/);
    expect(texts(project, "comparison")).toEqual(texts(p, "comparison"));
    // The summary also shows the top-share claim, so it is stale too; the metric scene still updated.
    expect(report.scenes.find((s) => s.name === "Summary")!.status).toBe("stale");
    expect(report.scenes.find((s) => s.name === "Key metric")!.status).toBe("unchanged"); // V3 sums match V1
    // A later fix clears the stale flag.
    const fixed = planUpdate(project, ds.id, table(V1), ver(V1, 4, "h1"), "t");
    expect(fixed.project.scenes.some((s) => s.stale)).toBe(false);
  });

  it("is deterministic", () => {
    const p = baseProject(); // ids are random per project, so run twice on the same input
    const snapshot = JSON.stringify(p);
    const a = planUpdate(p, ds.id, table(V2), ver(V2, 2, "h2"), "t");
    const b = planUpdate(p, ds.id, table(V2), ver(V2, 2, "h2"), "t");
    expect(JSON.stringify(p)).toBe(snapshot); // the input project is never mutated
    // Everything is deterministic except measured wall time in the update history.
    const untimed = (pr: Project) => JSON.stringify({ ...pr, updates: pr.updates?.map((u) => ({ ...u, durationMs: 0 })) });
    expect(untimed(a.project)).toBe(untimed(b.project));
    expect(JSON.stringify({ ...a.report, durationMs: 0 })).toBe(JSON.stringify({ ...b.report, durationMs: 0 }));
  });
});
