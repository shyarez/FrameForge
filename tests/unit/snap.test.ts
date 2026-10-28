import { describe, expect, it } from "vitest";
import { snapMove } from "@/lib/engine/snap";

const canvas = { width: 1920, height: 1080 };

describe("snapMove", () => {
  it("snaps a box's centre to the canvas centre", () => {
    const r = snapMove({ x: 755, y: 437, width: 400, height: 200 }, [], canvas, 8);
    expect(r).toMatchObject({ x: 760, y: 440 });
    expect(r.guides).toEqual([
      { axis: "x", pos: 960 },
      { axis: "y", pos: 540 },
    ]);
  });

  it("snaps edges to the canvas edges", () => {
    expect(snapMove({ x: 5, y: 1078 - 100, width: 100, height: 100 }, [], canvas, 8)).toMatchObject({ x: 0, y: 980 });
  });

  it("aligns to another element's edges", () => {
    const other = { x: 300, y: 300, width: 200, height: 100 };
    const r = snapMove({ x: 503, y: 700, width: 50, height: 50 }, [other], canvas, 8);
    expect(r.x).toBe(500); // left edge onto the other's right edge
    expect(r.guides).toContainEqual({ axis: "x", pos: 500 });
  });

  it("does nothing outside the threshold and prefers the closest target", () => {
    expect(snapMove({ x: 120, y: 120, width: 50, height: 50 }, [], canvas, 8)).toEqual({ x: 120, y: 120, guides: [] });
    const r = snapMove({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 103, y: 500, width: 10, height: 10 }], canvas, 8);
    expect(r.x).toBe(0); // already exactly on the canvas edge beats a 3px move
  });
});
