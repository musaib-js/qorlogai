import { and, count, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiModels, auditLog, channelLinks, messages, timesheets, usageEvents, users } from "@/lib/db/schema";

/**
 * ADMIN DATA ACCESS: the only module the admin panel may use.
 *
 * It exposes account metadata and aggregate counts. It never selects from timesheets' content columns
 * (source_enc, file_enc, profile_enc), messages.content_enc or exports, and it never imports the vault.
 * Timesheet names are also withheld: they can reveal an employer or client.
 */

export async function adminListUsers() {
  return db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      timezone: users.timezone,
      createdAt: users.createdAt,
      lastActiveAt: users.lastActiveAt,
      timesheetCount: sql<number>`(select count(*)::int from ${timesheets} where ${timesheets.userId} = ${sql.raw('"users"."id"')})`,
      telegram: sql<boolean>`exists (select 1 from ${channelLinks} where ${channelLinks.userId} = ${sql.raw('"users"."id"')} and ${channelLinks.channel} = 'telegram')`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(500);
}

export async function adminStats() {
  const week = new Date(Date.now() - 7 * 86400_000);
  const month = new Date(Date.now() - 30 * 86400_000);
  const [u] = await db().select({ total: count() }).from(users);
  const [active] = await db().select({ n: count() }).from(users).where(gt(users.lastActiveAt, week));
  const [tg] = await db().select({ n: count() }).from(channelLinks).where(eq(channelLinks.channel, "telegram"));
  const [ts] = await db().select({ n: count() }).from(timesheets);
  const [msgs] = await db().select({ n: count() }).from(messages).where(gt(messages.createdAt, week));
  const [tok] = await db()
    .select({
      input: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(gt(usageEvents.createdAt, month));
  return {
    users: u.total,
    activeUsers7d: active.n,
    telegramLinked: tg.n,
    timesheets: ts.n,
    messages7d: msgs.n,
    tokens30d: { input: tok.input, output: tok.output },
  };
}

export async function adminModelUsage() {
  const month = new Date(Date.now() - 30 * 86400_000);
  return db()
    .select({
      modelId: usageEvents.modelId,
      purpose: usageEvents.purpose,
      calls: count(),
      input: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(gt(usageEvents.createdAt, month))
    .groupBy(usageEvents.modelId, usageEvents.purpose);
}

export async function adminListModels() {
  return db().select().from(aiModels).orderBy(aiModels.provider, aiModels.displayName);
}

export async function adminRecentAudit() {
  return db()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      actor: sql<string | null>`(select name from ${users} where ${users.id} = ${auditLog.actorId})`,
      target: sql<string | null>`(select name from ${users} where ${users.id} = ${auditLog.targetUserId})`,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(15);
}

export async function audit(actorId: string, action: string, targetUserId?: string, meta: Record<string, unknown> = {}) {
  await db().insert(auditLog).values({ actorId, action, targetUserId, meta });
}

export async function adminCount(where: "admins") {
  if (where === "admins") {
    const [r] = await db().select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    return r.n;
  }
  return 0;
}
