import { describe, expect, it } from "vitest";
import { PIXEL_PALETTE, SPRITES } from "@/components/pixel/sprites";
import { spriteRuns } from "@/components/pixel/Sprite";

describe("pixel sprites", () => {
  for (const [name, rows] of Object.entries(SPRITES)) {
    it(`${name} is a rectangular grid using only palette colours`, () => {
      const widths = new Set(rows.map((r) => r.length));
      expect([...widths], `row widths of ${name}`).toHaveLength(1);
      for (const ch of rows.join("")) expect(ch === "." || ch in PIXEL_PALETTE, `char "${ch}" in ${name}`).toBe(true);
    });
  }

  it("merges runs without losing pixels", () => {
    const rows = ["kkw.", ".yy."];
    const runs = spriteRuns(rows);
    expect(runs).toHaveLength(3);
    expect(runs.reduce((s, r) => s + r.w, 0)).toBe(5);
  });
});
