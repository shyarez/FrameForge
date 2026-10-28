import { z } from "zod";

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

export const FontFamilySchema = z.enum(["display", "sans", "mono"]);
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

export const TextElementSchema = ElementBase.extend({
  type: z.literal("text"),
  text: z.string().max(5000),
  fontSize: z.number().min(4).max(800),
  fontWeight: z.number().int().min(100).max(900),
  fontFamily: FontFamilySchema,
  color: Color,
  align: z.enum(["left", "center", "right"]),
  lineHeight: z.number().min(0.5).max(4),
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
});
export type Scene = z.infer<typeof SceneSchema>;

export const ExportSettingsSchema = z.object({
  fps: z.union([z.literal(24), z.literal(30)]),
  /** Output height for landscape, or the short edge for portrait/square. */
  resolution: z.union([z.literal(720), z.literal(1080)]),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

/** Dataset and evidence records are filled in by the data-storytelling layer (Day 3/4). */
export const DatasetRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().min(1),
  hash: z.string(),
});

export const EvidenceRefSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  datasetHash: z.string(),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  aspectRatio: AspectRatioSchema,
  scenes: z.array(SceneSchema).min(1).max(100),
  datasets: z.array(DatasetRefSchema),
  evidence: z.array(EvidenceRefSchema),
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
