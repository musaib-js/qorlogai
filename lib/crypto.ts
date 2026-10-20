import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption.
 *
 *   QORLOG_MASTER_KEY (env, never in the DB)
 *        |  wraps
 *        v
 *   per-user data key (DEK, stored wrapped in users.wrapped_dek)
 *        |  encrypts (AES-256-GCM, AAD = userId)
 *        v
 *   timesheet sources, files, profiles, chat messages, exports
 *
 * - Ciphertext is bound to the owner through the GCM additional-authenticated-data, so a row copied
 *   to another user's id fails authentication instead of decrypting.
 * - The admin panel never calls decrypt; it only reads plain `users` columns.
 */

const ALGO = "aes-256-gcm";

export function masterKey(): Buffer {
  const raw = process.env.QORLOG_MASTER_KEY;
  if (!raw) throw new Error("QORLOG_MASTER_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("QORLOG_MASTER_KEY must be 32 bytes, base64 encoded");
  return key;
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function open(key: Buffer, payload: string, aad: string): Buffer {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
}

/** New random per-user data key, returned wrapped (safe to store in the DB). */
export function newWrappedDek(userId: string): string {
  return seal(masterKey(), randomBytes(32), `dek:${userId}`);
}

export function unwrapDek(userId: string, wrapped: string): Buffer {
  return open(masterKey(), wrapped, `dek:${userId}`);
}

export function encryptWithDek(dek: Buffer, userId: string, data: string | Buffer): string {
  return seal(dek, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"), `data:${userId}`);
}

export function decryptWithDek(dek: Buffer, userId: string, payload: string): Buffer {
  return open(dek, payload, `data:${userId}`);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
