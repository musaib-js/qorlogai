"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth, signIn, signOut } from "@/lib/auth";
import { createCode, unlinkChannel } from "@/lib/data/channels";
import { clearMessages } from "@/lib/data/messages";
import { createUser, deleteUser, getUserByEmail, updateSettings } from "@/lib/data/users";
import { requireUser } from "@/lib/session";
import { isValidTimezone, resolveTimezoneLocal } from "@/lib/time";

export interface FormState {
  error?: string;
  ok?: string;
}

const tzOf = (raw: string) => (isValidTimezone(raw.trim()) ? raw.trim() : resolveTimezoneLocal(raw));

// --- auth -----------------------------------------------------------------------------------

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Tell us your name").max(80),
      email: z.string().trim().email("Enter a valid email"),
      password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
      timezone: z.string().trim().min(1, "Pick your timezone"),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password, timezone } = parsed.data;
  const tz = tzOf(timezone);
  if (!tz) return { error: "We don't recognise that timezone. Pick one from the list, e.g. Asia/Kolkata." };
  if (await getUserByEmail(email)) return { error: "An account with this email already exists." };

  try {
    await createUser({ name, email, passwordHash: await bcrypt.hash(password, 12), timezone: tz });
  } catch {
    return { error: "An account with this email already exists." };
  }
  await signIn("credentials", { email, password, redirectTo: "/timesheets/new?welcome=1" });
  return {};
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: "/chat",
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Wrong email or password, or the account is suspended." };
    throw e; // NEXT_REDIRECT on success
  }
  return {};
}

export async function linkLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("link", { code: String(form.get("code") ?? ""), redirectTo: "/chat" });
  } catch (e) {
    if (e instanceof AuthError) return { error: "This link has expired or was already used. Send /web to the bot for a fresh one." };
    throw e;
  }
  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

// --- settings -------------------------------------------------------------------------------

export async function updateProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const tz = tzOf(String(form.get("timezone") ?? ""));
  if (!tz) return { error: "We don't recognise that timezone." };
  const time = String(form.get("reminderTime") ?? "18:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!time || +time[1] > 23 || +time[2] > 59) return { error: "Reminder time must look like 18:00." };
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Name can't be empty." };
  await updateSettings(user.id, {
    name,
    timezone: tz,
    reminderMinutes: +time[1] * 60 + +time[2],
    reminderEnabled: form.get("reminderEnabled") === "on",
    remindWeekends: form.get("remindWeekends") === "on",
  });
  revalidatePath("/settings");
  return { ok: "Saved." };
}

/** Returns a deep link that connects the user's Telegram account (single use, 15 minutes). */
export async function createTelegramLinkAction(): Promise<{ url?: string; error?: string }> {
  const user = await requireUser();
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!bot) return { error: "The Telegram bot isn't configured on this server yet." };
  const code = await createCode(user.id, "telegram_link", 15);
  return { url: `https://t.me/${bot}?start=link_${code}` };
}

export async function unlinkTelegramAction() {
  const user = await requireUser();
  await unlinkChannel(user.id, "telegram");
  revalidatePath("/settings");
}

export async function clearChatAction() {
  const user = await requireUser();
  await clearMessages(user.id);
  revalidatePath("/chat");
}

export async function deleteAccountAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") return { error: 'Type DELETE to confirm.' };
  const session = await auth();
  if (session?.user?.id !== user.id) return { error: "Session mismatch." };
  await deleteUser(user.id);
  await signOut({ redirectTo: "/" });
  return {};
}
