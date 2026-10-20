import { tool } from "ai";
import { z } from "zod";

import type { Channel } from "./channel";
import { analyseAndSave } from "./profiling";
import { getTimesheet, listTimesheets, loadAdapter, loadProfile, describeProfile } from "@/lib/data/timesheets";
import { saveExport } from "@/lib/data/messages";
import { setState } from "@/lib/data/channels";
import { updateSettings } from "@/lib/data/users";
import type { Timesheet } from "@/lib/db/schema";
import { totals } from "@/lib/sheets/export";
import { buildExport } from "@/lib/exporter";
import { readEntries, setDayEntry } from "@/lib/sheets/ops";
import { PROFILE_VERSION, type TimesheetProfile } from "@/lib/sheets/profile";
import type { SheetAdapter } from "@/lib/sheets/types";
import { SheetError } from "@/lib/sheets/types";
import { addDays, isIsoDate, localParts, resolveTimezoneLocal } from "@/lib/time";

/**
 * Tools are created PER REQUEST with the caller's userId closed over. The model never supplies a
 * user id, so no prompt (or prompt injection hidden in a sheet) can reach another user's data.
 */

export interface ToolContext {
  userId: string;
  userName: string;
  channel: Channel;
  /** chat id / phone number on messenger channels */
  externalId?: string;
  timezone: string;
  /** files produced during this turn; the channel layer delivers them */
  files: { id: string; filename: string; mime: string }[];
}

class ToolError extends Error {}

async function run<T extends object>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError || e instanceof SheetError) return { ok: false, error: e.message };
    console.error("tool failure", e);
    return { ok: false, error: "Something went wrong while working with the timesheet." };
  }
}

async function resolveTimesheet(ctx: ToolContext, name?: string): Promise<Timesheet> {
  const all = await listTimesheets(ctx.userId);
  if (!all.length) throw new ToolError("The user has no timesheets yet. Offer to add one (begin_add_timesheet).");
  if (name) {
    const ts = await getTimesheet(ctx.userId, name);
    if (!ts) throw new ToolError(`No timesheet called "${name}". Available: ${all.map((t) => `"${t.name}"`).join(", ")}.`);
    return ts;
  }
  if (all.length === 1) return (await getTimesheet(ctx.userId, all[0].id))!;
  throw new ToolError(`The user has several timesheets. Ask which one: ${all.map((t) => `"${t.name}"`).join(", ")}.`);
}

async function profileOf(ctx: ToolContext, ts: Timesheet): Promise<TimesheetProfile> {
  let p = await loadProfile(ctx.userId, ts);
  // profiles made before column descriptions / leave markers existed are upgraded on first use
  if (p && (p.version ?? 1) < PROFILE_VERSION) p = await analyseAndSave(ctx.userId, ts).catch(() => p);
  if (!p) throw new ToolError(`"${ts.name}" hasn't been analysed yet. Call reanalyse_timesheet first.`);
  return p;
}

/** "2026-11" -> first and last day, so the model never does date arithmetic. */
function monthRange(month: string): { from: string; to: string } {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new ToolError(`"${month}" is not a valid month. Use YYYY-MM, e.g. 2026-11.`);
  return { from: `${month}-01`, to: new Date(Date.UTC(+m[1], +m[2], 0)).toISOString().slice(0, 10) };
}

function range(ctx: ToolContext, a: { from?: string; to?: string; month?: string }, required: boolean) {
  let { from, to } = a;
  if (a.month) ({ from, to } = monthRange(a.month));
  if (required && (!from || !to)) throw new ToolError("Give either month (YYYY-MM) or both from and to (YYYY-MM-DD).");
  if (from) checkDate(ctx, from, 400);
  if (to) checkDate(ctx, to, 400);
  return { from, to };
}

/**
 * An xlsx timesheet is one encrypted blob: every write loads it, edits it and stores the whole file.
 * Two writes at once (models often emit several tool calls in one step) would each start from the
 * same old copy and the last save would silently erase the other. So writes to one timesheet queue up.
 */
