import { loadAdapter, loadProfile } from "@/lib/data/timesheets";
import type { Timesheet, User } from "@/lib/db/schema";
import { reportPdf, reportXlsx, totals } from "@/lib/sheets/export";
import { readEntries } from "@/lib/sheets/ops";
import { SheetError } from "@/lib/sheets/types";
import { isIsoDate, localParts } from "@/lib/time";

export const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "timesheet";

/**
 * Builds an Excel or PDF export. With no dates: xlsx = the whole workbook as-is, pdf = current month.
 * Shared by the chat agent's export tool and the "Download" buttons in the web app.
 */
export async function buildExport(args: {
  user: Pick<User, "id" | "name" | "timezone">;
  ts: Timesheet;
  format: "xlsx" | "pdf";
  from?: string;
  to?: string;
}) {
  const { user, ts, format } = args;
  const adapter = await loadAdapter(user.id, ts);
  if (format === "xlsx" && !args.from && !args.to) {
    return { bytes: await adapter.exportXlsx(), filename: `${slug(ts.name)}.xlsx`, mime: MIME.xlsx, entries: undefined, hours: undefined };
  }
  const profile = await loadProfile(user.id, ts);
  if (!profile) throw new SheetError(`"${ts.name}" hasn't been analysed yet.`, "invalid");
  const today = localParts(user.timezone).date;
  const from = args.from ?? `${today.slice(0, 7)}-01`;
  const to = args.to ?? new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)).toISOString().slice(0, 10);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new SheetError("That date range isn't valid.", "invalid");
  const entries = await readEntries(adapter, profile, { from, to });
  if (!entries.length) throw new SheetError(`There are no entries between ${from} and ${to} to export.`, "not_found");
  const report = { title: ts.name, person: user.name, from, to, entries };
  const bytes = format === "pdf" ? await reportPdf(report) : await reportXlsx(report);
  return { bytes, filename: `${slug(ts.name)}_${from}_to_${to}.${format}`, mime: MIME[format], entries: entries.length, hours: totals(entries).hours };
}
