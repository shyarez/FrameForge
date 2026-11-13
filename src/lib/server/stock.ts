import "server-only";
import { MAX_VIDEO_BYTES } from "./assets";
import { VoiceError } from "./voice";

/**
 * Stock footage providers. Each is used only when its key is set:
 *   FF_PEXELS_API_KEY   Pexels (new keys are paused by Pexels as of late 2026)
 *   FF_PIXABAY_API_KEY  Pixabay (free key on pixabay.com/api/docs after signing in)
 *   FF_PEXELS_URL / FF_PIXABAY_URL override the API base (tests point them at a mock).
 * Only search terms are sent. Downloads are restricted to each provider's own file hosts.
 */

export type Orientation = "portrait" | "landscape" | "square";
export type ProviderId = "pexels" | "pixabay";

export interface StockClip {
  id: string;
  provider: ProviderId;
  durationMs: number;
  width: number;
  height: number;
  /** Direct file URL of the chosen rendition. */
  fileUrl: string;
  author: string;
  pageUrl: string;
}

export interface SearchOptions {
  orientation: Orientation;
  minDurationMs: number;
  minShortEdge: number;
  perPage?: number;
  /** Safe counts/status only: never request URLs, credentials or provider response bodies. */
  onDiagnostic?: (message: string) => void;
}

export function stockFailure(error: unknown): string {
  if (error instanceof VoiceError) {
    if (error.status === 429) return "provider rate limit reached";
    if (error.status === 503 || error.status === 504) return "network request failed or timed out";
    if (error.status === 413) return "clip exceeds the 100 MB limit";
    // Only our fixed messages are surfaced; arbitrary fetch errors can contain credentialed URLs.
    if (/rejected the API key/.test(error.message)) return "provider rejected the API key";
    const http = /(?:error|failed) \((\d{3})\)/.exec(error.message);
    if (http) return `provider returned HTTP ${http[1]}`;
    if (/unexpected host/.test(error.message)) return "download host rejected by security policy";
  }
  return "request failed (network, response or validation error)";
}

export const PROVIDER_NAMES: Record<ProviderId, string> = { pexels: "Pexels", pixabay: "Pixabay" };

export const pexelsUrl = () => (process.env.FF_PEXELS_URL || "https://api.pexels.com").replace(/\/+$/, "");
export const pixabayUrl = () => (process.env.FF_PIXABAY_URL || "https://pixabay.com").replace(/\/+$/, "");
export const pexelsConfigured = () => Boolean(process.env.FF_PEXELS_API_KEY);
export const pixabayConfigured = () => Boolean(process.env.FF_PIXABAY_API_KEY);

/** Providers with a key, in the order they are tried. */
export function stockProviders(): ProviderId[] {
  const out: ProviderId[] = [];
  if (pexelsConfigured()) out.push("pexels");
  if (pixabayConfigured()) out.push("pixabay");
  return out;
}

interface Rendition {
  link?: string;
  width?: number;
  height?: number;
  file_type?: string;
}

/**
 * The smallest MP4 rendition whose short edge covers `minShortEdge` (or else the largest one), so
 * downloads stay small without upscaling. Mirrors how MoneyPrinterTurbo picks files.
 */
export function pickRendition(files: Rendition[], minShortEdge: number): Rendition | null {
  const mp4 = files.filter((f) => f.link && f.width && f.height && (f.file_type ?? "video/mp4") === "video/mp4");
  if (!mp4.length) return null;
  const short = (f: Rendition) => Math.min(f.width!, f.height!);
  const area = (f: Rendition) => f.width! * f.height!;
  const covering = mp4.filter((f) => short(f) >= minShortEdge).sort((a, b) => area(a) - area(b));
  return covering[0] ?? [...mp4].sort((a, b) => area(b) - area(a))[0];
}

export const matchesOrientation = (w: number, h: number, o: Orientation) =>
  o === "portrait" ? h > w : o === "landscape" ? w > h : Math.abs(w - h) / Math.max(w, h) < 0.2;

const TRUSTED_HOSTS = ["pexels.com", "vimeo.com", "vimeocdn.com", "pixabay.com"];

/** Download hosts we trust: the providers' file hosts (and the configured API hosts, used by test mocks). */
function allowedDownload(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  for (const api of [pexelsUrl(), pixabayUrl()]) if (u.origin === new URL(api).origin) return true;
  return u.protocol === "https:" && TRUSTED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

async function getJson(url: string, init: RequestInit, provider: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new VoiceError(`Can't reach ${provider}. Check your internet connection.`, 503);
  }
  if (res.status === 401 || res.status === 403) throw new VoiceError(`${provider} rejected the API key.`, 502);
  if (res.status === 429) throw new VoiceError(`${provider} rate limit reached; try again later.`, 429);
  if (!res.ok) throw new VoiceError(`${provider} error (${res.status})`, 502);
  return res.json();
}

