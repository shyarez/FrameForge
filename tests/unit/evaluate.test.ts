import { describe, expect, it } from "vitest";
import { ease, evaluateElement, evaluateProject, evaluateScene, frameTimes } from "@/lib/engine/evaluate";
import { anim, createProject, createScene, createShape, createText } from "@/lib/schema/factory";
import { ProjectSchema, outputSize, projectDurationMs } from "@/lib/schema/project";

describe("easing", () => {
  it("hits endpoints for every curve", () => {
    for (const e of ["linear", "easeOut", "easeInOut", "backOut"] as const) {
      expect(ease(e, 0)).toBeCloseTo(0, 6);
      expect(ease(e, 1)).toBeCloseTo(1, 6);
    }
  });
  it("backOut overshoots", () => {
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => ease("backOut", i / 100)))).toBeGreaterThan(1);
  });
});

describe("evaluateElement", () => {
  it("is hidden before its delay and at rest after its animation", () => {
    const el = createText({ enter: anim("slide-up", 500, 1000) });
    const before = evaluateElement(el, 4000, 200);
    expect(before.visible).toBe(false);
    const after = evaluateElement(el, 4000, 1600);
    expect(after).toMatchObject({ opacity: 1, translateX: 0, translateY: 0, scale: 1, visible: true });
  });

  it("each preset moves the expected channel mid-animation", () => {
    const mid = (preset: Parameters<typeof anim>[0]) => evaluateElement(createShape({ enter: anim(preset, 0, 1000, "linear") }), 4000, 500);
    expect(mid("fade").opacity).toBeCloseTo(0.5);
    expect(mid("slide-up").translateY).toBeCloseTo(40);
    expect(mid("slide-left").translateX).toBeCloseTo(70);
    expect(mid("scale").scale).toBeCloseTo(0.8);
    expect(mid("pop").scale).toBeGreaterThan(1); // overshoot phase
    expect(mid("none").opacity).toBe(1);
  });

  it("applies exit animations measured from scene end", () => {
    const el = createShape({ enter: anim("none"), exit: anim("fade", 0, 1000, "linear") });
    expect(evaluateElement(el, 4000, 2900).opacity).toBe(1);
    expect(evaluateElement(el, 4000, 3500).opacity).toBeCloseTo(0.5);
    expect(evaluateElement(el, 4000, 4000).visible).toBe(false);
  });

  it("respects base opacity", () => {
    expect(evaluateElement(createShape({ opacity: 0.4, enter: anim("none") }), 4000, 0).opacity).toBeCloseTo(0.4);
  });
});

describe("evaluateScene / evaluateProject", () => {
  it("is deterministic: same input gives identical output", () => {
    const p = createProject("Det");
    for (const t of [0, 123.456, 999, 4100, 7999]) {
      expect(JSON.stringify(evaluateProject(p, t))).toBe(JSON.stringify(evaluateProject(p, t)));
    }
  });

  it("clamps scene time", () => {
    const s = createScene("S", { durationMs: 2000 });
    expect(evaluateScene(s, -50).timeMs).toBe(0);
    expect(evaluateScene(s, 9999).timeMs).toBe(2000);
  });

  it("locates scenes and layers transitions", () => {
    const p = createProject("T", "16:9", "blank");
    p.scenes = [
      createScene("A", { durationMs: 2000, transition: { type: "none", durationMs: 0 } }),
      createScene("B", { durationMs: 3000, transition: { type: "fade", durationMs: 1000 } }),
    ];
    const atA = evaluateProject(p, 1000);
    expect(atA.sceneIndex).toBe(0);
    expect(atA.layers).toHaveLength(1);

    const midFade = evaluateProject(p, 2500);
    expect(midFade.sceneIndex).toBe(1);
    expect(midFade.localMs).toBe(500);
    expect(midFade.layers).toHaveLength(2);
    expect(midFade.layers[0].state.scene.name).toBe("A");
    expect(midFade.layers[1].opacity).toBeCloseTo(0.5);

    const afterFade = evaluateProject(p, 3500);
    expect(afterFade.layers).toHaveLength(1);

    const end = evaluateProject(p, 99999);
    expect(end.sceneIndex).toBe(1);
    expect(end.localMs).toBe(3000);
  });

  it("slide transition moves both layers by canvas width", () => {
    const p = createProject("S", "16:9", "blank");
    p.scenes = [createScene("A", { durationMs: 1000 }), createScene("B", { durationMs: 1000, transition: { type: "slide", durationMs: 400 } })];
    const s = evaluateProject(p, 1200);
    expect(s.layers[0].translateX).toBeCloseTo(-960);
    expect(s.layers[1].translateX).toBeCloseTo(960);
  });
});

describe("frames and sizes", () => {
  it("generates integer-indexed timestamps", () => {
    const t = frameTimes(1000, 30);
    expect(t).toHaveLength(30);
    expect(t[0]).toBe(0);
    expect(t[29]).toBeCloseTo(966.667, 2);
  });
  it("computes even output sizes ≥720p", () => {
    expect(outputSize("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize("9:16", 720)).toEqual({ width: 720, height: 1280 });
    expect(outputSize("1:1", 1080)).toEqual({ width: 1080, height: 1080 });
  });
});

describe("schema", () => {
  it("accepts generated projects and rejects malformed ones", () => {
    const p = createProject("Valid");
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(projectDurationMs(p)).toBe(8000);
    expect(ProjectSchema.safeParse({ ...p, id: "../../etc" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...p, scenes: [] }).success).toBe(false);
    const bad = structuredClone(p);
    (bad.scenes[0].elements[0] as { fill: string }).fill = "red; background:url(x)";
    expect(ProjectSchema.safeParse(bad).success).toBe(false);
  });
});
