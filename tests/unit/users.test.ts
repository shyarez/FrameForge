import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, countUsers, createUser, findUserByEmail, hashPassword, toPublic, verifyPassword } from "@/lib/server/users";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-users-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("password hashing", () => {
  it("verifies the right password, rejects wrong ones, and salts every hash", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b); // random salt
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("correct horsE", a)).toBe(false);
    expect(await verifyPassword("correct horse", "garbage")).toBe(false);
    expect(await verifyPassword("correct horse", "scrypt$x$8$1$AAAA$BBBB")).toBe(false);
  });
});

describe("user accounts", () => {
  it("creates a user with a normalised email and never stores the password", async () => {
    const u = await createUser("  Alice@Example.COM ", "s3cret-pass");
    expect(u.id).toMatch(/^usr_[A-Za-z0-9_-]{12}$/);
    expect(u.email).toBe("alice@example.com");
    expect(toPublic(u)).toEqual({ id: u.id, email: "alice@example.com", createdAt: u.createdAt });
    const onDisk = readFileSync(path.join(dir, "users", u.id, "user.json"), "utf8");
    expect(onDisk).not.toContain("s3cret-pass");
    expect((await findUserByEmail("ALICE@example.com"))?.id).toBe(u.id);
  });

  it("rejects duplicate emails, bad emails and weak passwords", async () => {
    await expect(createUser("alice@example.com", "another-pass")).rejects.toMatchObject({ status: 409 });
    await expect(createUser("not-an-email", "long-enough")).rejects.toMatchObject({ status: 400 });
    await expect(createUser("bob@example.com", "short")).rejects.toMatchObject({ status: 400 });
    await expect(createUser("bob@example.com", "x".repeat(129))).rejects.toMatchObject({ status: 400 });
  });

  it("allows exactly one of two simultaneous sign-ups with the same email", async () => {
    const results = await Promise.allSettled([createUser("race@example.com", "password-1"), createUser("race@example.com", "password-2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("authenticates only with the right email and password", async () => {
    expect((await authenticate("alice@example.com", "s3cret-pass"))?.email).toBe("alice@example.com");
    expect(await authenticate("Alice@Example.com", "wrong-pass")).toBeNull();
    expect(await authenticate("nobody@example.com", "s3cret-pass")).toBeNull();
    expect(await authenticate("not an email", "x")).toBeNull();
    expect(await countUsers()).toBe(2);
  });
});
