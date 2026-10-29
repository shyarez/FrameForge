/**
 * FrameForge evaluation benchmark: `npm run eval`
 * Measures the data-storytelling pipeline and the evidence-aware update engine on seeded synthetic
 * data, checks correctness, and writes docs/EVALUATION.md. Deterministic data; timings vary by machine.
 */
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditProject } from "@/lib/data/audit";
import { parseCsv } from "@/lib/data/csv";
import { profileTable, type Table } from "@/lib/data/profile";
import { generateStory, suggestRoles } from "@/lib/data/story";
import { planUpdate } from "@/lib/data/update";
import { createProject, createScene, createText } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";

const RUNS = 5;
const REGIONS = ["North", "South", "East", "West", "Central", "Coast", "Hills", "Islands"];

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

/** Seeded sales-like CSV: daily dates over two years, 8 regions, units and revenue (~2% missing). */
function makeCsv(rows: number, seed = 7): string {
  const r = rng(seed);
  const lines = ["date,region,units,revenue"];
  const start = Date.UTC(2023, 0, 1);
  for (let i = 0; i < rows; i++) {
    const d = new Date(start + Math.floor((i / rows) * 730) * 86_400_000).toISOString().slice(0, 10);
    const region = REGIONS[Math.floor(r() * REGIONS.length)];
    const units = 1 + Math.floor(r() * 40);
    const revenue = r() < 0.02 ? "" : (units * (18 + r() * 12)).toFixed(2);
    lines.push(`${d},${region},${units},${revenue}`);
  }
  return lines.join("\n") + "\n";
}

const tableOf = (csv: string): Table => {
  const p = parseCsv(csv);
  return profileTable(p.headers, p.rows);
};

function median(f: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    f();
    times.push(performance.now() - t);
  }
  return Math.round(times.sort((a, b) => a - b)[Math.floor(RUNS / 2)] * 100) / 100;
}

const ds = (version: number, hash: string) => ({ id: "ds_benchmark01", name: "synthetic_sales.csv", version, hash });
const det = () => {
  let n = 0;
  return { now: "2026-01-01T00:00:00.000Z", id: (p: string) => `${p}_${String(++n).padStart(5, "0")}` };
};

// ---------------------------------------------------------------- 1. Pipeline speed
const pipeline: { rows: number; bytes: number; parse: number; profile: number; story: number; claims: number; scenes: number }[] = [];
for (const rows of [1_000, 10_000, 50_000]) {
  const csv = makeCsv(rows);
  const parsed = parseCsv(csv);
  const table = profileTable(parsed.headers, parsed.rows);
  const roles = suggestRoles(table);
  const story = generateStory(table, ds(1, "h1"), roles, "16:9", det());
  pipeline.push({
    rows,
    bytes: csv.length,
    parse: median(() => parseCsv(csv)),
    profile: median(() => profileTable(parsed.headers, parsed.rows)),
    story: median(() => generateStory(table, ds(1, "h1"), roles, "16:9", det())),
    claims: story.evidence.length,
    scenes: story.scenes.length,
  });
}

// ---------------------------------------------------------------- 2. Update scenarios
const BASE_ROWS = 10_000;
const base = makeCsv(BASE_ROWS);
const baseTable = tableOf(base);
const roles = suggestRoles(baseTable);

/** Project = one hand-made scene + generated story, with manual styling on two bound elements. */
function baseProject(): Project {
  const p = createProject("Benchmark", "16:9", "blank");
  const story = generateStory(baseTable, ds(1, "h1"), roles, "16:9", det());
  p.scenes = [createScene("Hand-made intro", { elements: [createText({ name: "Mine", text: "Our year in review" })] }), ...story.scenes];
  p.evidence = story.evidence;
  p.datasets = [{ id: "ds_benchmark01", name: "synthetic_sales.csv", version: 1, hash: "h1", rowCount: BASE_ROWS, columnCount: 4, addedAt: "t" }];
  for (const name of ["Total", "Leader"]) {
    const el = p.scenes.flatMap((s) => s.elements).find((e) => e.name === name) as TextElement;
    Object.assign(el, { color: "#123456", fontSize: 99, styleLocked: true });
  }
  return p;
}

const editLines = (csv: string, f: (cols: string[], i: number) => string[] | null) =>
  csv
    .trimEnd()
    .split("\n")
    .flatMap((line, i) => {
      if (i === 0) return [line];
      const out = f(line.split(","), i);
      return out ? [out.join(",")] : [];
    })
    .join("\n") + "\n";

const scenarios: { name: string; csv: string; breaking?: boolean }[] = [
  { name: "Identical re-upload", csv: base },
  { name: "One cell edited", csv: editLines(base, (c, i) => (i === 5000 && c[3] ? [c[0], c[1], c[2], (Number(c[3]) + 50).toFixed(2)] : c)) },
  { name: "One region doubled", csv: editLines(base, (c) => (c[1] === "North" && c[3] ? [c[0], c[1], c[2], (Number(c[3]) * 2).toFixed(2)] : c)) },
  { name: "10% more rows", csv: base + makeCsv(BASE_ROWS / 10, 99).split("\n").slice(1).join("\n") },
  { name: "Column removed (region)", csv: editLines(base.replace("date,region,", "date,"), (c) => [c[0], c[2], c[3]]).replace(/^date,units,revenue\n/, "date,units,revenue\n"), breaking: true },
];
// Header for the removed-column case is rewritten above; rebuild it cleanly.
scenarios[4].csv = "date,units,revenue\n" + scenarios[4].csv.split("\n").slice(1).join("\n");

