import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertAssetName, listAssets, readAsset, saveAsset, sniffImage } from "@/lib/server/assets";
import { safePath, StorageError } from "@/lib/server/storage";

/** All data is stored per user; these tests act as one user. */
const OWNER = "usr_testowner01";

const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
);

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-assets-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("image sniffing", () => {
  it("recognises formats by magic bytes, not names", () => {
    expect(sniffImage(PNG_1PX)).toBe("png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBe("gif");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  });
  it("rejects SVG, HTML and junk", () => {
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("asset storage", () => {
  it("stores under a server-generated name and reads back", async () => {
    const a = await saveAsset(OWNER, "prj_testAssets1", PNG_1PX);
    expect(a.name).toMatch(/^img_[A-Za-z0-9_-]{12}\.png$/);
    expect(a.ref).toBe(`asset:${a.name}`);
    const back = await readAsset(OWNER, "prj_testAssets1", a.name);
    expect(back.mime).toBe("image/png");
    expect(back.data.length).toBe(PNG_1PX.length);
    expect((await listAssets(OWNER, "prj_testAssets1")).map((x) => x.name)).toContain(a.name);
  });

  it("rejects non-images and oversize files", async () => {
    await expect(saveAsset(OWNER, "prj_testAssets1", new TextEncoder().encode("<svg/>"))).rejects.toMatchObject({ status: 415 });
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG_1PX);
    await expect(saveAsset(OWNER, "prj_testAssets1", big)).rejects.toMatchObject({ status: 413 });
    await expect(saveAsset(OWNER, "prj_testAssets1", new Uint8Array(1024))).rejects.toMatchObject({ status: 415 });
  });

  it("refuses path traversal in names and ids", async () => {
    for (const bad of ["../x.png", "..\\x.png", "a.svg", "img.png/../../x", "x".repeat(60) + ".png"]) {
      expect(() => assertAssetName(bad)).toThrow(StorageError);
    }
    await expect(readAsset(OWNER, "../../etc", "img_aaaaaaaaaaaa.png")).rejects.toBeInstanceOf(StorageError);
    expect(() => safePath("..", "outside")).toThrow(StorageError);
  });
});
