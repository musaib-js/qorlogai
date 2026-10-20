import { lt } from "drizzle-orm";

import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { telegramUpdates } from "@/lib/db/schema";
import { purgeExpired } from "@/lib/data/messages";
import { ensureWebhook } from "@/lib/telegram/webhook";
import { runReminders } from "@/lib/telegram/reminders";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Runs every 30 minutes (vercel.json). Sends each user's check-in once their local reminder time passes. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("forbidden", { status: 403 });

  // Self-heal: if the webhook was never set (or the domain changed), fix it here.
  const webhook = await ensureWebhook().catch((e) => ({ status: "error", reason: (e as Error).message }));
  const result = await runReminders();
  await purgeExpired();
  await db().delete(telegramUpdates).where(lt(telegramUpdates.createdAt, new Date(Date.now() - 2 * 86400_000)));
  return Response.json({ ...result, webhook });
}
