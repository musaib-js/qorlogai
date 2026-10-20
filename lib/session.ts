import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getUser } from "@/lib/data/users";
import type { User } from "@/lib/db/schema";

/** Signed-in, active user or redirect to /login. Re-reads the DB so suspension takes effect immediately. */
export async function requireUser(): Promise<User> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await getUser(session.user.id);
  if (!user || user.status !== "active") redirect("/login?error=suspended");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/chat");
  return user;
}

/** For API routes: returns the user or null (caller answers 401). */
export async function apiUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await getUser(session.user.id);
  return user && user.status === "active" ? user : null;
}
