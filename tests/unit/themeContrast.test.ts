import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Parses the theme blocks out of globals.css and checks WCAG AA contrast for text pairs. */
const css = readFileSync(path.join(import.meta.dirname, "../../src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background] pairs actually used for text in the UI.
const TEXT_PAIRS: [string, string][] = [
  ["paper", "ink"],
  ["paper", "night"],
  ["paper", "panel"],
  ["paper", "raised"],
  ["mute", "night"],
  ["mute", "panel"],
  ["aqua-ink", "night"],
  ["aqua-ink", "panel"],
  ["yellow-ink", "panel"],
  ["yellow-ink", "ink"],
  ["coral-ink", "night"],
  ["mint-ink", "night"],
  ["onaccent", "yellow"],
  ["onaccent", "aqua"],
  ["onaccent", "coral"],
  ["onaccent", "mint"],
];

for (const theme of ["dark", "light"] as const) {
  describe(`${theme} theme contrast`, () => {
    const t: Record<string, string> = { onaccent: "#031a24", ...block(`[data-theme="${theme}"]`) };
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${fg} on ${bg} meets WCAG AA (4.5:1)`, () => {
        expect(t[fg], `--color-${fg}`).toBeDefined();
        expect(t[bg], `--color-${bg}`).toBeDefined();
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}