const queues = new Map<string, Promise<unknown>>();
function exclusive<T>(timesheetId: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(timesheetId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = next.catch(() => undefined);
  queues.set(timesheetId, tail);
  void tail.then(() => queues.get(timesheetId) === tail && queues.delete(timesheetId));
  return next;
}

/** Reopens the timesheet from storage (not the copy fetched before the write) so a write is proven, not assumed. */
async function reopen(ctx: ToolContext, ts: Timesheet) {
  const fresh = await getTimesheet(ctx.userId, ts.id);
  if (!fresh) throw new ToolError("The timesheet disappeared while saving.");
  return loadAdapter(ctx.userId, fresh);
}

async function readBack(ctx: ToolContext, ts: Timesheet, profile: TimesheetProfile, date: string, sheet?: string) {
  return readEntries(await reopen(ctx, ts), profile, { from: date, to: date, sheet });
}

const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.01;
const compact = (e: { date: string; hours: number | null; tasks: string | null; project: string | null; notes: string | null; leave: string | null }) => ({
  date: e.date, hours: e.hours, tasks: e.tasks, project: e.project, notes: e.notes, leave: e.leave,
});

function checkDate(ctx: ToolContext, date: string, futureDays = 60) {
  if (!isIsoDate(date)) throw new ToolError(`"${date}" is not a valid date. Use YYYY-MM-DD.`);
  const today = localParts(ctx.timezone).date;
  if (date < addDays(today, -800) || date > addDays(today, futureDays)) {
    throw new ToolError(`${date} is too far from today (${today}). Confirm the date with the user.`);
  }
}

const monthParam = z.string().optional().describe("Whole month as YYYY-MM (e.g. 2026-11 for the Nov-26 tab). Use instead of from/to for 'November', 'last month' etc.");
const sheetParam = z.string().optional().describe("Tab name, only if the user names one. Any spelling works: 'November 26' finds the tab 'Nov-26'.");
const tsParam = z.string().optional().describe("Timesheet name. Omit only if the user has exactly one timesheet.");
const dateParam = z.string().describe("Date as YYYY-MM-DD in the user's timezone");

export function createTools(ctx: ToolContext) {
  return {
    list_timesheets: tool({
      description: "List the user's registered timesheets.",
      inputSchema: z.object({}),
      execute: async () =>
        run(async () => ({
          ok: true as const,
          timesheets: (await listTimesheets(ctx.userId)).map((t) => ({ name: t.name, type: t.kind, status: t.profileStatus })),
        })),
    }),

    get_timesheet_info: tool({
      description: "Explain how a timesheet is structured (sheets, columns, layout, whether it records hours or tasks).",
      inputSchema: z.object({ timesheet: tsParam }),
      execute: async ({ timesheet }) =>
        run(async () => {
          const ts = await resolveTimesheet(ctx, timesheet);
          const profile = await profileOf(ctx, ts);
          return { ok: true as const, name: ts.name, sheets: profile.sheets.map((x) => ({ name: x.name, role: x.role })), structure: describeProfile(profile) };
        }),
    }),

    read_entries: tool({
      description:
        "Read the individual entries (date, hours, tasks, leave) between two dates. Use it to show or check specific days. For COUNTS and TOTALS (leave days, total hours) use summarize_period instead; never count rows yourself.",
      inputSchema: z.object({ timesheet: tsParam, from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional().describe("YYYY-MM-DD"), month: monthParam, sheet: sheetParam }),
      execute: async ({ timesheet, from, to, month, sheet }) =>
        run(async () => {
          const r = range(ctx, { from, to, month }, true);
          const ts = await resolveTimesheet(ctx, timesheet);
          const entries = await readEntries(await loadAdapter(ctx.userId, ts), await profileOf(ctx, ts), { from: r.from!, to: r.to!, sheet });
          return {
            ok: true as const,
            timesheet: ts.name,
            from: r.from,
            to: r.to,
            count: entries.length,
            totals: totals(entries),
            truncated: entries.length > 60,
            entries: entries.slice(0, 60).map(compact),
          };
        }),
    }),

    summarize_period: tool({
      description:
        "Exact counts for a period: days logged, total hours, leave days (full and half, with dates). The numbers are computed by code from the sheet's own leave column, so quote them as they are. Use for 'how many leaves', 'total hours in November'.",
      inputSchema: z.object({ timesheet: tsParam, from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional().describe("YYYY-MM-DD"), month: monthParam, sheet: sheetParam }),
      execute: async ({ timesheet, from, to, month, sheet }) =>
        run(async () => {
          const r = range(ctx, { from, to, month }, true);
          const ts = await resolveTimesheet(ctx, timesheet);
          const profile = await profileOf(ctx, ts);
          const entries = await readEntries(await loadAdapter(ctx.userId, ts), profile, { from: r.from!, to: r.to!, sheet });
          if (!entries.length) {
            throw new ToolError(`No dated rows between ${r.from} and ${r.to}${sheet ? ` in "${sheet}"` : ""}. Sheets: ${profile.sheets.map((x) => `"${x.name}"`).join(", ")}.`);
          }
          const leaveCols = profile.sheets.flatMap((x) => x.columns.filter((c) => c.meaning === "leave").map((c) => `"${c.header}" (sheet "${x.name}")`));
          return {
            ok: true as const,
            timesheet: ts.name,
            from: r.from,
            to: r.to,
            sheets: [...new Set(entries.map((e) => e.sheet))],
            ...totals(entries),
            basis: leaveCols.length
              ? `Leave counted from the ${leaveCols.join(", ")} column using: ${profile.leaveMarkers?.map((m) => `"${m.text}"=${m.days}`).join(", ") || "standard leave wording"}. Holidays and weekends are not leave.`
              : "This sheet has no leave column; leave counted only where a task/notes cell starts with a leave label.",
          };
        }),
    }),

    set_day_entry: tool({
      description:
        "Create or change the entry for one date. Use for 'log my day', 'I worked 6 hours', 'update last Friday'. mode=replace overwrites that date's entry (default), mode=append adds to it ('also did X'). Hours-only timesheets need hours; task-based ones need tasks; mixed ones need at least one.",
      inputSchema: z.object({
        timesheet: tsParam,
        date: dateParam,
        hours: z.number().min(0).max(24).optional().describe("Total hours worked that day"),
        tasks: z
          .array(
            z.object({
              description: z.string().describe("Clean, concise description of one piece of work"),
              hours: z.number().min(0).max(24).optional(),
              project: z.string().optional(),
            }),
          )
          .optional(),
        notes: z.string().optional(),
        mode: z.enum(["replace", "append"]).optional(),
        sheet: sheetParam,
      }),
      execute: async (input) =>
        run(async () => {
          checkDate(ctx, input.date);
          const ts = await resolveTimesheet(ctx, input.timesheet);
          const profile = await profileOf(ctx, ts);
          const hasTasks = !!input.tasks?.some((t) => t.description.trim());
          const hasHours = input.hours != null || !!input.tasks?.some((t) => t.hours != null);
          if (profile.recordsMode === "hours_only" && !hasHours) throw new ToolError("This timesheet records hours. Ask the user how many hours they worked.");
          if (profile.recordsMode === "task_based" && !hasTasks) throw new ToolError("This timesheet records tasks. Ask the user what they worked on.");
          if (profile.recordsMode === "mixed" && !hasTasks && !hasHours) throw new ToolError("Ask the user for their hours and/or what they worked on.");
          const res = await exclusive(ts.id, async () => setDayEntry(await loadAdapter(ctx.userId, (await getTimesheet(ctx.userId, ts.id)) ?? ts), profile, input));
          // prove it: read the date back from storage with a fresh connection
          const after = await readBack(ctx, ts, profile, input.date, res.sheet);
          const expectHours = input.hours ?? (input.tasks?.some((t) => t.hours != null) ? input.tasks.reduce((a, t) => a + (t.hours ?? 0), 0) : null);
          const firstTask = input.tasks?.find((t) => t.description.trim())?.description.trim().slice(0, 18).toLowerCase();
          const problems: string[] = [];
          if (!after.length) problems.push("the date has no row");
          if (after.length && expectHours != null && (input.mode ?? "replace") === "replace" && !near(after.reduce((a, e) => a + (e.hours ?? 0), 0), expectHours)) problems.push("the hours differ");
          if (after.length && firstTask && profile.sheets.some((x) => x.name === res.sheet && x.columns.some((c) => c.meaning === "tasks")) && !after.some((e) => e.tasks?.toLowerCase().includes(firstTask))) problems.push("the task text is missing");
          if (problems.length) {
            throw new ToolError(`The write could not be confirmed when read back from "${res.sheet}" (${problems.join("; ")}). Do NOT tell the user it was saved; say it failed and suggest re-analysing the timesheet.`);
          }
          return { ok: true as const, verified: true as const, timesheet: ts.name, date: input.date, ...res, nowInSheet: after.map(compact) };
        }),
    }),

    mark_leave: tool({
      description:
        "Mark a full day or half day of leave. Existing task text for that date is kept. For a half day, pass hours if the user says how many hours they worked.",
      inputSchema: z.object({
        timesheet: tsParam,
        date: dateParam,
        type: z.enum(["full", "half"]),
        hours: z.number().min(0).max(24).optional(),
        reason: z.string().optional(),
      }),
      execute: async ({ timesheet, date, type, hours, reason }) =>
        run(async () => {
          checkDate(ctx, date);
          const ts = await resolveTimesheet(ctx, timesheet);
          const profile = await profileOf(ctx, ts);
          const res = await exclusive(ts.id, async () =>
            setDayEntry(await loadAdapter(ctx.userId, (await getTimesheet(ctx.userId, ts.id)) ?? ts), profile, { date, leave: type, hours, notes: reason, mode: "replace" }),
          );
          const after = await readBack(ctx, ts, profile, date, res.sheet);
          if (!after.some((e) => e.leaveDays > 0)) {
            throw new ToolError(`Leave could not be confirmed on ${date} when read back from "${res.sheet}". Do NOT tell the user it was saved.`);
          }
          return { ok: true as const, verified: true as const, timesheet: ts.name, date, leave: type, ...res, nowInSheet: after.map(compact) };
        }),
    }),

    export_timesheet: tool({
      description:
        "Generate the timesheet as an Excel (.xlsx) or PDF file and deliver it to the user. For a named month pass month=YYYY-MM. With no dates xlsx returns the whole workbook and pdf covers the current month. Only say a file is ready if this returns ok: true with a fileId.",
      inputSchema: z.object({
        timesheet: tsParam,
        format: z.enum(["xlsx", "pdf"]),
        month: monthParam,
        from: z.string().optional().describe("YYYY-MM-DD"),
        to: z.string().optional().describe("YYYY-MM-DD"),
      }),
      execute: async ({ timesheet, format, month, ...dates }) =>
        run(async () => {
          const ts = await resolveTimesheet(ctx, timesheet);
          const { from, to } = range(ctx, { ...dates, month }, false);
          const out = await buildExport({ user: { id: ctx.userId, name: ctx.userName, timezone: ctx.timezone }, ts, format, from, to });
          const fileId = await saveExport(ctx.userId, { filename: out.filename, mime: out.mime, bytes: out.bytes });
          ctx.files.push({ id: fileId, filename: out.filename, mime: out.mime });
          if (!out.bytes.length) throw new ToolError("The generated file was empty.");
          return { ok: true as const, fileId, filename: out.filename, format, sizeKb: Math.max(1, Math.round(out.bytes.length / 1024)), entries: out.entries, hours: out.hours, delivered: true };
        }),
    }),

    read_sheet: tool({
      description:
        "Low-level: read raw cells from a sheet. Use only for unusual layouts or when you must inspect a sheet before write_cells. Returns at most 40 rows x 12 columns.",
      inputSchema: z.object({ timesheet: tsParam, sheet: z.string().describe("Tab name; any spelling that identifies it works"), startRow: z.number().int().min(1).optional(), rows: z.number().int().min(1).max(40).optional() }),
      execute: async ({ timesheet, sheet, startRow, rows }) =>
        run(async () => {
          const ts = await resolveTimesheet(ctx, timesheet);
          const data = await (await loadAdapter(ctx.userId, ts)).read(sheet, { startRow: startRow ?? 1, maxRows: rows ?? 30, maxCols: 12 });
          return { ok: true as const, startRow: startRow ?? 1, rows: data };
        }),
    }),

    write_cells: tool({
      description:
        "Low-level: write specific cells (1-based row/col). Use only when set_day_entry can't handle the layout. Max 30 cells. Never write formulas.",
      inputSchema: z.object({
        timesheet: tsParam,
        sheet: z.string(),
        cells: z.array(z.object({ row: z.number().int().min(1).max(5000), col: z.number().int().min(1).max(60), value: z.union([z.string(), z.number(), z.null()]) })).min(1).max(30),
      }),
      execute: async ({ timesheet, sheet, cells }) =>
        run(async () => {
          if (cells.some((c) => typeof c.value === "string" && c.value.trim().startsWith("="))) throw new ToolError("Formulas are not allowed. Write plain values.");
          const ts = await resolveTimesheet(ctx, timesheet);
          await exclusive(ts.id, async () => {
            const adapter = await loadAdapter(ctx.userId, (await getTimesheet(ctx.userId, ts.id)) ?? ts);
            await adapter.write(sheet, cells);
            await adapter.save();
          });
          // read every cell back from storage and compare
          const fresh = await reopen(ctx, ts);
          const readBackCells: { row: number; col: number; value: unknown }[] = [];
          const bad: string[] = [];
          for (const c of cells) {
            const got = (await fresh.read(sheet, { startRow: c.row, maxRows: 1, maxCols: c.col }))[0]?.[c.col - 1] ?? null;
            readBackCells.push({ row: c.row, col: c.col, value: got });
            const want = c.value;
            const same = want == null ? got == null || got === "" : String(got).trim() === String(want).trim() || (typeof want === "number" && Number(got) === want);
            if (!same) bad.push(`R${c.row}C${c.col}`);
          }
          if (bad.length) throw new ToolError(`Some cells did not hold the new value when read back (${bad.join(", ")}). Do NOT tell the user it was saved.`);
          return { ok: true as const, verified: true as const, written: cells.length, readBack: readBackCells };
        }),
    }),

    reanalyse_timesheet: tool({
      description: "Re-read the timesheet's structure (use if the user changed the sheet layout or entries land in the wrong place).",
      inputSchema: z.object({ timesheet: tsParam }),
      execute: async ({ timesheet }) =>
        run(async () => {
          const ts = await resolveTimesheet(ctx, timesheet);
          const profile = await analyseAndSave(ctx.userId, ts);
          return { ok: true as const, structure: describeProfile(profile) };
        }),
    }),

    update_settings: tool({
      description: "Change the user's timezone or daily reminder (time, on/off, weekends).",
      inputSchema: z.object({
        timezone: z.string().optional().describe("IANA name or a city, e.g. Asia/Kolkata, London"),
        reminderTime: z.string().optional().describe("24h HH:MM in the user's local time"),
        reminderEnabled: z.boolean().optional(),
        remindWeekends: z.boolean().optional(),
      }),
      execute: async (input) =>
        run(async () => {
          const patch: Parameters<typeof updateSettings>[1] = {};
          if (input.timezone) {
            const tz = resolveTimezoneLocal(input.timezone);
            if (!tz) throw new ToolError(`Couldn't recognise the timezone "${input.timezone}". Ask for a city or an IANA name like Asia/Kolkata.`);
            patch.timezone = tz;
          }
          if (input.reminderTime) {
            const m = input.reminderTime.match(/^(\d{1,2}):(\d{2})$/);
            if (!m || +m[1] > 23 || +m[2] > 59) throw new ToolError("reminderTime must be HH:MM in 24h format.");
            patch.reminderMinutes = +m[1] * 60 + +m[2];
          }
          if (input.reminderEnabled !== undefined) patch.reminderEnabled = input.reminderEnabled;
          if (input.remindWeekends !== undefined) patch.remindWeekends = input.remindWeekends;
          const u = await updateSettings(ctx.userId, patch);
          return {
            ok: true as const,
            timezone: u.timezone,
            reminder: u.reminderEnabled ? `${String(Math.floor(u.reminderMinutes / 60)).padStart(2, "0")}:${String(u.reminderMinutes % 60).padStart(2, "0")}${u.remindWeekends ? " daily" : " on weekdays"}` : "off",
          };
        }),
    }),

    begin_add_timesheet: tool({
      description: "Start adding a new timesheet when the user wants to register one.",
      inputSchema: z.object({}),
      execute: async () =>
        run(async () => {
          if (ctx.channel === "web") {
            return { ok: true as const, instruction: "Tell the user to open the Timesheets page and press 'Add timesheet' (/timesheets/new). There they can upload a file or paste a Google Sheet link." };
          }
          if (!ctx.externalId) throw new ToolError("Cannot start onboarding on this channel.");
          await setState(ctx.channel, ctx.externalId, "ts_name", {});
          return { ok: true as const, instruction: "Onboarding started. Ask the user what to call the new timesheet (e.g. 'Acme Corp')." };
        }),
    }),
  };
}

export type AgentTools = ReturnType<typeof createTools>;
