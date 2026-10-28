import "server-only";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { assertId, safePath, StorageError } from "./storage";

/**
 * Project image assets. Files are identified by their content (magic bytes), never by the
 * client-supplied name or MIME type, and stored under server-generated names.
 * SVG is deliberately not accepted: it can carry script.
 */

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export type ImageKind = "png" | "jpg" | "gif" | "webp";

export const MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const FILE_RE = /^[A-Za-z0-9_-]{6,40}\.(png|jpg|gif|webp)$/;

export function sniffImage(buf: Uint8Array): ImageKind | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => buf[i + j] === b);
  if (buf.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (buf.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (buf.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "gif";
  if (buf.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

export function assertAssetName(name: string): string {
  if (!FILE_RE.test(name)) throw new StorageError("Invalid asset name", 400);
  return name;
}

const assetDir = (projectId: string) => safePath("assets", assertId(projectId));
const assetPath = (projectId: string, name: string) => safePath("assets", assertId(projectId), assertAssetName(name));

export interface AssetInfo {
  name: string;
  /** Reference stored in image elements. */
  ref: string;
  bytes: number;
  kind: ImageKind;
}

export async function saveAsset(projectId: string, data: Uint8Array): Promise<AssetInfo> {
  if (data.byteLength === 0) throw new StorageError("Empty file", 400);
  if (data.byteLength > MAX_ASSET_BYTES) throw new StorageError("Image is larger than 8 MB", 413);
  const kind = sniffImage(data);
  if (!kind) throw new StorageError("Unsupported file: upload a PNG, JPEG, GIF or WebP image", 415);
  const name = `img_${nanoid(12)}.${kind}`;
  await fs.mkdir(assetDir(projectId), { recursive: true });
  await fs.writeFile(assetPath(projectId, name), data);
  return { name, ref: `asset:${name}`, bytes: data.byteLength, kind };
}

export async function listAssets(projectId: string): Promise<AssetInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(assetDir(projectId));
  } catch {
    return [];
  }
  const out: AssetInfo[] = [];
  for (const name of names.filter((n) => FILE_RE.test(n))) {
    const stat = await fs.stat(assetPath(projectId, name));
    out.push({ name, ref: `asset:${name}`, bytes: stat.size, kind: name.split(".").pop() as ImageKind });
  }
  return out;
}

export async function readAsset(projectId: string, name: string): Promise<{ data: Buffer; mime: string }> {
  const data = await fs.readFile(assetPath(projectId, name)).catch(() => null);
  if (!data) throw new StorageError("Asset not found", 404);
  const kind = sniffImage(data);
  if (!kind) throw new StorageError("Stored asset is not a valid image", 500);
  return { data, mime: MIME[kind] };
}

export async function deleteAsset(projectId: string, name: string): Promise<void> {
  await fs.rm(assetPath(projectId, name), { force: true });
}
