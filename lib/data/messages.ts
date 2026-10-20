import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { exportsTable, messages } from "@/lib/db/schema";
import { openBytes, openText, sealBytes, sealText } from "@/lib/vault";

export interface AttachedFile {
  id: string;
  filename: string;
}

// Files a reply carried are stored as a trailing marker inside the encrypted text, so a download
// card survives a page reload. No schema change needed.
const FILE_MARK = /\n?<!--file:([0-9a-f-]{36})\|([^>]*?)-->/g;

export function splitFiles(stored: string): { text: string; files: AttachedFile[] } {
  const files: AttachedFile[] = [];
  const text = stored.replace(FILE_MARK, (_m, id: string, filename: string) => {
    files.push({ id, filename });
    return "";
  });
  return { text: text.trim(), files };
}

export async function saveMessage(userId: string, channel: string, role: "user" | "assistant", text: string, files: AttachedFile[] = []) {
  if (!text.trim() && !files.length) return;
  const marks = files.map((f) => `\n<!--file:${f.id}|${f.filename.replace(/[<>|]/g, "")}-->`).join("");
  await db().insert(messages).values({ userId, channel, role, contentEnc: await sealText(userId, text.slice(0, 8000) + marks) });
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  channel: string;
  text: string;
  files: AttachedFile[];
  createdAt: Date;
}

/** Oldest-first. Undecryptable rows (e.g. key rotation) are skipped rather than failing the chat. */
export async function recentMessages(userId: string, limit = 14): Promise<StoredMessage[]> {
  const rows = await db()
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  const out: StoredMessage[] = [];
  for (const r of rows.reverse()) {
    try {
      const { text, files } = splitFiles(await openText(userId, r.contentEnc));
      out.push({ id: r.id, role: r.role, channel: r.channel, text, files, createdAt: r.createdAt });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function countRecentUserMessages(userId: string, seconds: number): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.role, "user"), gt(messages.createdAt, new Date(Date.now() - seconds * 1000))));
  return row?.n ?? 0;
}

export async function clearMessages(userId: string) {
  await db().delete(messages).where(eq(messages.userId, userId));
}

// --- exports (generated files) --------------------------------------------------------------

export async function saveExport(userId: string, file: { filename: string; mime: string; bytes: Buffer }): Promise<string> {
  const [row] = await db()
    .insert(exportsTable)
    .values({
      userId,
      filename: file.filename,
      mime: file.mime,
      dataEnc: await sealBytes(userId, file.bytes),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    })
    .returning({ id: exportsTable.id });
  return row.id;
}

export async function getExport(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(exportsTable)
    .where(and(eq(exportsTable.id, id), eq(exportsTable.userId, userId), gt(exportsTable.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return { filename: row.filename, mime: row.mime, bytes: await openBytes(userId, row.dataEnc) };
}

export async function purgeExpired() {
  await db().delete(exportsTable).where(sql`${exportsTable.expiresAt} < now()`);
}
