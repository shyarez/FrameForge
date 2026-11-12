import "server-only";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { probeAudio } from "./media";
import { assertId, userPath, StorageError } from "./storage";

/**
 * Project assets: images and audio. Files are identified by their content (magic bytes), never by the
 * client-supplied name or MIME type, and stored under server-generated names. Audio must also decode
 * completely with FFmpeg. SVG is deliberately not accepted: it can carry script.
 */

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Largest upload of any kind (used to reject oversized requests before reading them). */
export const MAX_UPLOAD_BYTES = MAX_AUDIO_BYTES;

export type ImageKind = "png" | "jpg" | "gif" | "webp";
export type AudioKind = "mp3" | "wav" | "ogg";
export type AssetKind = ImageKind | AudioKind;

export const MIME: Record<AssetKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const AUDIO_KINDS: readonly string[] = ["mp3", "wav", "ogg"];
export const isAudioKind = (k: string): k is AudioKind => AUDIO_KINDS.includes(k);

const FILE_RE = /^[A-Za-z0-9_-]{6,40}\.(png|jpg|gif|webp|mp3|wav|ogg)$/;

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

export function sniffAsset(buf: Uint8Array): AssetKind | null {
  return sniffImage(buf) ?? sniffAudio(buf);
}

export function assertAssetName(name: string): string {
  if (!FILE_RE.test(name)) throw new StorageError("Invalid asset name", 400);
  return name;
}

const assetDir = (owner: string, projectId: string) => userPath(owner, "assets", assertId(projectId));
/** Absolute path of a stored asset (validated name, inside the owner's folder). */
export const assetPath = (owner: string, projectId: string, name: string) => userPath(owner, "assets", assertId(projectId), assertAssetName(name));
/** Measured audio facts, stored next to the file so listing never needs to decode it again. */
const metaPath = (owner: string, projectId: string, name: string) => `${assetPath(owner, projectId, name)}.meta.json`;

export interface AssetInfo {
  name: string;
  /** Reference stored in elements and audio tracks. */
  ref: string;
  bytes: number;
  kind: AssetKind;
  media: "image" | "audio";
  /** Audio only: decoded length. */
  durationMs?: number;
}

export async function saveAsset(owner: string, projectId: string, data: Uint8Array): Promise<AssetInfo> {
  if (data.byteLength === 0) throw new StorageError("Empty file", 400);
  const kind = sniffAsset(data);
  if (!kind) throw new StorageError("Unsupported file: upload a PNG, JPEG, GIF or WebP image, or an MP3, WAV or OGG audio file", 415);
  const audio = isAudioKind(kind);
  if (!audio && data.byteLength > MAX_ASSET_BYTES) throw new StorageError("Image is larger than 8 MB", 413);
  if (audio && data.byteLength > MAX_AUDIO_BYTES) throw new StorageError("Audio is larger than 25 MB", 413);

  const name = `${audio ? "aud" : "img"}_${nanoid(12)}.${kind}`;
  await fs.mkdir(assetDir(owner, projectId), { recursive: true });
  const file = assetPath(owner, projectId, name);
  await fs.writeFile(file, data);
  if (!audio) return { name, ref: `asset:${name}`, bytes: data.byteLength, kind, media: "image" };

  const probe = await probeAudio(file).catch(() => null);
  if (!probe) {
    await fs.rm(file, { force: true });
    throw new StorageError("This audio file could not be decoded", 415);
  }
  await fs.writeFile(metaPath(owner, projectId, name), JSON.stringify(probe));
  return { name, ref: `asset:${name}`, bytes: data.byteLength, kind, media: "audio", durationMs: probe.durationMs };
}

async function audioDuration(owner: string, projectId: string, name: string): Promise<number | undefined> {
  const meta = await fs.readFile(metaPath(owner, projectId, name), "utf8").then(JSON.parse, () => null);
  if (meta && typeof meta.durationMs === "number") return meta.durationMs;
  const probe = await probeAudio(assetPath(owner, projectId, name)).catch(() => null);
  if (probe) await fs.writeFile(metaPath(owner, projectId, name), JSON.stringify(probe)).catch(() => undefined);
  return probe?.durationMs;
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
    const info: AssetInfo = { name, ref: `asset:${name}`, bytes: stat.size, kind, media: isAudioKind(kind) ? "audio" : "image" };
    if (info.media === "audio") info.durationMs = await audioDuration(owner, projectId, name);
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
