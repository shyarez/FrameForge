import "server-only";

/**
 * Small in-memory fixed-window rate limiter (single Node process, which is how FrameForge runs).
 * Used to slow down password guessing and sign-up spam.
 */

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __ffRate?: Map<string, Window> };
const windows = (g.__ffRate ??= new Map());

export interface RateResult {
  ok: boolean;
  /** Seconds until the window resets (when blocked). */
  retryAfter: number;
}

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  w.count++;
  return w.count <= limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
}

/** Forget a key (e.g. after a successful login). */
export const clear = (key: string) => void windows.delete(key);

/** Client address for rate limiting; behind no proxy this is the same for all local requests. */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
