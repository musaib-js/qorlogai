import { analyseAndSave } from "@/lib/agent/profiling";
import { friendlySummary } from "@/lib/agent/summary";
import { createTimesheet } from "@/lib/data/timesheets";
import { json, sameOrigin } from "@/lib/http";
import { apiUser } from "@/lib/session";
import { parseSpreadsheetId, probeSpreadsheet, serviceAccountEmail } from "@/lib/sheets/google";
import { SheetError } from "@/lib/sheets/types";
import { XlsxAdapter } from "@/lib/sheets/xlsx-adapter";

export const maxDuration = 60;
const MAX_BYTES = 4 * 1024 * 1024; // Vercel request bodies are capped at ~4.5 MB

/** Create a timesheet from an uploaded .xlsx (multipart) or a Google Sheet link, then analyse it. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await apiUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Invalid form data" }, 400);
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  if (!name || name.length > 60) return json({ error: "Give the timesheet a name (up to 60 characters)." }, 400);

  try {
    let ts;
    if (kind === "xlsx") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return json({ error: "Choose an .xlsx file." }, 400);
      if (!/\.xlsx$/i.test(file.name)) return json({ error: "Only .xlsx files are supported. Save .xls or .csv files as .xlsx first." }, 400);
      if (file.size > MAX_BYTES) return json({ error: "That file is larger than 4 MB." }, 413);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: "That doesn't look like a real .xlsx file." }, 400);
      await XlsxAdapter.load(bytes); // throws SheetError if unreadable
      ts = await createTimesheet(user.id, { name, kind: "xlsx", file: bytes });
    } else if (kind === "gsheet") {
      const url = String(form.get("url") ?? "").trim();
      const spreadsheetId = parseSpreadsheetId(url);
      if (!spreadsheetId) return json({ error: "That doesn't look like a Google Sheets link." }, 400);
      const email = serviceAccountEmail();
      if (!email) return json({ error: "Google Sheets isn't configured on this server. Upload an .xlsx instead." }, 501);
      try {
        await probeSpreadsheet(spreadsheetId);
      } catch (e) {
        if (e instanceof SheetError && e.code === "no_access") {
          return json({ error: "Qorlog can't open that sheet yet.", code: "no_access", serviceAccountEmail: email }, 409);
        }
        throw e;
      }
      ts = await createTimesheet(user.id, { name, kind: "gsheet", spreadsheetId, url });
    } else {
      return json({ error: "Unknown timesheet type." }, 400);
    }

    try {
      const profile = await analyseAndSave(user.id, ts);
      return json({ id: ts.id, analysed: true, summary: friendlySummary(ts.name, profile) });
    } catch {
      return json({ id: ts.id, analysed: false, summary: "Saved, but the analysis failed. Open the timesheet and press Re-analyse." });
    }
  } catch (e) {
    if (e instanceof SheetError) return json({ error: e.message, code: e.code }, e.code === "invalid" ? 400 : 422);
    console.error("timesheet create failed", e);
    return json({ error: "Couldn't save the timesheet." }, 500);
  }
}