const textMap = (p: Project) => new Map(p.scenes.flatMap((s) => s.elements.flatMap((e) => (e.type === "text" ? [[`${s.generated?.kind ?? s.name}/${e.name}`, e.text] as const] : []))));

const updates = scenarios.map((sc, idx) => {
  const table = tableOf(sc.csv);
  const p = baseProject();
  const next = { version: 2, hash: idx === 0 ? "h1" : `h${idx + 2}`, rowCount: table.rowCount, columnCount: table.headers.length };
  const { project, report } = planUpdate(p, "ds_benchmark01", table, next, "t2");
  // Build the input projects before timing, so only the update itself is measured.
  const inputs = Array.from({ length: RUNS }, () => baseProject());
  let run = 0;
  const planMs = median(() => planUpdate(inputs[run++], "ds_benchmark01", table, next, "t2"));
  const fullMs = sc.breaking ? null : median(() => generateStory(table, ds(2, "h"), roles, "16:9", det()));

  // Correctness: every refreshed (non-stale) scene says exactly what a fresh analysis says.
  let checked = 0;
  let correct = 0;
  if (!sc.breaking) {
    const fresh = generateStory(table, ds(2, next.hash), roles, "16:9", det());
    const want = textMap({ ...p, scenes: fresh.scenes });
    const got = textMap(project);
    for (const [k, v] of want) {
      checked++;
      if (got.get(k) === v) correct++;
    }
  }
  // Preservation: hand-made scene byte-identical, manual styling kept.
  const manualKept = JSON.stringify(project.scenes[0]) === JSON.stringify(p.scenes[0]);
  const styled = project.scenes.flatMap((s) => s.elements).filter((e) => e.type === "text" && e.styleLocked) as TextElement[];
  const styleKept = styled.length === 2 && styled.every((e) => e.color === "#123456" && e.fontSize === 99);
  // Reproducibility of the resulting project from the data it records.
  const audit = auditProject(project, (_id, v) => (v === 2 ? table : v === 1 ? baseTable : null));
  return { name: sc.name, report, planMs, fullMs, checked, correct, manualKept, styleKept, audit };
});

// ---------------------------------------------------------------- Output
const cpu = os.cpus()[0]?.model.trim() ?? "unknown CPU";
const fmtMs = (n: number | null) => (n === null ? "—" : `${n} ms`);
const lines: string[] = [];
lines.push("# FrameForge Studio — Evaluation", "");
lines.push(`Generated by \`npm run eval\` on ${new Date().toISOString().slice(0, 10)} · Node ${process.version} · ${cpu} · ${os.cpus().length} threads.`);
lines.push("", "Data is synthetic and seeded (reproducible). Timings are the median of " + RUNS + " runs and will differ on other machines.", "");
lines.push("## 1. Data pipeline speed", "");
lines.push("| Rows | CSV size | Parse | Profile columns | Generate story (all statistics) | Claims | Scenes |", "|---:|---:|---:|---:|---:|---:|---:|");
for (const r of pipeline) lines.push(`| ${r.rows.toLocaleString()} | ${(r.bytes / 1024).toFixed(0)} KB | ${fmtMs(r.parse)} | ${fmtMs(r.profile)} | ${fmtMs(r.story)} | ${r.claims} | ${r.scenes} |`);
lines.push("", `## 2. Evidence-aware updates (${BASE_ROWS.toLocaleString()}-row base)`, "");
lines.push("The project has one hand-made scene plus the generated story, with manual styling on two data-bound elements.", "");
lines.push(
  "| Change | Claims changed / unchanged / broken | Elements refreshed | Scenes preserved | Stale scenes | Update plan | Full regeneration | Claims match fresh analysis | Manual work preserved | Claims reproduce |",
  "|---|---|---:|---:|---:|---:|---:|---:|---|---:|",
);
for (const u of updates) {
  const c = u.report.counts;
  lines.push(
    `| ${u.name} | ${c.evidenceChanged} / ${c.evidenceUnchanged} / ${c.evidenceBroken} | ${c.elementsUpdated} of ${c.elementsTotal} | ${c.scenesPreserved} of ${c.scenesTotal} | ${c.scenesStale} | ${fmtMs(u.planMs)} | ${fmtMs(u.fullMs)} | ${u.checked ? `${u.correct}/${u.checked}` : "n/a (breaking)"} | ${u.manualKept && u.styleKept ? "yes" : "NO"} | ${u.audit.evidence.reproduced}/${u.audit.evidence.total} |`,
  );
}
lines.push("", "**Reading the table**", "");
lines.push("- *Full regeneration* is generating a brand-new story from the new data. It is similar in speed, but it discards every manual edit; the update keeps them while refreshing only data-bound content.");
lines.push("- *Claims match fresh analysis* compares every data-bound text after the update with a fresh analysis of the new data.");
lines.push("- *Claims reproduce* re-runs every stored calculation against the dataset version it records.");
lines.push("- For the breaking change, affected scenes are marked stale with reasons instead of guessing, and their last good values are kept.");
lines.push("", "## 3. Limits", "");
lines.push("- Scene **content** updates selectively. **Video rendering does not**: every export re-renders all frames (no segment caching). Export speed is recorded per project in the editor's Evaluation panel.");
lines.push("- Narration uses deterministic templates; no LLM is involved, so no statistic can come from a model.");

const out = path.join(import.meta.dirname, "..", "docs", "EVALUATION.md");
writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote ${out}`);

const failed = updates.filter((u) => !u.manualKept || !u.styleKept || u.correct !== u.checked || u.audit.evidence.reproduced !== u.audit.evidence.total);
if (failed.length) {
  console.error(`\nFAILED checks: ${failed.map((f) => f.name).join(", ")}`);
  process.exit(1);
}
