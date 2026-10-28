import { describe, expect, it } from "vitest";
import { mixHex, paletteAt, phaseAt, PHASES } from "@/components/pixel/oceanPhases";

describe("ocean time-of-day palettes", () => {
  it("mixes hex colours at the endpoints and midpoint", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("hits each pure phase at its keyframe hour", () => {
    expect(paletteAt(12)).toEqual(PHASES.day);
    expect(paletteAt(2)).toEqual(PHASES.night);
    expect(paletteAt(6)).toEqual(PHASES.dawn);
    expect(paletteAt(18.5)).toEqual(PHASES.sunset);
  });

  it("blends smoothly between phases (no jumps)", () => {
    for (let m = 0; m < 24 * 60; m += 5) {
      const a = paletteAt(m / 60);
      const b = paletteAt((m + 5) / 60);
      expect(Math.abs(a.rays - b.rays)).toBeLessThan(0.1);
      expect(Math.abs(a.glow - b.glow)).toBeLessThan(0.1);
    }
  });

  it("wraps hours and labels phases", () => {
    expect(paletteAt(36)).toEqual(paletteAt(12));
    expect(paletteAt(-12)).toEqual(paletteAt(12));
    expect([phaseAt(6), phaseAt(12), phaseAt(18.5), phaseAt(23)]).toEqual(["dawn", "day", "sunset", "night"]);
  });

  it("has light rays by day and bioluminescence at night", () => {
    expect(paletteAt(12).rays).toBe(1);
    expect(paletteAt(12).glow).toBe(0);
    expect(paletteAt(1).rays).toBe(0);
    expect(paletteAt(1).glow).toBe(1);
  });
});
