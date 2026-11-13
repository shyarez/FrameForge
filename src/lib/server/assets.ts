import "server-only";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { probeAudio, probeVideoFile } from "./media";
import { assertId, userPath, StorageError } from "./storage";

/**
 * Project assets: images, audio and video. Files are identified by their content (magic bytes), never by
 * the client-supplied name or MIME type, and stored under server-generated names. Audio and video must
 * also decode with FFmpeg. SVG is deliberately not accepted: it can carry script.
 */

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Largest upload of any kind (used to reject oversized requests before reading them). */
export const MAX_UPLOAD_BYTES = MAX_VIDEO_BYTES;

export type ImageKind = "png" | "jpg" | "gif" | "webp";
export type AudioKind = "mp3" | "wav" | "ogg";
export type VideoKind = "mp4" | "webm";
export type AssetKind = ImageKind | AudioKind | VideoKind;
export type MediaType = "image" | "audio" | "video";

export const MIME: Record<AssetKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

const AUDIO_KINDS: readonly string[] = ["mp3", "wav", "ogg"];
export const isAudioKind = (k: string): k is AudioKind => AUDIO_KINDS.includes(k);
export const isVideoKind = (k: string): k is VideoKind => k === "mp4" || k === "webm";
export const mediaOf = (k: AssetKind): MediaType => (isAudioKind(k) ? "audio" : isVideoKind(k) ? "video" : "image");

const FILE_RE = /^[A-Za-z0-9_-]{6,40}\.(png|jpg|gif|webp|mp3|wav|ogg|mp4|webm)$/;

export function sniffImage(buf: Uint8Array): ImageKind | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => buf[i + j] === b);
  if (buf.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (buf.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (buf.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "gif";
  if (buf.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

export function sniffAudio(buf: Uint8Array): AudioKind | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => buf[i + j] === b);
  if (buf.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return "wav"; // RIFF....WAVE
  if (buf.length >= 4 && at(0, 0x4f, 0x67, 0x67, 0x53)) return "ogg"; // OggS
  if (buf.length >= 3 && at(0, 0x49, 0x44, 0x33)) return "mp3"; // ID3 tag
  // Bare MPEG audio frame sync (11 set bits), layer III.
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) === 0x02) return "mp3";
  return null;
}

export function sniffVideo(buf: Uint8Array): VideoKind | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => buf[i + j] === b);
  if (buf.length >= 4 && at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "webm"; // EBML (WebM/Matroska)
  if (buf.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70)) {
    // ISO base media "ftyp"; audio-only brands (M4A/M4B/M4P) are not videos.
    const brand = String.fromCharCode(...buf.subarray(8, 12));
    return /^M4[ABP]/.test(brand) ? null : "mp4";
  }
  return null;
}

export function sniffAsset(buf: Uint8Array): AssetKind | null {
  return sniffImage(buf) ?? sniffAudio(buf) ?? sniffVideo(buf);
}

export function assertAssetName(name: string): string {
  if (!FILE_RE.test(name)) throw new StorageError("Invalid asset name", 400);
  return name;
}

const assetDir = (owner: string, projectId: string) => userPath(owner, "assets", assertId(projectId));
/** Absolute path of a stored asset (validated name, inside the owner's folder). */
export const assetPath = (owner: string, projectId: string, name: string) => userPath(owner, "assets", assertId(projectId), assertAssetName(name));
/** Measured media facts, stored next to the file so listing never needs to decode it again. */
const metaPath = (owner: string, projectId: string, name: string) => `${assetPath(owner, projectId, name)}.meta.json`;

export interface AssetInfo {
  name: string;
  /** Reference stored in elements and audio tracks. */
  ref: string;
  bytes: number;
  kind: AssetKind;
  media: MediaType;
  /** Audio and video: length. */
  durationMs?: number;
  /** Video only: picture size. */
  width?: number;
  height?: number;
}

