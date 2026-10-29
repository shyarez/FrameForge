import { describe, expect, it } from "vitest";
import { auditProject, type TableLoader } from "@/lib/data/audit";
import { parseCsv } from "@/lib/data/csv";
import { profileTable } from "@/lib/data/profile";
import { generateStory, suggestRoles } from "@/lib/data/story";
import { planUpdate } from "@/lib/data/update";
import { createChart, createProject, createScene, createText } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";

const V1 = "month,region,revenue\n2024-01,North,100\n2024-01,South,80\n2024-02,North,120\n2024-02,South,90\n2024-03,North,150\n2024-03,South,85\n";
const V2 = V1.replace("2024-03,North,150", "2024-03,North,40");
const table = (csv: string) => {
  const p = parseCsv(csv);
  return profileTable(p.headers, p.rows);
};
const ds = { id: "ds_audit12345", name: "sales.csv", version: 1, hash: "h1" };
const store: Record<number, string> = { 1: V1, 2: V2 };
const loader: TableLoader = (id, v) => (id === ds.id && store[v] ? table(store[v]) : null);

function project(): Project {
  const p = createProject("Audit", "16:9", "blank");
  const story = generateStory(table(V1), ds, suggestRoles(table(V1)), "16:9", { now: "t" });
  // A hand-made scene with an unverified number and a manual chart.
  p.scenes = [createScene("Manual", { elements: [createText({ name: "Typed", text: "Sales up 40%!" }), createChart({ name: "Manual chart" })] }), ...story.scenes];
  p.evidence = story.evidence;
  p.datasets = [{ id: ds.id, name: ds.name, version: 1, hash: "h1", rowCount: 6, columnCount: 3, addedAt: "t" }];
  return p;
}

describe("auditProject", () => {
  it("reproduces every claim from its stored dataset version", () => {
    const r = auditProject(project(), loader);
    expect(r.evidence.total).toBeGreaterThan(0);
    expect(r.evidence.reproduced).toBe(r.evidence.total);
    expect(r.evidence.mismatched).toEqual([]);
    expect(r.consistency.consistent).toBe(r.consistency.boundTexts);
  });

  it("flags unverified numbers and manual charts, and counts linked ones", () => {
    const r = auditProject(project(), loader);
    expect(r.claims.unlinkedTexts).toEqual([{ scene: "Manual", element: "Typed", text: "Sales up 40%!" }]);
    expect(r.claims.unlinkedCharts).toEqual([{ scene: "Manual", element: "Manual chart" }]);
    expect(r.claims.linkedTexts).toBe(r.claims.numericTexts - 1);
    expect(r.claims.linkedCharts).toBe(r.claims.charts - 1);
  });

  it("detects tampered values, missing versions and drifted text", () => {
    const p = project();
    const e = p.evidence.find((x) => x.label === "Sum of revenue")!;
    e.result = { kind: "scalar", value: 999 };
    p.evidence.find((x) => x.label === "Number of records")!.datasetVersion = 7;
    const total = p.scenes.flatMap((s) => s.elements).find((x) => x.name === "Total") as TextElement;
    total.text = "1 billion";
    const r = auditProject(p, loader);
    expect(r.evidence.mismatched.map((m) => m.label)).toEqual(["Sum of revenue"]);
    expect(r.evidence.unavailable).toEqual([expect.objectContaining({ label: "Number of records", reason: "Dataset version v7 is not stored" })]);
    expect(r.consistency.drifted).toEqual([expect.objectContaining({ element: "Total", shown: "1 billion", expected: "625" })]);
  });

  it("summarises applied updates (selectivity and speed)", () => {
    const { project: updated } = planUpdate(project(), ds.id, table(V2), { version: 2, hash: "h2", rowCount: 6, columnCount: 3 }, "t2");
    const r = auditProject(updated, loader);
    expect(r.evidence.reproduced).toBe(r.evidence.total); // after the update, every claim reproduces from v2
    expect(r.updates.count).toBe(1);
    expect(r.updates.avgElementsRefreshedPct).toBeGreaterThan(0);
    expect(r.updates.avgElementsRefreshedPct).toBeLessThan(100);
    expect(r.updates.avgScenesPreservedPct).toBeGreaterThan(0);
  });
});
