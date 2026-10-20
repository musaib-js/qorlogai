import { createHmac } from "node:crypto";

import { appUrl } from "@/lib/app-url";
import { getWebhookInfo, setCommands, setWebhook } from "./api";

/** Secret Telegram echoes on every webhook call. TELEGRAM_WEBHOOK_SECRET if set, else derived from the bot token. */
export function webhookSecret(): string | null {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (explicit) return explicit;
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t ? createHmac("sha256", "qorlog-telegram-webhook").update(t).digest("hex").slice(0, 48) : null;
}

/**
 * Idempotent: points Telegram at this deployment's webhook and registers the command menu, but only
 * when something differs. Safe to call on every build and from the cron.
 */
export async function ensureWebhook(): Promise<{ status: "ok" | "updated" | "skipped"; reason?: string; url?: string }> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { status: "skipped", reason: "TELEGRAM_BOT_TOKEN not set" };
  const base = appUrl();
  if (!base.startsWith("https://")) return { status: "skipped", reason: "no public https URL (set APP_URL)" };
  const secret = webhookSecret()!;
  const url = `${base}/api/telegram/webhook`;
  const info = await getWebhookInfo();
  if (info.url === url && !info.last_error_message) return { status: "ok", url };
  await setWebhook(url, secret);
  await setCommands();
  return { status: "updated", url };
}