const probeMedia = (file: string, media: MediaType) => (media === "audio" ? probeAudio(file) : probeVideoFile(file)).catch(() => null);

export async function saveAsset(owner: string, projectId: string, data: Uint8Array): Promise<AssetInfo> {
  if (data.byteLength === 0) throw new StorageError("Empty file", 400);
  const kind = sniffAsset(data);
  if (!kind) throw new StorageError("Unsupported file: upload a PNG, JPEG, GIF or WebP image, an MP3, WAV or OGG audio file, or an MP4 or WebM video", 415);
  const media = mediaOf(kind);
  if (media === "image" && data.byteLength > MAX_ASSET_BYTES) throw new StorageError("Image is larger than 8 MB", 413);
  if (media === "audio" && data.byteLength > MAX_AUDIO_BYTES) throw new StorageError("Audio is larger than 25 MB", 413);
  if (media === "video" && data.byteLength > MAX_VIDEO_BYTES) throw new StorageError("Video is larger than 100 MB", 413);

  const prefix = { image: "img", audio: "aud", video: "vid" }[media];
  const name = `${prefix}_${nanoid(12)}.${kind}`;
  await fs.mkdir(assetDir(owner, projectId), { recursive: true });
  const file = assetPath(owner, projectId, name);
  await fs.writeFile(file, data);
  if (media === "image") return { name, ref: `asset:${name}`, bytes: data.byteLength, kind, media };

  const probe = await probeMedia(file, media);
  if (!probe) {
    await fs.rm(file, { force: true });
    throw new StorageError(`This ${media} file could not be decoded`, 415);
  }
  await fs.writeFile(metaPath(owner, projectId, name), JSON.stringify(probe));
  return { name, ref: `asset:${name}`, bytes: data.byteLength, kind, media, ...probe };
}

/** Measured facts for audio/video, from the stored sidecar (re-probed if it is missing). */
async function mediaMeta(owner: string, projectId: string, name: string, media: MediaType): Promise<{ durationMs?: number; width?: number; height?: number }> {
  const meta = await fs.readFile(metaPath(owner, projectId, name), "utf8").then(JSON.parse, () => null);
  if (meta && typeof meta.durationMs === "number") return meta;
  const probe = await probeMedia(assetPath(owner, projectId, name), media);
  if (probe) await fs.writeFile(metaPath(owner, projectId, name), JSON.stringify(probe)).catch(() => undefined);
  return probe ?? {};
}

export async function listAssets(owner: string, projectId: string): Promise<AssetInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(assetDir(owner, projectId));
  } catch {
    return [];
  }
  const out: AssetInfo[] = [];
  for (const name of names.filter((n) => FILE_RE.test(n))) {
    const stat = await fs.stat(assetPath(owner, projectId, name));
    const kind = name.split(".").pop() as AssetKind;
    const info: AssetInfo = { name, ref: `asset:${name}`, bytes: stat.size, kind, media: mediaOf(kind) };
    if (info.media !== "image") {
      const m = await mediaMeta(owner, projectId, name, info.media);
      if (m.durationMs) info.durationMs = m.durationMs;
      if (m.width) info.width = m.width;
      if (m.height) info.height = m.height;
    }
    out.push(info);
  }
  return out;
}

export async function readAsset(owner: string, projectId: string, name: string): Promise<{ data: Buffer; mime: string }> {
  const data = await fs.readFile(assetPath(owner, projectId, name)).catch(() => null);
  if (!data) throw new StorageError("Asset not found", 404);
  const kind = sniffAsset(data);
  // The stored content must still match the extension it was saved under.
  if (!kind || !name.endsWith(`.${kind}`)) throw new StorageError("Stored asset is not a valid file", 500);
  return { data, mime: MIME[kind] };
}

export async function deleteAsset(owner: string, projectId: string, name: string): Promise<void> {
  await fs.rm(assetPath(owner, projectId, name), { force: true });
  await fs.rm(metaPath(owner, projectId, name), { force: true });
}
