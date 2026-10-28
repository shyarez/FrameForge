import { nanoid } from "nanoid";
import type {
  Animation,
  AspectRatio,
  ChartElement,
  ElementType,
  ImageElement,
  Project,
  Scene,
  SceneElement,
  ShapeElement,
  TextElement,
} from "./project";
import { CANVAS_SIZES, SCHEMA_VERSION } from "./project";

export const newId = (prefix: string) => `${prefix}_${nanoid(10)}`;

export const PALETTE = {
  ink: "#0f0e2a",
  night: "#17163a",
  lavender: "#b8a4ff",
  blue: "#4d7cff",
  coral: "#ff6b6b",
  yellow: "#ffd166",
  mint: "#5ee6b5",
  paper: "#f7f4ff",
} as const;

export const anim = (
  preset: Animation["preset"],
  delayMs = 0,
  durationMs = 600,
  easing: Animation["easing"] = "easeOut",
): Animation => ({ preset, delayMs, durationMs, easing });

const base = (name: string, x: number, y: number, width: number, height: number) => ({
  id: newId("el"),
  name,
  x,
  y,
  width,
  height,
  rotation: 0,
  opacity: 1,
  enter: anim("fade"),
});

export function createText(partial: Partial<TextElement> = {}): TextElement {
  return {
    ...base("Text", 160, 160, 900, 140),
    type: "text",
    text: "Double-click to edit",
    fontSize: 72,
    fontWeight: 700,
    fontFamily: "display",
    color: PALETTE.paper,
    align: "left",
    lineHeight: 1.1,
    ...partial,
  };
}

export function createShape(partial: Partial<ShapeElement> = {}): ShapeElement {
  return {
    ...base("Shape", 200, 200, 360, 360),
    type: "shape",
    shape: "rect",
    fill: PALETTE.lavender,
    radius: 32,
    strokeWidth: 0,
    enter: anim("pop", 0, 700),
    ...partial,
  };
}

export function createImage(src: string, partial: Partial<ImageElement> = {}): ImageElement {
  return {
    ...base("Image", 240, 200, 640, 400),
    type: "image",
    src,
    fit: "cover",
    radius: 24,
    enter: anim("scale"),
    ...partial,
  };
}

export function createChart(partial: Partial<ChartElement> = {}): ChartElement {
  return {
    ...base("Chart", 260, 240, 1400, 640),
    type: "chart",
    chartType: "bar",
    data: [
      { label: "A", value: 12 },
      { label: "B", value: 19 },
      { label: "C", value: 7 },
      { label: "D", value: 15 },
    ],
    colors: [PALETTE.lavender, PALETTE.blue, PALETTE.coral, PALETTE.yellow],
    textColor: PALETTE.paper,
    showValues: true,
    enter: anim("fade", 200, 1200, "easeOut"),
    ...partial,
  };
}

export function createElement(type: ElementType, aspect: AspectRatio): SceneElement {
  const { width, height } = CANVAS_SIZES[aspect];
  const center = (w: number, h: number) => ({ x: Math.round((width - w) / 2), y: Math.round((height - h) / 2) });
  switch (type) {
    case "text":
      return createText({ ...center(Math.min(900, width - 160), 140), width: Math.min(900, width - 160) });
    case "shape":
      return createShape(center(360, 360));
    case "image":
      return createImage("", center(640, 400));
    case "chart": {
      const w = Math.min(1400, width - 160);
      return createChart({ ...center(w, 640), width: w });
    }
  }
}

export function createScene(name = "New scene", partial: Partial<Scene> = {}): Scene {
  return {
    id: newId("sc"),
    name,
    durationMs: 4000,
    background: PALETTE.ink,
    transition: { type: "fade", durationMs: 500 },
    elements: [],
    ...partial,
  };
}

export type TemplateId = "blank" | "launch";

/** A small, real starter so a new project exports something meaningful immediately. */
function launchScenes(aspect: AspectRatio): Scene[] {
  const { width, height } = CANVAS_SIZES[aspect];
  const pad = Math.round(width * 0.08);
  const textW = width - pad * 2;
  return [
    createScene("Title", {
      transition: { type: "none", durationMs: 0 },
      elements: [
        createShape({ name: "Sun", shape: "ellipse", fill: PALETTE.yellow, x: width - pad - 320, y: pad, width: 320, height: 320, enter: anim("pop", 100, 800) }),
        createShape({ name: "Block", fill: PALETTE.coral, x: pad, y: height - pad - 120, width: 240, height: 120, radius: 60, enter: anim("slide-left", 400, 700) }),
        createText({ name: "Headline", text: "Make something\nthat moves.", x: pad, y: Math.round(height * 0.32), width: textW, height: 300, fontSize: 128, lineHeight: 1.0, enter: anim("slide-up", 200, 800) }),
        createText({ name: "Subtitle", text: "Built with FrameForge Studio", fontFamily: "sans", fontWeight: 500, fontSize: 44, color: PALETTE.lavender, x: pad, y: Math.round(height * 0.32) + 320, width: textW, height: 70, enter: anim("fade", 700, 700) }),
      ],
    }),
    createScene("Chart", {
      background: PALETTE.night,
      transition: { type: "slide", durationMs: 600 },
      elements: [
        createText({ name: "Chart title", text: "Weekly momentum", fontSize: 80, x: pad, y: pad, width: textW, height: 110, enter: anim("slide-up", 0, 600) }),
        createChart({ x: pad, y: pad + 160, width: textW, height: height - pad * 2 - 180, enter: anim("fade", 300, 1400) }),
      ],
    }),
  ];
}

export function createProject(name: string, aspectRatio: AspectRatio = "16:9", template: TemplateId = "launch"): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId("prj"),
    name,
    createdAt: now,
    updatedAt: now,
    aspectRatio,
    scenes: template === "blank" ? [createScene("Scene 1", { transition: { type: "none", durationMs: 0 } })] : launchScenes(aspectRatio),
    datasets: [],
    evidence: [],
    exportSettings: { fps: 30, resolution: 720 },
  };
}
