import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { newWrappedDek } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { isValidTimezone } from "@/lib/time";

export async function getUser(id: string): Promise<User | null> {
  const [u] = await db().select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [u] = await db().select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1);
  return u ?? null;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function createUser(input: {
  name: string;
  email?: string | null;
  passwordHash?: string | null;
  timezone: string;
}): Promise<User> {
  const id = randomUUID();
  const email = input.email?.trim().toLowerCase() || null;
  const [u] = await db()
    .insert(users)
    .values({
      id,
      name: input.name.trim().slice(0, 80),
      email,
      passwordHash: input.passwordHash ?? null,
      timezone: isValidTimezone(input.timezone) ? input.timezone : "UTC",
      wrappedDek: newWrappedDek(id), // the data key is bound to this user id
      role: email && adminEmails().includes(email) ? "admin" : "user",
    })
    .returning();
  return u;
}

export type SettingsPatch = Partial<
  Pick<User, "name" | "timezone" | "reminderEnabled" | "reminderMinutes" | "remindWeekends">
>;

export async function updateSettings(id: string, patch: SettingsPatch): Promise<User> {
  const clean: SettingsPatch = {};
  if (patch.name !== undefined) clean.name = patch.name.trim().slice(0, 80) || undefined;
  if (patch.timezone !== undefined && isValidTimezone(patch.timezone)) clean.timezone = patch.timezone;
  if (patch.reminderEnabled !== undefined) clean.reminderEnabled = patch.reminderEnabled;
  if (patch.reminderMinutes !== undefined && patch.reminderMinutes >= 0 && patch.reminderMinutes < 1440) {
    clean.reminderMinutes = Math.round(patch.reminderMinutes);
  }
  if (patch.remindWeekends !== undefined) clean.remindWeekends = patch.remindWeekends;
  const [u] = await db().update(users).set(clean).where(eq(users.id, id)).returning();
  return u;
}

export async function touchUser(id: string) {
  await db().update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, id));
}

export async function deleteUser(id: string) {
  await db().delete(users).where(eq(users.id, id)); // cascades to every owned row
}
