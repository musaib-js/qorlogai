import { webhookSecret } from "@/lib/telegram/webhook";
import { after } from "next/server";

import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { telegramUpdates } from "@/lib/db/schema";
import { handleUpdate } from "@/lib/telegram/handler";
import type { TgUpdate } from "@/lib/telegram/api";

export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = webhookSecret();
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("forbidden", { status: 403 });

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return new Response("ok");

  // Telegram retries slow webhooks; process every update exactly once.
  const fresh = await db().insert(telegramUpdates).values({ updateId: update.update_id }).onConflictDoNothing().returning();
  if (!fresh.length) return new Response("ok");

  // Acknowledge immediately, keep working after the response is sent.
  after(async () => {
    await handleUpdate(update);
  });
  return new Response("ok");
}
