import { eq } from "drizzle-orm";

import { decryptWithDek, encryptWithDek, unwrapDek } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * User-scoped encryption. Every function takes the OWNER's id, so data can only be sealed or opened
 * with the key of the user it belongs to.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { dek: Buffer; at: number }>();

async function dekFor(userId: string): Promise<Buffer> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dek;
  const [row] = await db().select({ wrapped: users.wrappedDek }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error("Unknown user");
  const dek = unwrapDek(userId, row.wrapped);
  cache.set(userId, { dek, at: Date.now() });
  return dek;
}

export function forgetDek(userId: string) {
  cache.delete(userId);
}

export async function sealText(userId: string, text: string): Promise<string> {
  return encryptWithDek(await dekFor(userId), userId, text);
}

export async function openText(userId: string, payload: string): Promise<string> {
  return decryptWithDek(await dekFor(userId), userId, payload).toString("utf8");
}

export async function sealBytes(userId: string, bytes: Buffer): Promise<string> {
  return encryptWithDek(await dekFor(userId), userId, bytes);
}

export async function openBytes(userId: string, payload: string): Promise<Buffer> {
  return decryptWithDek(await dekFor(userId), userId, payload);
}

export async function sealJson(userId: string, value: unknown): Promise<string> {
  return sealText(userId, JSON.stringify(value));
}

export async function openJson<T>(userId: string, payload: string): Promise<T> {
  return JSON.parse(await openText(userId, payload)) as T;
}
