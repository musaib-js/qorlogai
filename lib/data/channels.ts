import { and, eq, gt, isNull } from "drizzle-orm";

import { randomToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { channelLinks, channelState, linkCodes, users, type User } from "@/lib/db/schema";

export type LinkableChannel = "telegram" | "whatsapp";

export async function findLinkedUser(channel: LinkableChannel, externalId: string): Promise<User | null> {
  const [row] = await db()
    .select({ user: users })
    .from(channelLinks)
    .innerJoin(users, eq(users.id, channelLinks.userId))
    .where(and(eq(channelLinks.channel, channel), eq(channelLinks.externalId, externalId)))
    .limit(1);
  return row?.user ?? null;
}

export async function getLink(userId: string, channel: LinkableChannel) {
  const [row] = await db()
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, channel)))
    .limit(1);
  return row ?? null;
}

export async function linkChannel(userId: string, channel: LinkableChannel, externalId: string) {
  await db().delete(channelLinks).where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, channel)));
  await db().insert(channelLinks).values({ userId, channel, externalId });
}

export async function unlinkChannel(userId: string, channel: LinkableChannel) {
  await db().delete(channelLinks).where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, channel)));
}

// --- conversational state -------------------------------------------------------------------

export interface ChannelState {
  state: string;
  data: Record<string, unknown>;
}

export async function getState(channel: string, externalId: string): Promise<ChannelState | null> {
  const [row] = await db()
    .select()
    .from(channelState)
    .where(and(eq(channelState.channel, channel), eq(channelState.externalId, externalId)))
    .limit(1);
  if (!row) return null;
  // Stale onboarding state (> 24h) is dropped so users never get stuck in a dead flow.
  if (Date.now() - row.updatedAt.getTime() > 24 * 3600 * 1000) {
    await clearState(channel, externalId);
    return null;
  }
  return { state: row.state, data: row.data };
}

export async function setState(channel: string, externalId: string, state: string, data: Record<string, unknown> = {}) {
  await db()
    .insert(channelState)
    .values({ channel, externalId, state, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [channelState.channel, channelState.externalId],
      set: { state, data, updatedAt: new Date() },
    });
}

export async function clearState(channel: string, externalId: string) {
  await db().delete(channelState).where(and(eq(channelState.channel, channel), eq(channelState.externalId, externalId)));
}

// --- single-use codes -----------------------------------------------------------------------

export async function createCode(userId: string, kind: "telegram_link" | "web_login", ttlMinutes: number): Promise<string> {
  const code = randomToken(18);
  await db().insert(linkCodes).values({
    codeHash: sha256(code),
    userId,
    kind,
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });
  return code;
}

/** Atomically marks the code used and returns its owner. Null if unknown, expired or already used. */
export async function consumeCode(code: string, kind: "telegram_link" | "web_login"): Promise<string | null> {
  const [row] = await db()
    .update(linkCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(linkCodes.codeHash, sha256(code)),
        eq(linkCodes.kind, kind),
        isNull(linkCodes.usedAt),
        gt(linkCodes.expiresAt, new Date()),
      ),
    )
    .returning({ userId: linkCodes.userId });
  return row?.userId ?? null;
}
