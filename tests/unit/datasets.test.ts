import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDatasetVersion, createDataset, hashCsv, loadDataset } from "@/lib/server/datasets";
import { StorageError } from "@/lib/server/storage";

const V1 = "month,region,revenue\n2024-01,North,10\n2024-02,South,20\n";
const V2 = "month,region,revenue\n2024-01,North,15\n2024-02,South,20\n";
const PROJECT = "prj_dsVersions1";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-datasets-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("dataset versions", () => {
  it("stores uploads as numbered versions and loads any of them", async () => {
    const created = await createDataset(PROJECT, "C:\\fakepath\\sales.csv", V1);
    const id = created.ref.id;
    expect(created.ref).toMatchObject({ name: "sales.csv", version: 1, hash: hashCsv(V1), rowCount: 2, columnCount: 3 });

    // Same content (even with CRLF line endings) is detected and does not create a version.
    const same = await addDatasetVersion(PROJECT, id, V1.replace(/\n/g, "\r\n"));
    expect(same.identical).toBe(true);
    expect(same.view.ref.version).toBe(1);

    const changed = await addDatasetVersion(PROJECT, id, V2);
    expect(changed.identical).toBe(false);
    expect(changed.view.ref).toMatchObject({ version: 2, hash: hashCsv(V2) });

    // The latest is the default, but a project still on v1 can load exactly v1.
    expect((await loadDataset(PROJECT, id)).version).toBe(2);
    const old = await loadDataset(PROJECT, id, 1);
    expect(old).toMatchObject({ version: 1, hash: hashCsv(V1) });
    expect(old.table.columns[2].num).toEqual([10, 20]);
  });

  it("rejects unknown versions, bad CSVs and unsafe ids", async () => {
    const { ref } = await createDataset(PROJECT, "a.csv", V1);
    await expect(loadDataset(PROJECT, ref.id, 9)).rejects.toMatchObject({ status: 404 });
    await expect(addDatasetVersion(PROJECT, ref.id, "a,b\n")).rejects.toMatchObject({ status: 422 });
    await expect(loadDataset(PROJECT, "../../etc")).rejects.toBeInstanceOf(StorageError);
    await expect(addDatasetVersion("../x", ref.id, V2)).rejects.toBeInstanceOf(StorageError);
  });
});
