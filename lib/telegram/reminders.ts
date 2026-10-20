import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelLinks, timesheets, users } from "@/lib/db/schema";
import { localParts } from "@/lib/time";
import { sendMessage } from "./api";

const WINDOW_MIN = 180; // send up to 3 hours late (cron hiccup) but never the next day

const TEMPLATES = [
  (n: string) => `Hey ${n}! 👋 What did you work on today?`,
  (n: string) => `Evening, ${n}! Time to wrap up the day. What did you get done?`,
  (n: string) => `Hi ${n}, quick timesheet check-in: what did you work on today?`,
  (n: string) => `${n}, how was the day? Tell me what you worked on and I'll fill in your timesheet.`,
];

const FOOTER = `\n\nJust reply in your own words, e.g. "6 hours: fixed login bug, reviewed PRs". On leave? Say "leave today" or "half day".`;

export async function runReminders(now: Date = new Date()) {
  const candidates = await db()
    .select({ user: users, chatId: channelLinks.externalId })
    .from(users)
    .innerJoin(channelLinks, and(eq(channelLinks.userId, users.id), eq(channelLinks.channel, "telegram")))
    .where(and(eq(users.status, "active"), eq(users.reminderEnabled, true)));

  let sent = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const { user, chatId } of candidates) {
    const lp = localParts(user.timezone, now);
    const weekdayOk = user.remindWeekends || (lp.weekday >= 1 && lp.weekday <= 5);
    const due = lp.minutesOfDay >= user.reminderMinutes && lp.minutesOfDay < user.reminderMinutes + WINDOW_MIN;
    if (!weekdayOk || !due || user.lastReminderDate === lp.date) {
      skipped++;
      continue;
    }
    const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(timesheets).where(eq(timesheets.userId, user.id));
    if (!n) {
      skipped++;
      continue;
    }
    // Atomic claim: overlapping cron runs can't double-send.
    const claimed = await db()
      .update(users)
      .set({ lastReminderDate: lp.date, lastReminderAt: now })
      .where(and(eq(users.id, user.id), sql`${users.lastReminderDate} is distinct from ${lp.date}`))
      .returning({ id: users.id });
    if (!claimed.length) continue;
    try {
      const first = user.name.split(" ")[0];
      await sendMessage(chatId, TEMPLATES[Number(lp.date.slice(-2)) % TEMPLATES.length](first) + FOOTER);
      sent++;
    } catch (e) {
      failed.push(user.id);
      console.error("reminder failed", user.id, (e as Error).message);
      // Give the claim back so the next cron run retries (still inside the 3 hour window).
      await db()
        .update(users)
        .set({ lastReminderDate: user.lastReminderDate, lastReminderAt: user.lastReminderAt })
        .where(eq(users.id, user.id));
    }
  }
  return { checked: candidates.length, sent, skipped, failed: failed.length };
}
