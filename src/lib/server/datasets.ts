import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { CsvError, parseCsv } from "@/lib/data/csv";
import { profileTable, type ColumnProfile, type Table } from "@/lib/data/profile";
import { suggestRoles, type StoryRoles } from "@/lib/data/story";
import type { DatasetRef } from "@/lib/schema/project";
import { assertId, safePath, StorageError } from "./storage";

/**
 * Datasets are stored per project and per version: data/datasets/<project>/<dataset>/v<N>.csv
 * plus meta.json. Statistics are always computed server-side from a stored version, never from
 * data sent by the browser.
 */

export interface DatasetVersion {
  version: number;
  hash: string;
  rowCount: number;
  columnCount: number;
  uploadedAt: string;
  warnings: string[];
}

export interface DatasetMeta {
  id: string;
  name: string;
  current: number;
  versions: DatasetVersion[];
}

/** What the client sees about a dataset version. */
export interface DatasetView {
  ref: DatasetRef;
  columns: ColumnProfile[];
  headers: string[];
  preview: string[][];
  warnings: string[];
  suggested: StoryRoles;
}

const dir = (projectId: string, datasetId: string) => safePath("datasets", assertId(projectId), assertId(datasetId));
const versionFile = (projectId: string, datasetId: string, v: number) => safePath("datasets", assertId(projectId), assertId(datasetId), `v${Math.trunc(v)}.csv`);
const metaFile = (projectId: string, datasetId: string) => safePath("datasets", assertId(projectId), assertId(datasetId), "meta.json");

export const hashCsv = (normalized: string) => createHash("sha256").update(normalized, "utf8").digest("hex");

/** Display name only: strip any path the browser sent and cap the length. */
const cleanName = (name: string) => (name.split(/[\\/]/).pop() || "dataset.csv").replace(/[\u0000-\u001f]/g, "").slice(0, 200);

function parseOrReject(text: string) {
  try {
    return parseCsv(text);
  } catch (e) {
    if (e instanceof CsvError) throw new StorageError(e.message, 422);
    throw e;
  }
}

async function readMeta(projectId: string, datasetId: string): Promise<DatasetMeta> {
  const raw = await fs.readFile(metaFile(projectId, datasetId), "utf8").catch(() => null);
  if (!raw) throw new StorageError("Dataset not found", 404);
  return JSON.parse(raw) as DatasetMeta;
}

function toRef(meta: DatasetMeta, addedAt: string): DatasetRef {
  const v = meta.versions.find((x) => x.version === meta.current)!;
  return { id: meta.id, name: meta.name, version: v.version, hash: v.hash, rowCount: v.rowCount, columnCount: v.columnCount, addedAt };
}

function view(meta: DatasetMeta, table: Table, preview: string[][], warnings: string[]): DatasetView {
  return {
    ref: toRef(meta, meta.versions[0].uploadedAt),
    columns: table.columns.map((c) => c.profile),
    headers: table.headers,
    preview,
    warnings,
    suggested: suggestRoles(table),
  };
}

export async function createDataset(projectId: string, fileName: string, text: string): Promise<DatasetView> {
  const parsed = parseOrReject(text);
  const table = profileTable(parsed.headers, parsed.rows);
  const id = `ds_${nanoid(10)}`;
  const now = new Date().toISOString();
  const meta: DatasetMeta = {
    id,
    name: cleanName(fileName),
    current: 1,
    versions: [{ version: 1, hash: hashCsv(parsed.normalized), rowCount: table.rowCount, columnCount: parsed.headers.length, uploadedAt: now, warnings: parsed.warnings }],
  };
  await fs.mkdir(dir(projectId, id), { recursive: true });
  await fs.writeFile(versionFile(projectId, id, 1), parsed.normalized, "utf8");
  await fs.writeFile(metaFile(projectId, id), JSON.stringify(meta, null, 2), "utf8");
  return view(meta, table, parsed.rows.slice(0, 25), parsed.warnings);
}

/** Load a stored version (current by default) as a profiled table. */
export async function loadDataset(projectId: string, datasetId: string, version?: number) {
  const meta = await readMeta(projectId, datasetId);
  const v = version ?? meta.current;
  if (!meta.versions.some((x) => x.version === v)) throw new StorageError("Dataset version not found", 404);
  const text = await fs.readFile(versionFile(projectId, datasetId, v), "utf8");
  const parsed = parseOrReject(text);
  const table = profileTable(parsed.headers, parsed.rows);
  return { meta, table, version: v, hash: meta.versions.find((x) => x.version === v)!.hash, view: view(meta, table, parsed.rows.slice(0, 25), parsed.warnings) };
}

export async function deleteDataset(projectId: string, datasetId: string) {
  await fs.rm(dir(projectId, datasetId), { recursive: true, force: true });
}
