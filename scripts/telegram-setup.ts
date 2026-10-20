import "dotenv/config";

import { ensureWebhook } from "../lib/telegram/webhook";

/**
 * Runs automatically at the end of `npm run build` (--soft): on a Vercel production deploy it registers
 * the Telegram webhook and command menu. It never fails the build. Run manually with `npm run telegram:setup`.
 */
const soft = process.argv.includes("--soft");

async function main() {
  if (soft && process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
    console.log("[telegram] preview deploy: leaving the production webhook alone.");
    return;
  }
  if (soft && !process.env.VERCEL) return; // local `next build`
  const r = await ensureWebhook();
  console.log(`[telegram] webhook ${r.status}${r.url ? ` -> ${r.url}` : ""}${r.reason ? ` (${r.reason})` : ""}`);
}

main().catch((e) => {
  console.error("[telegram] setup failed:", (e as Error).message);
  process.exit(soft ? 0 : 1);
});
