import type { CSSProperties } from "react";
import { PIXEL_PALETTE, SPRITES, type SpriteName } from "./sprites";

interface Run {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** Per-instance palette overrides, e.g. { f: "#38a6ff" } for a blue fish. */
export type Swap = Partial<Record<string, string>>;

/** Merge horizontal runs of the same colour so a sprite is a handful of rects, not hundreds. */
export function spriteRuns(rows: readonly string[], swap?: Swap): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== ".") runs.push({ x, y, w: end - x, color: swap?.[ch] ?? PIXEL_PALETTE[ch] });
      x = end;
    }
  });
  return runs;
}

export function Sprite({
  name,
  scale = 3,
  swap,
  className,
  style,
  title,
}: {
  name: SpriteName;
  /** Screen pixels per sprite pixel. */
  scale?: number;
  swap?: Swap;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const rows = SPRITES[name];
  const w = rows[0].length;
  const h = rows.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      className={`pixelated ${className ?? ""}`}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {spriteRuns(rows, swap).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </svg>
  );
}

/** A sprite drawn inside an existing SVG, in that SVG's user units. */
export function SpriteG({ name, x, y, swap, flip }: { name: SpriteName; x: number; y: number; swap?: Swap; flip?: boolean }) {
  const rows = SPRITES[name];
  const w = rows[0].length;
  return (
    <g transform={flip ? `translate(${x + w} ${y}) scale(-1 1)` : `translate(${x} ${y})`}>
      {spriteRuns(rows, swap).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </g>
  );
}

/** Sprite as an SVG data URI (used for the custom fish cursor). */
export function spriteDataUri(name: SpriteName, scale: number, swap?: Swap): string {
  const rows = SPRITES[name];
  const w = rows[0].length * scale;
  const h = rows.length * scale;
  const rects = spriteRuns(rows, swap)
    .map((r) => `<rect x='${r.x * scale}' y='${r.y * scale}' width='${r.w * scale}' height='${scale}' fill='${r.color}'/>`)
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' shape-rendering='crispEdges'>${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
