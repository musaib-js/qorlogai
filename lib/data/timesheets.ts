import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { timesheets, type Timesheet } from "@/lib/db/schema";
import { describeProfile, type TimesheetProfile } from "@/lib/sheets/profile";
import { GoogleSheetAdapter } from "@/lib/sheets/google";
import type { SheetAdapter } from "@/lib/sheets/types";
import { SheetError } from "@/lib/sheets/types";
import { XlsxAdapter } from "@/lib/sheets/xlsx-adapter";
import { openBytes, openJson, sealBytes, sealJson } from "@/lib/vault";

/**
 * EVERY function here takes the owner's userId and puts it in the WHERE clause.
 * There is deliberately no "get timesheet by id only" function.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TimesheetListItem {
  id: string;
  name: string;
  kind: "xlsx" | "gsheet";
  profileStatus: "pending" | "ready" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

export async function listTimesheets(userId: string): Promise<TimesheetListItem[]> {
  return db()
    .select({
      id: timesheets.id,
      name: timesheets.name,
      kind: timesheets.kind,
      profileStatus: timesheets.profileStatus,
      createdAt: timesheets.createdAt,
      updatedAt: timesheets.updatedAt,
    })
    .from(timesheets)
    .where(eq(timesheets.userId, userId))
    .orderBy(desc(timesheets.createdAt));
}

/** Looks a timesheet up by id or (case-insensitive) name, inside the owner's scope only. */
export async function getTimesheet(userId: string, idOrName: string): Promise<Timesheet | null> {
  const key = idOrName.trim();
  const match = UUID.test(key) ? eq(timesheets.id, key) : sql`lower(${timesheets.name}) = ${key.toLowerCase()}`;
  const [row] = await db().select().from(timesheets).where(and(eq(timesheets.userId, userId), match)).limit(1);
  return row ?? null;
}

export async function createTimesheet(
  userId: string,
  input: { name: string; kind: "xlsx"; file: Buffer } | { name: string; kind: "gsheet"; spreadsheetId: string; url: string },
): Promise<Timesheet> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new SheetError("A timesheet needs a name.", "invalid");
  if (await getTimesheet(userId, name)) throw new SheetError(`You already have a timesheet called "${name}".`, "invalid");
  const values =
    input.kind === "xlsx"
      ? { fileEnc: await sealBytes(userId, input.file) }
      : { sourceEnc: await sealJson(userId, { spreadsheetId: input.spreadsheetId, url: input.url }) };
  const [row] = await db().insert(timesheets).values({ userId, name, kind: input.kind, ...values }).returning();
  return row;
}

export async function deleteTimesheet(userId: string, id: string): Promise<boolean> {
  const rows = await db().delete(timesheets).where(and(eq(timesheets.id, id), eq(timesheets.userId, userId))).returning({ id: timesheets.id });
  return rows.length > 0;
}

export async function loadAdapter(userId: string, ts: Timesheet): Promise<SheetAdapter> {
  if (ts.userId !== userId) throw new Error("Forbidden"); // defence in depth
  if (ts.kind === "xlsx") {
    if (!ts.fileEnc) throw new SheetError("This timesheet has no file stored.", "bad_file");
    const bytes = await openBytes(userId, ts.fileEnc);
    return XlsxAdapter.load(bytes, async (updated) => {
      await db()
        .update(timesheets)
        .set({ fileEnc: await sealBytes(userId, updated), updatedAt: new Date() })
        .where(and(eq(timesheets.id, ts.id), eq(timesheets.userId, userId)));
    });
  }
  if (!ts.sourceEnc) throw new SheetError("This timesheet has no Google Sheet linked.", "not_found");
  const src = await openJson<{ spreadsheetId: string }>(userId, ts.sourceEnc);
  return new GoogleSheetAdapter(src.spreadsheetId);
}

export async function saveProfile(userId: string, id: string, profile: TimesheetProfile | null, status: "ready" | "failed") {
  await db()
    .update(timesheets)
    .set({ profileEnc: profile ? await sealJson(userId, profile) : null, profileStatus: status, updatedAt: new Date() })
    .where(and(eq(timesheets.id, id), eq(timesheets.userId, userId)));
}

export async function loadProfile(userId: string, ts: Timesheet): Promise<TimesheetProfile | null> {
  if (ts.userId !== userId || !ts.profileEnc) return null;
  return openJson<TimesheetProfile>(userId, ts.profileEnc);
}

/**
 * What the chat agent knows about every timesheet before it does anything: tab names plus the full
 * column definitions from the analysis, so it never has to guess where things live.
 */
export async function timesheetDigest(userId: string): Promise<string> {
  const list = await db().select().from(timesheets).where(eq(timesheets.userId, userId)).orderBy(timesheets.createdAt);
  if (!list.length) return "The user has no timesheets registered yet.";
  const out: string[] = [];
  for (const ts of list) {
    const p = await loadProfile(userId, ts).catch(() => null);
    out.push(`## "${ts.name}" (${ts.kind === "gsheet" ? "Google Sheet" : "Excel file"})`);
    if (!p) {
      out.push(`Not analysed yet (status: ${ts.profileStatus}). Call reanalyse_timesheet before reading or writing it.`);
      continue;
    }
    out.push(`Tabs: ${p.sheets.map((s) => `"${s.name}"`).join(", ")}`);
    const text = describeProfile(p);
    out.push(text.length > 3500 ? `${text.slice(0, 3500)}\n...(use get_timesheet_info for the rest)` : text);
  }
  return out.join("\n");
}

export { describeProfile };
