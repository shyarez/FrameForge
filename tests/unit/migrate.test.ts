import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adoptLegacyData } from "@/lib/server/migrate";
import { createUser } from "@/lib/server/users";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-migrate-"));
  process.env.FF_DATA_DIR = dir;
  // Data created before accounts existed.
  mkdirSync(path.join(dir, "projects"), { recursive: true });
  writeFileSync(path.join(dir, "projects", "prj_legacy0001.json"), "{}");
  mkdirSync(path.join(dir, "assets", "prj_legacy0001"), { recursive: true });
  writeFileSync(path.join(dir, "assets", "prj_legacy0001", "img_aaaaaaaaaaaa.png"), "x");
  mkdirSync(path.join(dir, "exports"), { recursive: true });
  writeFileSync(path.join(dir, "exports", "exp_legacy00001.mp4"), "x");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("adopting pre-account data", () => {
  it("moves legacy data to the first account only", async () => {
    const first = await createUser("first@example.com", "password-1", (u) => adoptLegacyData(u.id));
    const home = path.join(dir, "users", first.id);
    expect(readdirSync(path.join(home, "projects"))).toEqual(["prj_legacy0001.json"]);
    expect(existsSync(path.join(home, "assets", "prj_legacy0001", "img_aaaaaaaaaaaa.png"))).toBe(true);
    expect(existsSync(path.join(home, "exports", "exp_legacy00001.mp4"))).toBe(true);
    // Legacy folders are gone once emptied.
    expect(existsSync(path.join(dir, "projects"))).toBe(false);

    let ran = false;
    const second = await createUser("second@example.com", "password-2", async () => void (ran = true));
    expect(ran).toBe(false);
    expect(existsSync(path.join(dir, "users", second.id, "projects"))).toBe(false);
  });

  it("is a no-op when there is nothing to adopt", async () => {
    expect(await adoptLegacyData("usr_nobody00001")).toEqual({});
  });
});
