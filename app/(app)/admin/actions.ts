"use server";

import { eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { invalidateModelCache } from "@/lib/agent/models";
import { audit } from "@/lib/data/admin";
import { deleteUser } from "@/lib/data/users";
import { db } from "@/lib/db";
import { aiModels, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";

const PURPOSES = ["chat", "analysis", "utility"] as const;

export async function setUserStatusAction(userId: string, status: "active" | "suspended") {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  await db().update(users).set({ status }).where(eq(users.id, userId));
  await audit(admin.id, status === "suspended" ? "user.suspend" : "user.activate", userId);
  revalidatePath("/admin/users");
}

export async function setUserRoleAction(userId: string, role: "user" | "admin") {
  const admin = await requireAdmin();
  if (userId === admin.id) return; // can't change your own role: there is always at least one admin
  await db().update(users).set({ role }).where(eq(users.id, userId));
  await audit(admin.id, `user.role.${role}`, userId);
  revalidatePath("/admin/users");
}

export async function deleteUserAction(userId: string) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  await audit(admin.id, "user.delete", userId);
  await deleteUser(userId);
  revalidatePath("/admin/users");
}

export async function saveModelAction(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const modelId = String(form.get("modelId") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  if (!modelId || !displayName) return;
  const purposes = PURPOSES.filter((p) => form.get(`purpose_${p}`) === "on");
  if (!purposes.length) return;
  const defaultFor = PURPOSES.filter((p) => form.get(`default_${p}`) === "on" && purposes.includes(p));
  const ctx = Number(form.get("contextWindow"));
  const values = {
    provider: String(form.get("provider") ?? "groq").trim() || "groq",
    modelId,
    displayName,
    purposes: [...purposes],
    defaultFor: [...defaultFor],
    contextWindow: Number.isFinite(ctx) && ctx > 0 ? Math.round(ctx) : null,
    notes: String(form.get("notes") ?? "").trim() || null,
    enabled: form.get("enabled") === "on",
  };
  let rowId = id;
  if (id) {
    await db().update(aiModels).set(values).where(eq(aiModels.id, id));
  } else {
    const [row] = await db()
      .insert(aiModels)
      .values(values)
      .onConflictDoUpdate({ target: [aiModels.provider, aiModels.modelId], set: values })
      .returning({ id: aiModels.id });
    rowId = row.id;
  }
  // exactly one default per purpose
  for (const p of defaultFor) {
    await db()
      .update(aiModels)
      .set({ defaultFor: sql`array_remove(${aiModels.defaultFor}, ${p})` })
      .where(ne(aiModels.id, rowId));
  }
  await audit(admin.id, id ? "model.update" : "model.create", undefined, { modelId });
  invalidateModelCache();
  revalidatePath("/admin/models");
}

export async function deleteModelAction(id: string) {
  const admin = await requireAdmin();
  await db().delete(aiModels).where(eq(aiModels.id, id));
  await audit(admin.id, "model.delete");
  invalidateModelCache();
  revalidatePath("/admin/models");
}
