/**
 * Snapping for moving elements: the dragged box's left/centre/right (and top/middle/bottom)
 * snap to the canvas edges and centre lines and to other elements' edges and centres.
 * Pure — the canvas just renders the returned guides.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guide {
  axis: "x" | "y";
  /** Canvas coordinate of the guide line. */
  pos: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

function bestOffset(points: number[], targets: number[], threshold: number) {
  let best: { delta: number; target: number } | null = null;
  for (const p of points) {
    for (const t of targets) {
      const delta = t - p;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target: t };
    }
  }
  return best;
}

export function snapMove(box: Box, others: Box[], canvas: { width: number; height: number }, threshold: number): SnapResult {
  const xs = [0, canvas.width / 2, canvas.width, ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width])];
  const ys = [0, canvas.height / 2, canvas.height, ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height])];
  const sx = bestOffset([box.x, box.x + box.width / 2, box.x + box.width], xs, threshold);
  const sy = bestOffset([box.y, box.y + box.height / 2, box.y + box.height], ys, threshold);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: "x", pos: sx.target });
  if (sy) guides.push({ axis: "y", pos: sy.target });
  return { x: Math.round(box.x + (sx?.delta ?? 0)), y: Math.round(box.y + (sy?.delta ?? 0)), guides };
}
