import { z } from "zod";
import { CalcResultSchema, CalcSpecSchema } from "@/lib/data/stats";

/**
 * FrameForge scene document, version 1.
 * Every project file on disk is validated against this schema on read and write.
 * Coordinates are in "logical canvas pixels" — see CANVAS_SIZES.
 */
export const SCHEMA_VERSION = 1 as const;

export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

/** Logical canvas size per aspect ratio. Export scales this to the output resolution. */
export const CANVAS_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export const AnimationPresetSchema = z.enum([
  "none",
  "fade",
  "slide-up",
  "slide-left",
  "scale",
  "pop",
]);
export type AnimationPreset = z.infer<typeof AnimationPresetSchema>;

export const EasingSchema = z.enum(["linear", "easeOut", "easeInOut", "backOut"]);
export type Easing = z.infer<typeof EasingSchema>;

export const AnimationSchema = z.object({
  preset: AnimationPresetSchema,
  delayMs: z.number().min(0).max(600_000),
  durationMs: z.number().min(0).max(600_000),
  easing: EasingSchema,
});
export type Animation = z.infer<typeof AnimationSchema>;

export const FontFamilySchema = z.enum(["display", "sans", "mono", "pixel", "arcade"]);
export type FontFamily = z.infer<typeof FontFamilySchema>;

const Color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Expected a hex color");

const ElementBase = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120),
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  enter: AnimationSchema,
  exit: AnimationSchema.optional(),
  /** Set when a user manually edits styling, so data updates never overwrite it. */
  styleLocked: z.boolean().optional(),
});

export const NumberFormatSchema = z.enum(["integer", "decimal", "compact", "percent", "signedPercent"]);

/**
 * Data binding for generated text. {0}, {1}… in the template are replaced with evidence values.
 * values/formats/units cache the resolved evidence so rendering (and count-up) stays a pure function
 * of the element; the evidence registry remains the source of truth and refreshes them on updates.
 */
export const TextBindingSchema = z.object({
  template: z.string().max(2000),
  evidence: z.array(z.string()).max(10),
  values: z.array(z.number()).max(10),
  formats: z.array(NumberFormatSchema).max(10),
  units: z.array(z.string().nullable()).max(10),
  /** String facts per evidence item for {i:key} tokens, e.g. { label: "North" } or { from: "2024-01", to: "2024-06" }. */
  strings: z.array(z.record(z.string(), z.string())).max(10),
  /** Animate the numbers counting up during the entrance animation. */
  countUp: z.boolean(),
});
export type TextBinding = z.infer<typeof TextBindingSchema>;

export const TextElementSchema = ElementBase.extend({
  type: z.literal("text"),
  text: z.string().max(5000),
  fontSize: z.number().min(4).max(800),
  fontWeight: z.number().int().min(100).max(900),
  fontFamily: FontFamilySchema,
  color: Color,
  align: z.enum(["left", "center", "right"]),
  lineHeight: z.number().min(0.5).max(4),
  binding: TextBindingSchema.optional(),
});

export const ShapeElementSchema = ElementBase.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse"]),
  fill: Color,
  radius: z.number().min(0),
  stroke: Color.optional(),
  strokeWidth: z.number().min(0),
});

export const ImageElementSchema = ElementBase.extend({
  type: z.literal("image"),
  /** Asset reference: "asset:<fileName>" (project-local upload) or a data: URL. Never a filesystem path. */
  src: z.string().max(10_000_000),
  fit: z.enum(["cover", "contain"]),
  radius: z.number().min(0),
});

export const ChartDatumSchema = z.object({ label: z.string().max(200), value: z.number() });

export const ChartElementSchema = ElementBase.extend({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "donut"]),
  data: z.array(ChartDatumSchema).max(200),
  colors: z.array(Color).min(1),
  textColor: Color,
  showValues: z.boolean(),
  /** Chart data comes from this evidence record (a series calculation). */
  binding: z.object({ evidenceId: z.string() }).optional(),
});

