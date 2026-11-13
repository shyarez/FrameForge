import "server-only";
import { MAX_VIDEO_BYTES } from "./assets";
import { VoiceError } from "./voice";

/**
 * Stock footage from Pexels (free; needs an API key from pexels.com/api). Configure with:
 *   FF_PEXELS_API_KEY  required for stock footage
 *   FF_PEXELS_URL      API base, default https://api.pexels.com (tests point it at a mock)
 * Only search terms are sent to Pexels. Downloads are restricted to Pexels' own file hosts.
 */

export const pexelsUrl = () => (process.env.FF_PEXELS_URL || "https://api.pexels.com").replace(/\/+$/, "");
export const pexelsConfigured = () => Boolean(process.env.FF_PEXELS_API_KEY);

export type Orientation = "portrait" | "landscape" | "square";

export interface StockClip {
  id: string;
  durationMs: number;
  width: number;
  height: number;
  /** Direct file URL of the chosen rendition. */
  fileUrl: string;
  author: string;
  pageUrl: string;
}

interface PexelsFile {
  link?: string;
  width?: number;
  height?: number;
  file_type?: string;
  quality?: string;
}
interface PexelsVideo {
  id?: number;
  duration?: number;
  width?: number;
  height?: number;
  url?: string;
  user?: { name?: string; url?: string };
  video_files?: PexelsFile[];
}

/**
 * The smallest MP4 rendition whose short edge covers `minShortEdge` (or else the largest one), so
 * downloads stay small without upscaling. Mirrors how MoneyPrinterTurbo picks Pexels files.
 */
export function pickRendition(files: PexelsFile[], minShortEdge: number): PexelsFile | null {
  const mp4 = files.filter((f) => f.link && f.width && f.height && (f.file_type ?? "video/mp4") === "video/mp4");
  if (!mp4.length) return null;
  const short = (f: PexelsFile) => Math.min(f.width!, f.height!);
  const area = (f: PexelsFile) => f.width! * f.height!;
  const covering = mp4.filter((f) => short(f) >= minShortEdge).sort((a, b) => area(a) - area(b));
  return covering[0] ?? [...mp4].sort((a, b) => area(b) - area(a))[0];
}

const matchesOrientation = (w: number, h: number, o: Orientation) => (o === "portrait" ? h > w : o === "landscape" ? w > h : Math.abs(w - h) / Math.max(w, h) < 0.2);

/** Download hosts we trust: Pexels' file hosts (and the configured API host, used by the test mock). */
function allowedDownload(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const api = new URL(pexelsUrl());
  if (u.origin === api.origin) return true;
  // Older Pexels renditions are served through Vimeo's player CDN.
  const trusted = ["pexels.com", "vimeo.com", "vimeocdn.com"];
  return u.protocol === "https:" && trusted.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export async function searchStock(query: string, opts: { orientation: Orientation; minDurationMs: number; minShortEdge: number; perPage?: number }): Promise<StockClip[]> {
  const key = process.env.FF_PEXELS_API_KEY;
  if (!key) throw new VoiceError("Stock footage needs a Pexels API key (free at pexels.com/api). Set FF_PEXELS_API_KEY.", 501);
  const params = new URLSearchParams({ query, per_page: String(opts.perPage ?? 20), size: "medium" });
  if (opts.orientation !== "square") params.set("orientation", opts.orientation);
  let res: Response;
  try {
    res = await fetch(`${pexelsUrl()}/videos/search?${params}`, { headers: { authorization: key }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new VoiceError("Can't reach Pexels. Check your internet connection.", 503);
  }
  if (res.status === 401 || res.status === 403) throw new VoiceError("Pexels rejected the API key (FF_PEXELS_API_KEY).", 502);
  if (res.status === 429) throw new VoiceError("Pexels rate limit reached; try again later.", 429);
  if (!res.ok) throw new VoiceError(`Pexels error (${res.status})`, 502);
  const body = (await res.json()) as { videos?: PexelsVideo[] };
  const out: StockClip[] = [];
  for (const v of body.videos ?? []) {
    if (!v.id || !v.duration || !v.width || !v.height) continue;
    if (v.duration * 1000 < opts.minDurationMs) continue;
    if (!matchesOrientation(v.width, v.height, opts.orientation)) continue;
    const f = pickRendition(v.video_files ?? [], opts.minShortEdge);
    if (!f?.link || !allowedDownload(f.link)) continue;
    out.push({
      id: String(v.id),
      durationMs: Math.round(v.duration * 1000),
      width: f.width!,
      height: f.height!,
      fileUrl: f.link,
      author: v.user?.name?.slice(0, 200) || "Pexels",
      pageUrl: v.url && /^https:\/\//.test(v.url) ? v.url : "https://www.pexels.com",
    });
  }
  return out;
}

/** Download a clip (size-capped, from allowed hosts only, following at most a few redirects). */
export async function downloadClip(url: string): Promise<Uint8Array> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedDownload(current)) throw new VoiceError("Refusing to download from an unexpected host", 502);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new VoiceError(`Clip download failed (${res.status})`, 502);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_VIDEO_BYTES) throw new VoiceError("Clip is larger than 100 MB", 413);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new VoiceError("Clip is larger than 100 MB", 413);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
  throw new VoiceError("Too many redirects downloading a clip", 502);
}
