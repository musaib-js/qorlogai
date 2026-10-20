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
import type { TimesheetProfile } from "@/lib/sheets/profile";
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
  const p = await loadProfile(ctx.userId, ts);
  if (!p) throw new ToolError(`"${ts.name}" hasn't been analysed yet. Call reanalyse_timesheet first.`);
  return p;
}

function checkDate(ctx: ToolContext, date: string, futureDays = 60) {
  if (!isIsoDate(date)) throw new ToolError(`"${date}" is not a valid date. Use YYYY-MM-DD.`);
  const today = localParts(ctx.timezone).date;
  if (date < addDays(today, -800) || date > addDays(today, futureDays)) {
    throw new ToolError(`${date} is too far from today (${today}). Confirm the date with the user.`);
  }
}

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
          return { ok: true as const, name: ts.name, structure: describeProfile(await profileOf(ctx, ts)) };
        }),
    }),

    read_entries: tool({
      description: "Read what is recorded in the timesheet between two dates (inclusive). Use it to answer questions or check before editing.",
      inputSchema: z.object({ timesheet: tsParam, from: dateParam, to: dateParam }),
      execute: async ({ timesheet, from, to }) =>
        run(async () => {
          checkDate(ctx, from, 400);
          checkDate(ctx, to, 400);
          const ts = await resolveTimesheet(ctx, timesheet);
          const entries = await readEntries(await loadAdapter(ctx.userId, ts), await profileOf(ctx, ts), { from, to });
          return {
            ok: true as const,
            timesheet: ts.name,
            count: entries.length,
            totals: totals(entries),
            truncated: entries.length > 60,
            entries: entries.slice(0, 60).map((e) => ({ date: e.date, hours: e.hours, tasks: e.tasks, project: e.project, notes: e.notes, leave: e.leave })),
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
        sheet: z.string().optional().describe("Tab name, only if the user names one"),
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
          const res = await setDayEntry(await loadAdapter(ctx.userId, ts), profile, input);
          return { ok: true as const, timesheet: ts.name, date: input.date, ...res };
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
          const res = await setDayEntry(await loadAdapter(ctx.userId, ts), await profileOf(ctx, ts), {
            date,
            leave: type,
            hours,
            notes: reason,
            mode: "replace",
          });
          return { ok: true as const, timesheet: ts.name, date, leave: type, ...res };
        }),
    }),

    export_timesheet: tool({
      description:
        "Generate the timesheet as an Excel (.xlsx) or PDF file. With no dates, xlsx returns the whole workbook and pdf covers the current month. The file is delivered to the user automatically.",
      inputSchema: z.object({
        timesheet: tsParam,
        format: z.enum(["xlsx", "pdf"]),
        from: z.string().optional().describe("YYYY-MM-DD"),
        to: z.string().optional().describe("YYYY-MM-DD"),
      }),
      execute: async ({ timesheet, format, from, to }) =>
        run(async () => {
          const ts = await resolveTimesheet(ctx, timesheet);
          if (from) checkDate(ctx, from, 400);
          if (to) checkDate(ctx, to, 400);
          const out = await buildExport({ user: { id: ctx.userId, name: ctx.userName, timezone: ctx.timezone }, ts, format, from, to });
          const fileId = await saveExport(ctx.userId, { filename: out.filename, mime: out.mime, bytes: out.bytes });
          ctx.files.push({ id: fileId, filename: out.filename, mime: out.mime });
          return { ok: true as const, fileId, filename: out.filename, format, entries: out.entries, hours: out.hours, delivered: true };
        }),
    }),

    read_sheet: tool({
      description:
        "Low-level: read raw cells from a sheet. Use only for unusual layouts or when you must inspect a sheet before write_cells. Returns at most 40 rows x 12 columns.",
      inputSchema: z.object({ timesheet: tsParam, sheet: z.string(), startRow: z.number().int().min(1).optional(), rows: z.number().int().min(1).max(40).optional() }),
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
          const ts = await resolveTimesheet(ctx, timesheet);
          const adapter = await loadAdapter(ctx.userId, ts);
          await adapter.write(sheet, cells);
          await adapter.save();
          return { ok: true as const, written: cells.length };
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
