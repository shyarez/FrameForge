import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertId, safePath, StorageError } from "./storage";

/**
 * User accounts stored as local JSON: data/users/<userId>/user.json plus data/users/index.json
 * (lower-cased email → user id). Passwords are hashed with scrypt (Node built-in, no native add-ons).
 */

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address" }));
export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  // Upper bound keeps hashing cost bounded for very long inputs.
  .max(128, "Password must be at most 128 characters");

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}
export type PublicUser = Pick<User, "id" | "email" | "createdAt">;

export const toPublic = (u: User): PublicUser => ({ id: u.id, email: u.email, createdAt: u.createdAt });

// ---------- password hashing ----------

/** Cost parameters: N=2^15, r=8, p=1 (~32 MB, tens of ms per hash). Stored in the hash so they can change later. */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Format: scrypt$N$r$p$<salt base64>$<hash base64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (![n, r, p].every(Number.isInteger) || expected.length === 0) return false;
  const key = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash of a random password, checked when an email is unknown so timing does not reveal accounts. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

// ---------- storage ----------

const indexFile = () => safePath("users", "index.json");
const userFile = (id: string) => safePath("users", assertId(id), "user.json");

async function writeAtomic(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${nanoid(4)}.tmp`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, file);
}

async function readIndex(): Promise<Record<string, string>> {
  const raw = await fs.readFile(indexFile(), "utf8").catch(() => null);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

// Registrations are serialised so two concurrent sign-ups cannot both claim one email.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const run = chain.then(f, f);
  chain = run.catch(() => undefined);
  return run;
};

export async function getUser(id: string): Promise<User | null> {
  const raw = await fs.readFile(userFile(id), "utf8").catch(() => null);
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function findUserByEmail(emailInput: string): Promise<User | null> {
  const email = EmailSchema.safeParse(emailInput);
  if (!email.success) return null;
  const id = (await readIndex())[email.data];
  return id ? getUser(id) : null;
}

export async function countUsers(): Promise<number> {
  return Object.keys(await readIndex()).length;
}

/**
 * Create an account. onFirstUser runs inside the registration lock when this is the very first
 * account (used to adopt data created before accounts existed).
 */
export async function createUser(emailInput: string, password: string, onFirstUser?: (user: User) => Promise<unknown>): Promise<User> {
  const email = EmailSchema.safeParse(emailInput);
  if (!email.success) throw new StorageError(email.error.issues[0].message, 400);
  const pw = PasswordSchema.safeParse(password);
  if (!pw.success) throw new StorageError(pw.error.issues[0].message, 400);
  const passwordHash = await hashPassword(pw.data);
  return serial(async () => {
    const index = await readIndex();
    if (index[email.data]) throw new StorageError("An account with this email already exists", 409);
    const user: User = { id: `usr_${nanoid(12)}`, email: email.data, passwordHash, createdAt: new Date().toISOString() };
    await writeAtomic(userFile(user.id), JSON.stringify(user, null, 2));
    await writeAtomic(indexFile(), JSON.stringify({ ...index, [email.data]: user.id }, null, 2));
    if (Object.keys(index).length === 0 && onFirstUser) await onFirstUser(user);
    return user;
  });
}

/** Check credentials. Always does one hash comparison, whether or not the email exists. */
export async function authenticate(emailInput: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(emailInput);
  const ok = await verifyPassword(typeof password === "string" ? password.slice(0, 128) : "", user?.passwordHash ?? (await getDummyHash()));
  return user && ok ? user : null;
}
