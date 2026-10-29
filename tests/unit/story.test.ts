import { describe, expect, it } from "vitest";
import { evidenceNumber, renderBinding } from "@/lib/data/binding";
import { parseCsv } from "@/lib/data/csv";
import { profileTable } from "@/lib/data/profile";
import { computeCalc } from "@/lib/data/stats";
import { generateStory, suggestRoles, validateRoles } from "@/lib/data/story";
import { createProject } from "@/lib/schema/factory";
import { ProjectSchema, type Evidence } from "@/lib/schema/project";
import { evaluateScene } from "@/lib/engine/evaluate";

const CSV = `month,region,revenue,order_id
2024-01,North,120,1
2024-01,South,80,2
2024-02,North,150,3
2024-02,South,90,4
2024-03,North,170,5
2024-03,East,60,6
2024-04,North,200,7
2024-04,South,,8
`;

const table = (csv = CSV) => {
  const p = parseCsv(csv);
  return profileTable(p.headers, p.rows);
};
const ds = { id: "ds_test12345", name: "quarterly_sales.csv", version: 1, hash: "abc" };
const det = () => {
  let n = 0;
  return { now: "2026-01-01T00:00:00.000Z", id: (p: string) => `${p}_${String(++n).padStart(4, "0")}` };
};

describe("role suggestion", () => {
  it("picks a measure, category and time column, skipping ids", () => {
    expect(suggestRoles(table())).toEqual({ measure: "revenue", category: "region", order: "month" });
  });
  it("validates user-chosen roles", () => {
    expect(validateRoles(table(), { measure: "region" })).toEqual(['"region" is not a numeric column']);
    expect(validateRoles(table(), { order: "revenue" })).toEqual(['"revenue" is not a date or period column']);
  });
});

describe("story generation", () => {
  const story = generateStory(table(), ds, suggestRoles(table()), "16:9", det());

  it("builds intro → metric → comparison → trend → summary", () => {
    expect(story.scenes.map((s) => s.generated?.kind)).toEqual(["intro", "metric", "comparison", "trend", "summary"]);
    expect(story.plan.find((p) => p.kind === "distribution")).toBeUndefined();
  });

  it("produces a valid, editable project document", () => {
    const p = createProject("t", "16:9", "blank");
    p.scenes = story.scenes;
    p.evidence = story.evidence;
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });

  it("derives every displayed number from evidence that recomputes to the same value", () => {
    const byId = new Map(story.evidence.map((e) => [e.id, e]));
    for (const sc of story.scenes) {
      for (const el of sc.elements) {
        if (el.type === "text" && el.binding) {
          el.binding.evidence.forEach((id, i) => {
            const e = byId.get(id)!;
            expect(e, id).toBeDefined();
            expect(el.binding!.values[i]).toBe(evidenceNumber(e));
            expect(e.sceneIds).toContain(sc.id);
          });
          expect(el.text).toBe(renderBinding(el.binding));
          // Narrative never contains digits that did not come from a binding value.
          // (The dataset file name is user metadata, not a statistic, so it is excluded from the check.)
          const stripped = el.binding.template.replace(/\{\d+(:\w+)?\}/g, "").replace(ds.name, "");
          expect(stripped, el.binding.template).not.toMatch(/\d/);
        }
        if (el.type === "chart" && el.binding) {
          const e = byId.get(el.binding.evidenceId)!;
          expect(e.result.kind === "series" && e.result.points).toEqual(el.data);
          expect(e.sceneIds).toContain(sc.id);
        }
      }
    }
    for (const e of story.evidence) expect(computeCalc(table(), e.calc)).toEqual(e.result);
  });

  it("states the real numbers", () => {
    const texts = story.scenes.flatMap((s) => s.elements.flatMap((e) => (e.type === "text" ? [e.text] : [])));
    expect(texts).toContain("870"); // 120+80+150+90+170+60+200, the missing value excluded
    expect(texts).toContain("Based on 7 of 8 records.");
    expect(texts).toContain("North leads with 73.6% of the total.");
    // Monthly sums 200 → 240 → 230 → 200: an honest "no change", not an invented trend.
    expect(texts).toContain("Revenue changed 0% from 2024-01 to 2024-04.");
    expect(texts).toContain("Holding steady");
  });

  it("records each evidence's dataset version and hash", () => {
    for (const e of story.evidence) expect(e).toMatchObject({ datasetId: ds.id, datasetVersion: 1, datasetHash: "abc" } satisfies Partial<Evidence>);
  });

  it("is deterministic for the same input", () => {
    const again = generateStory(table(), ds, suggestRoles(table()), "16:9", det());
    expect(JSON.stringify(again)).toBe(JSON.stringify(story));
  });

  it("count-up text animates through intermediate values and lands on the claim", () => {
    const metric = story.scenes[1];
    const total = metric.elements.find((e) => e.name === "Total")!;
    const mid = evaluateScene(metric, total.enter.delayMs + total.enter.durationMs / 3).elements.find((e) => e.element.id === total.id)!;
    expect(mid.text).toBeDefined();
    expect(Number(mid.text)).toBeLessThan(870);
    const end = evaluateScene(metric, metric.durationMs - 1).elements.find((e) => e.element.id === total.id)!;
    expect(end.text).toBeUndefined(); // falls back to the stored text "870"
  });
});

describe("only supported scenes", () => {
  it("falls back to a distribution when there is no time column", () => {
    const csv = "team,score\n" + Array.from({ length: 30 }, (_, i) => `${["A", "B", "C"][i % 3]},${(i * 37) % 100}`).join("\n");
    const st = generateStory(table(csv), ds, suggestRoles(table(csv)), "16:9", det());
    expect(st.scenes.map((s) => s.generated?.kind)).toEqual(["intro", "metric", "comparison", "distribution", "summary"]);
    expect(st.plan.find((p) => p.kind === "trend")).toMatchObject({ included: false, reason: "No date or period column" });
  });

  it("counts records when there is no numeric column", () => {
    const csv = "city,kind\nPune,a\nGoa,b\nPune,b\nGoa,a\nPune,a\n";
    const st = generateStory(table(csv), ds, suggestRoles(table(csv)), "1:1", det());
    expect(st.scenes.map((s) => s.generated?.kind)).toEqual(["intro", "comparison", "summary"]);
    expect(st.plan.find((p) => p.kind === "metric")).toMatchObject({ included: false });
  });

  it("lays out inside the canvas for every aspect ratio", () => {
    for (const aspect of ["16:9", "9:16", "1:1"] as const) {
      const st = generateStory(table(), ds, suggestRoles(table()), aspect, det());
      const size = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] }[aspect];
      for (const el of st.scenes.flatMap((s) => s.elements)) {
        expect(el.x, `${aspect} ${el.name}`).toBeGreaterThanOrEqual(0);
        expect(el.y + el.height, `${aspect} ${el.name}`).toBeLessThanOrEqual(size[1] + 1);
        expect(el.x + el.width, `${aspect} ${el.name}`).toBeLessThanOrEqual(size[0] + 1);
      }
    }
  });
});

describe("measure preference", () => {
  it("prefers money columns over volume columns regardless of column order", () => {
    const csv = "month,region,units,revenue\n2024-01,A,1,10\n2024-02,B,2,20\n2024-03,A,3,30\n";
    expect(suggestRoles(table(csv)).measure).toBe("revenue");
  });
});
