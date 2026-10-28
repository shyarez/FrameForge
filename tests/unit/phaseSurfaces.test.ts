import { describe, expect, it } from "vitest";
import { SURFACES, surfacesAt, type SurfaceTokens } from "@/components/dashboard/phaseSurfaces";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Text/background pairs used on the dashboard.
const PAIRS: [keyof SurfaceTokens, keyof SurfaceTokens][] = [
  ["paper", "ink"], ["paper", "night"], ["paper", "panel"], ["paper", "raised"], ["paper", "nav"],
  ["mute", "ink"], ["mute", "night"], ["mute", "panel"], ["mute", "nav"],
  ["aquaInk", "ink"], ["aquaInk", "night"], ["aquaInk", "panel"],
  ["yellowInk", "ink"], ["yellowInk", "panel"], ["coralInk", "night"], ["coralInk", "panel"],
  ["mintInk", "night"], ["mintInk", "panel"],
];

describe("dashboard phase surfaces", () => {
  for (const [phase, themes] of Object.entries(SURFACES)) {
    for (const [theme, t] of Object.entries(themes)) {
      it(`${phase} / ${theme}: every text pair meets WCAG AA`, () => {
        for (const [fg, bg] of PAIRS) expect(contrast(t[fg], t[bg]), `${fg} on ${bg} (${t[fg]} on ${t[bg]})`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("stays readable through every blend of the day, in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      for (let m = 0; m < 24 * 60; m += 15) {
        const t = surfacesAt(m / 60, theme);
        for (const [fg, bg] of PAIRS) expect(contrast(t[fg], t[bg]), `${theme} ${m / 60}h ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("never uses pure white backgrounds in light mode", () => {
    for (const themes of Object.values(SURFACES)) {
      for (const k of ["ink", "night", "panel", "nav"] as const) expect(luminance(themes.light[k])).toBeLessThan(0.9);
    }
  });

  it("matches the water hue: sunset surfaces are warm, night surfaces are blue", () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const theme of ["light", "dark"] as const) {
      const [sr, , sb] = rgb(SURFACES.sunset[theme].night);
      expect(sr).toBeGreaterThan(sb);
      const [nr, , nb] = rgb(SURFACES.night[theme].night);
      expect(nb).toBeGreaterThan(nr);
    }
  });
});
