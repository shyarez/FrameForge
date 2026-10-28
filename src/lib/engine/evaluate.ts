import type { Animation, Easing, Project, Scene, SceneElement } from "@/lib/schema/project";
import { CANVAS_SIZES } from "@/lib/schema/project";
import { renderTemplate } from "@/lib/data/format";

/**
 * Pure, deterministic animation evaluation.
 * The browser preview and the MP4 exporter both render exactly what these functions return,
 * so a given (project, timeMs) always produces the same frame.
 */

export interface ElementVisualState {
  element: SceneElement;
  visible: boolean;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  /** 0..1 data reveal progress used by charts (bars grow, lines draw). */
  reveal: number;
  /** Text to display when it differs from the stored text (count-up numbers mid-animation). */
  text?: string;
}

export interface SceneVisualState {
  scene: Scene;
  timeMs: number;
  elements: ElementVisualState[];
}

export interface SceneLayer {
  state: SceneVisualState;
  opacity: number;
  translateX: number;
}

export interface ProjectVisualState {
  sceneIndex: number;
  sceneStartMs: number;
  localMs: number;
  /** Bottom-to-top. During a transition the outgoing scene sits under the incoming one. */
  layers: SceneLayer[];
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function ease(easing: Easing, t: number): number {
  const x = clamp01(t);
  switch (easing) {
    case "linear":
      return x;
    case "easeOut":
      return 1 - Math.pow(1 - x, 3);
    case "easeInOut":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "backOut": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
  }
}

/** Linear progress of an animation window; 1 when duration is 0 and the window has started. */
function windowProgress(startMs: number, durationMs: number, timeMs: number): number {
  if (timeMs < startMs) return 0;
  if (durationMs <= 0) return 1;
  return clamp01((timeMs - startMs) / durationMs);
}

interface Transform {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
}

const IDENTITY: Transform = { opacity: 1, translateX: 0, translateY: 0, scale: 1 };

/** Transform for a preset at linear progress p (0 = hidden/start, 1 = at rest). */
export function presetTransform(anim: Animation, p: number): Transform {
  if (anim.preset === "none") return IDENTITY;
  const e = ease(anim.easing, p);
  switch (anim.preset) {
    case "fade":
      return { ...IDENTITY, opacity: e };
    case "slide-up":
      return { ...IDENTITY, opacity: clamp01(e), translateY: (1 - e) * 80 };
    case "slide-left":
      return { ...IDENTITY, opacity: clamp01(e), translateX: (1 - e) * 140 };
    case "scale":
      return { ...IDENTITY, opacity: clamp01(e), scale: 0.6 + 0.4 * e };
    case "pop":
      // Pop always overshoots, independent of the chosen easing.
      return { ...IDENTITY, opacity: clamp01(p * 2.5), scale: Math.max(0, ease("backOut", p)) };
  }
}

export function evaluateElement(el: SceneElement, sceneDurationMs: number, timeMs: number): ElementVisualState {
  const enterP = windowProgress(el.enter.delayMs, el.enter.durationMs, timeMs);
  const enter = presetTransform(el.enter, enterP);

  let exit = IDENTITY;
  if (el.exit && el.exit.preset !== "none") {
    // exit.delayMs is measured back from the end of the scene.
    const exitStart = sceneDurationMs - el.exit.delayMs - el.exit.durationMs;
    const exitP = windowProgress(exitStart, el.exit.durationMs, timeMs);
    exit = presetTransform(el.exit, 1 - exitP);
  }

  const opacity = clamp01(el.opacity * enter.opacity * exit.opacity);
  const reveal = el.enter.preset === "none" ? 1 : ease(el.enter.easing === "backOut" ? "easeOut" : el.enter.easing, enterP);
  let text: string | undefined;
  if (el.type === "text" && el.binding?.countUp && reveal < 1) {
    const b = el.binding;
    text = renderTemplate(b.template, b.values.map((v) => v * reveal), b.formats, (i) => b.units[i] ?? undefined, b.strings);
  }
  return {
    element: el,
    visible: opacity > 0.001,
    opacity,
    translateX: enter.translateX + exit.translateX,
    translateY: enter.translateY + exit.translateY,
    scale: enter.scale * exit.scale,
    reveal,
    text,
  };
}

export function evaluateScene(scene: Scene, timeMs: number): SceneVisualState {
  const t = Math.max(0, Math.min(timeMs, scene.durationMs));
  return {
    scene,
    timeMs: t,
    elements: scene.elements.map((el) => evaluateElement(el, scene.durationMs, t)),
  };
}

export function sceneStartTimes(project: Pick<Project, "scenes">): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const s of project.scenes) {
    starts.push(acc);
    acc += s.durationMs;
  }
  return starts;
}

export function evaluateProject(project: Project, globalMs: number): ProjectVisualState {
  const starts = sceneStartTimes(project);
  const total = starts[starts.length - 1] + project.scenes[project.scenes.length - 1].durationMs;
  const t = Math.max(0, Math.min(globalMs, total));

  let index = project.scenes.length - 1;
  for (let i = 0; i < project.scenes.length; i++) {
    if (t < starts[i] + project.scenes[i].durationMs) {
      index = i;
      break;
    }
  }

  const scene = project.scenes[index];
  const localMs = t - starts[index];
  const current = evaluateScene(scene, localMs);
  const layers: SceneLayer[] = [];

  const tr = scene.transition;
  if (index > 0 && tr.type !== "none" && tr.durationMs > 0 && localMs < tr.durationMs) {
    const prev = project.scenes[index - 1];
    const p = ease("easeInOut", localMs / tr.durationMs);
    const width = CANVAS_SIZES[project.aspectRatio].width;
    layers.push({
      state: evaluateScene(prev, prev.durationMs),
      opacity: 1,
      translateX: tr.type === "slide" ? -p * width : 0,
    });
    layers.push({
      state: current,
      opacity: tr.type === "fade" ? p : 1,
      translateX: tr.type === "slide" ? (1 - p) * width : 0,
    });
  } else {
    layers.push({ state: current, opacity: 1, translateX: 0 });
  }

  return { sceneIndex: index, sceneStartMs: starts[index], localMs, layers };
}

/** A time inside the scene where all entrance animations have finished — the editor's "edit pose". */
export function sceneRestTime(scene: Scene): number {
  const enterEnd = Math.max(0, ...scene.elements.map((e) => (e.enter.preset === "none" ? 0 : e.enter.delayMs + e.enter.durationMs)));
  const exitStart = Math.min(
    scene.durationMs,
    ...scene.elements.map((e) => (e.exit && e.exit.preset !== "none" ? scene.durationMs - e.exit.delayMs - e.exit.durationMs : scene.durationMs)),
  );
  const t = Math.max(Math.min(enterEnd, exitStart - 1), scene.transition.durationMs);
  return Math.max(0, Math.min(t, scene.durationMs - 1));
}

/** Timestamps (ms) for every frame of an export. Integer frame indices avoid float drift. */
export function frameTimes(totalMs: number, fps: number): number[] {
  const count = Math.max(1, Math.ceil((totalMs / 1000) * fps));
  return Array.from({ length: count }, (_, i) => (i * 1000) / fps);
}
