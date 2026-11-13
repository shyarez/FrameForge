import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, getSessionUserId, revokeSession, sessionCookieOptions, userFromToken } from "@/lib/server/sessions";
import { createUser } from "@/lib/server/users";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-sessions-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("sessions", () => {
  it("issues an unguessable token and stores only its hash", async () => {
    const { token } = await createSession("usr_abcdefghijkl");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const files = readdirSync(path.join(dir, "sessions"));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain(token);
    expect(readFileSync(path.join(dir, "sessions", files[0]), "utf8")).not.toContain(token);
    expect(await getSessionUserId(token)).toBe("usr_abcdefghijkl");
  });

  it("rejects unknown, malformed and revoked tokens", async () => {
    const { token } = await createSession("usr_abcdefghijkl");
    expect(await getSessionUserId(undefined)).toBeNull();
    expect(await getSessionUserId("../../etc/passwd")).toBeNull();
    expect(await getSessionUserId("x".repeat(43))).toBeNull();
    await revokeSession(token);
    expect(await getSessionUserId(token)).toBeNull();
  });

  it("expires sessions and deletes them", async () => {
    const { token } = await createSession("usr_abcdefghijkl", -1);
    const before = readdirSync(path.join(dir, "sessions")).length;
    expect(await getSessionUserId(token)).toBeNull();
    expect(readdirSync(path.join(dir, "sessions")).length).toBe(before - 1);
  });

  it("resolves the user behind a token", async () => {
    const user = await createUser("sess@example.com", "password-123");
    const { token } = await createSession(user.id);
    expect((await userFromToken(token))?.email).toBe("sess@example.com");
    expect(await userFromToken("nope")).toBeNull();
  });

  it("uses HttpOnly, SameSite=Lax cookies scoped to the whole site", () => {
    const opts = sessionCookieOptions(new Date(0));
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
