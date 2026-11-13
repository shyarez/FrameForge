import type { VideoElement } from "@/lib/schema/project";

/** Keep seeks this far inside the file so the last frame is still decodable. */
const END_GUARD_MS = 40;

/**
 * Position (ms) inside a video file at a given time within its scene. Pure, so the editor preview,
 * thumbnails and every exported frame show the same video frame.
 */
export function videoTimeMs(el: Pick<VideoElement, "durationMs" | "trimStartMs" | "loop">, sceneMs: number): number {
  const last = Math.max(0, el.durationMs - END_GUARD_MS);
  const start = Math.min(el.trimStartMs, last);
  const span = last - start;
  const t = Math.max(0, sceneMs);
  if (span <= 0) return start;
  return el.loop ? start + (t % span) : Math.min(start + t, last);
}