export const ElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ShapeElementSchema,
  ImageElementSchema,
  ChartElementSchema,
]);
export type SceneElement = z.infer<typeof ElementSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ChartElement = z.infer<typeof ChartElementSchema>;
export type ElementType = SceneElement["type"];

export const TransitionSchema = z.object({
  type: z.enum(["none", "fade", "slide"]),
  durationMs: z.number().min(0).max(5000),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120),
  durationMs: z.number().min(500).max(120_000),
  background: Color,
  /** Transition played when entering this scene from the previous one. */
  transition: TransitionSchema,
  elements: z.array(ElementSchema).max(300),
  /** Present on scenes produced by the data-story generator. */
  generated: z
    .object({
      datasetId: z.string(),
      kind: z.enum(["intro", "metric", "comparison", "trend", "distribution", "summary"]),
    })
    .optional(),
  /** Set when a dataset update could not refresh this scene (e.g. a column it uses was removed). */
  stale: z.object({ datasetId: z.string(), version: z.number().int(), reasons: z.array(z.string()) }).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ExportSettingsSchema = z.object({
  fps: z.union([z.literal(24), z.literal(30)]),
  /** Output height for landscape, or the short edge for portrait/square. */
  resolution: z.union([z.literal(720), z.literal(1080)]),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

/** A dataset attached to the project. The CSV itself is stored per version next to the project. */
export const DatasetRefSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  name: z.string().max(200),
  version: z.number().int().min(1),
  /** sha256 of the normalised CSV text of the current version. */
  hash: z.string(),
  rowCount: z.number().int().min(0),
  columnCount: z.number().int().min(0),
  addedAt: z.string(),
});
export type DatasetRef = z.infer<typeof DatasetRefSchema>;

/**
 * One numerical claim: which dataset version it came from, the exact calculation, the result,
 * and every scene that displays it.
 */
export const EvidenceSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  datasetVersion: z.number().int().min(1),
  datasetHash: z.string(),
  /** Human description of the calculation, e.g. "Sum of revenue". */
  label: z.string().max(300),
  calc: CalcSpecSchema,
  result: CalcResultSchema,
  format: NumberFormatSchema,
  unit: z.string().nullable(),
  sceneIds: z.array(z.string()),
  computedAt: z.string(),
  /** The value before the most recent dataset update, for before/after comparison. */
  previous: z.object({ datasetVersion: z.number().int().min(1), result: CalcResultSchema, computedAt: z.string() }).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** One applied dataset update, kept for evaluation (what changed vs what was preserved, and how fast). */
export const UpdateRecordSchema = z.object({
  datasetId: z.string(),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  at: z.string(),
  durationMs: z.number().min(0),
  evidenceChanged: z.number().int().min(0),
  evidenceUnchanged: z.number().int().min(0),
  evidenceBroken: z.number().int().min(0),
  scenesTotal: z.number().int().min(0),
  scenesUpdated: z.number().int().min(0),
  scenesStale: z.number().int().min(0),
  scenesPreserved: z.number().int().min(0),
  elementsUpdated: z.number().int().min(0),
  elementsTotal: z.number().int().min(0),
});
export type UpdateRecord = z.infer<typeof UpdateRecordSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  aspectRatio: AspectRatioSchema,
  scenes: z.array(SceneSchema).min(1).max(100),
  datasets: z.array(DatasetRefSchema),
  evidence: z.array(EvidenceSchema),
  /** Applied dataset updates, newest last (optional so older project files stay valid). */
  updates: z.array(UpdateRecordSchema).max(100).optional(),
  exportSettings: ExportSettingsSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export function projectDurationMs(project: Pick<Project, "scenes">): number {
  return project.scenes.reduce((sum, s) => sum + s.durationMs, 0);
}

/** Output pixel size for an export, keeping even dimensions for H.264. */
export function outputSize(aspect: AspectRatio, resolution: 720 | 1080) {
  const { width, height } = CANVAS_SIZES[aspect];
  const scale = resolution / Math.min(width, height);
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(width * scale), height: even(height * scale) };
}
