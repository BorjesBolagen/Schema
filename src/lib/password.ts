import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify tappar överlagringen med options, så den typas ut explicit.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Lösenordshashning med scrypt ur Nodes egen krypto-modul.
 *
 * Ingen extra beroendekedja, och parametrarna lagras i hashen så de går
 * att höja senare utan att gamla lösenord slutar fungera.
 */
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");

  const actual = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