const httpsOr = (u: unknown, fallback: string) => (typeof u === "string" && /^https:\/\//.test(u) ? u : fallback);

async function searchPexels(query: string, opts: SearchOptions): Promise<StockClip[]> {
  const params = new URLSearchParams({ query, per_page: String(opts.perPage ?? 20), size: "medium" });
  if (opts.orientation !== "square") params.set("orientation", opts.orientation);
  const body = (await getJson(`${pexelsUrl()}/videos/search?${params}`, { headers: { authorization: process.env.FF_PEXELS_API_KEY! } }, "Pexels")) as {
    videos?: { id?: number; duration?: number; width?: number; height?: number; url?: string; user?: { name?: string }; video_files?: Rendition[] }[];
  };
  const out: StockClip[] = [];
  for (const v of body.videos ?? []) {
    if (!v.id || !v.duration || !v.width || !v.height) continue;
    if (v.duration * 1000 < opts.minDurationMs || !matchesOrientation(v.width, v.height, opts.orientation)) continue;
    const f = pickRendition(v.video_files ?? [], opts.minShortEdge);
    if (!f?.link || !allowedDownload(f.link)) continue;
    out.push({
      id: `pexels-${v.id}`,
      provider: "pexels",
      durationMs: Math.round(v.duration * 1000),
      width: f.width!,
      height: f.height!,
      fileUrl: f.link,
      author: v.user?.name?.slice(0, 200) || "Pexels",
      pageUrl: httpsOr(v.url, "https://www.pexels.com"),
    });
  }
  return out;
}

type PixabaySize = { url?: string; width?: number; height?: number; size?: number };

async function searchPixabay(query: string, opts: SearchOptions): Promise<StockClip[]> {
  // Pixabay limits q to 100 characters; the key travels in the query string, so this URL is never logged.
  const params = new URLSearchParams({ key: process.env.FF_PIXABAY_API_KEY!, q: query.slice(0, 100), video_type: "film", safesearch: "true", per_page: String(Math.max(3, opts.perPage ?? 30)) });
  const body = (await getJson(`${pixabayUrl()}/api/videos/?${params}`, {}, "Pixabay")) as {
    hits?: { id?: number; duration?: number; pageURL?: string; user?: string; videos?: Record<string, PixabaySize> }[];
  };
  const out: StockClip[] = [];
  const cropped: StockClip[] = [];
  const rejected = { duration: 0, rendition: 0, host: 0, orientation: 0 };
  for (const h of body.hits ?? []) {
    if (!h.id || !h.duration || h.duration * 1000 < opts.minDurationMs) { rejected.duration++; continue; }
    const sizes = Object.values(h.videos ?? {}).filter((s) => s?.url && s.width && s.height);
    // Pixabay reports orientation per rendition; all renditions share it.
    const f = pickRendition(sizes.map((s) => ({ link: s.url, width: s.width, height: s.height })), opts.minShortEdge);
    if (!f?.link) { rejected.rendition++; continue; }
    if (!allowedDownload(f.link)) { rejected.host++; continue; }
    const matching = matchesOrientation(f.width!, f.height!, opts.orientation);
    if (!matching) rejected.orientation++;
    (matching ? out : cropped).push({
      id: `pixabay-${h.id}`,
      provider: "pixabay",
      durationMs: Math.round(h.duration * 1000),
      width: f.width!,
      height: f.height!,
      fileUrl: f.link,
      author: (h.user ?? "").slice(0, 200) || "Pixabay",
      pageUrl: httpsOr(h.pageURL, "https://pixabay.com"),
    });
  }
  opts.onDiagnostic?.(`Pixabay: received ${body.hits?.length ?? 0}; orientation matches ${out.length}; rejected duration/metadata ${rejected.duration}, rendition ${rejected.rendition}, host ${rejected.host}; crop candidates ${rejected.orientation}.`);
  // The existing video renderer uses object-fit: cover. Prefer matching clips, but allow a
  // validated clip to fill a square/portrait canvas when no matching footage was returned.
  return [...out, ...cropped];
}

/** Search every configured provider in order until one returns clips. */
export async function searchStock(query: string, opts: SearchOptions): Promise<StockClip[]> {
  const providers = stockProviders();
  if (!providers.length) throw new VoiceError("Stock footage needs an API key: set FF_PIXABAY_API_KEY (or FF_PEXELS_API_KEY).", 501);
  let lastError: unknown = null;
  for (const p of providers) {
    try {
      const clips = p === "pexels" ? await searchPexels(query, opts) : await searchPixabay(query, opts);
      if (clips.length) return clips;
    } catch (err) {
      // A failing provider (bad key, rate limit) shouldn't stop the next one from being tried.
      lastError = err;
      opts.onDiagnostic?.(`${PROVIDER_NAMES[p]} search: ${stockFailure(err)}.`);
    }
  }
  if (lastError && providers.length === 1) throw lastError;
  return [];
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
