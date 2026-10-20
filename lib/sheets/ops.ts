import { colOf, type SheetProfile, type TimesheetProfile } from "./profile";
import type { Cell, CellWrite, SheetAdapter } from "./types";
import { SheetError } from "./types";
import { classifyLeave } from "./leave";
import { matchSheetName } from "./names";
import { formatDate, monthKey, orderFromFormat, parseCellDate, parseMonthFromTabName } from "@/lib/time";

const MAX_SCAN = 800;

export interface TaskInput {
  description: string;
  hours?: number | null;
  project?: string | null;
}

export interface DayEntryInput {
  date: string; // yyyy-mm-dd
  hours?: number | null;
  tasks?: TaskInput[];
  notes?: string | null;
  leave?: "full" | "half" | null;
  /** replace: overwrite what is there for that date. append: add to it. */
  mode?: "replace" | "append";
  sheet?: string;
}

export interface EntryRow {
  sheet: string;
  row: number;
  date: string;
  hours: number | null;
  tasks: string | null;
  project: string | null;
  notes: string | null;
  leave: string | null;
  /** 0, 0.5 or 1, worked out from the sheet's own leave vocabulary (never from free-text mentions) */
  leaveDays: number;
}

export function entrySheets(profile: TimesheetProfile): SheetProfile[] {
  return profile.sheets.filter(
    (s) =>
      s.role === "entry" &&
      (s.layout === "row_per_day" || s.layout === "row_per_entry") &&
      s.firstDataRow &&
      colOf(s, "date"),
  );
}

export function pickSheet(profile: TimesheetProfile, date: string, explicit?: string): SheetProfile {
  if (explicit) {
    const real = matchSheetName(profile.sheets.map((x) => x.name), explicit);
    const s = profile.sheets.find((x) => x.name === real);
    if (!s) {
      throw new SheetError(`There is no sheet matching "${explicit}". The sheets are: ${profile.sheets.map((x) => `"${x.name}"`).join(", ")}.`, "not_found");
    }
    return s;
  }
  const sheets = entrySheets(profile);
  if (!sheets.length) {
    throw new SheetError(
      "No sheet in this timesheet is understood well enough to write to automatically. Ask the user which sheet and columns to use, then use read_sheet and write_cells.",
      "unsupported",
    );
  }
  const mk = monthKey(date);
  const byMonth = sheets.filter((s) => parseMonthFromTabName(s.name) === mk);
  if (byMonth.length) return byMonth[0];
  if (profile.sheetSelection === "tab_per_month") {
    throw new SheetError(`This timesheet has one tab per month and there is no tab for ${mk}. Tell the user; do not guess another tab.`, "not_found");
  }
  return sheets[0];
}

const maxCol = (s: SheetProfile) => Math.max(1, ...s.columns.map((c) => c.col));

async function scan(adapter: SheetAdapter, s: SheetProfile) {
  const first = s.firstDataRow!;
  const rows = await adapter.read(s.name, { startRow: first, maxRows: MAX_SCAN, maxCols: maxCol(s) });
  return rows.map((cells, i) => ({ row: first + i, cells }));
}

function parseHours(c: Cell): number | null {
  if (c == null || c === "") return null;
  if (typeof c === "number") return c;
  const s = String(c).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s.replace(/h(ours?|rs?)?$/i, "").trim());
  return Number.isFinite(n) ? n : null;
}

const str = (c: Cell | undefined): string | null => (c == null || c === "" ? null : String(c));

function dateCellValue(adapter: SheetAdapter, s: SheetProfile, iso: string): Cell | Date {
  return adapter.kind === "xlsx" ? new Date(`${iso}T00:00:00Z`) : formatDate(iso, s.dateFormat ?? "DD/MM/YYYY");
}

interface RowContent {
  hours?: number | null;
  description?: string | null;
  project?: string | null;
  notes?: string | null;
  leaveLabel?: string | null;
}

function buildWrites(adapter: SheetAdapter, s: SheetProfile, row: number, iso: string, c: RowContent, withDate: boolean): CellWrite[] {
  const w: CellWrite[] = [];
  const put = (col: number | null, value: Cell | Date | undefined, numFmt?: string) => {
    if (col && value !== undefined) w.push({ row, col, value, numFmt });
  };
  if (withDate) {
    put(colOf(s, "date"), dateCellValue(adapter, s, iso), s.dateFormat ?? undefined);
    put(colOf(s, "day_of_week"), formatDate(iso, "dddd"));
  }
  put(colOf(s, "hours"), c.hours);
  put(colOf(s, "tasks"), c.description);
  put(colOf(s, "project"), c.project);
  put(colOf(s, "notes"), c.notes);
  put(colOf(s, "leave"), c.leaveLabel);
  return w;
}

function rowValues(s: SheetProfile, writes: CellWrite[]): (Cell | Date)[] {
  const vals: (Cell | Date)[] = Array(maxCol(s)).fill(null);
  for (const w of writes) vals[w.col - 1] = w.value;
  return vals;
}

export interface WriteResult {
  sheet: string;
  action: "updated" | "appended" | "updated_and_appended";
  rows: number[];
  warnings: string[];
}

export async function setDayEntry(adapter: SheetAdapter, profile: TimesheetProfile, input: DayEntryInput): Promise<WriteResult> {
  const s = pickSheet(profile, input.date, input.sheet);
  if (!(s.layout === "row_per_day" || s.layout === "row_per_entry") || !s.firstDataRow || !colOf(s, "date")) {
    throw new SheetError(
      `Sheet "${s.name}" has a layout (${s.layout}) that set_day_entry can't write to. Use read_sheet and write_cells instead.`,
      "unsupported",
    );
  }
  const warnings: string[] = [];
  const mode = input.mode ?? "replace";
  const order = orderFromFormat(s.dateFormat);
  const dateCol = colOf(s, "date")!;
  const scanned = await scan(adapter, s);
  const matches = scanned.filter((r) => parseCellDate(r.cells[dateCol - 1], order) === input.date);

  const tasks = (input.tasks ?? []).filter((t) => t.description.trim());
  const leaveLabel = input.leave === "full" ? "Leave" : input.leave === "half" ? "Half day leave" : null;
  const hasLeaveCol = !!colOf(s, "leave");
  const hasTasksCol = !!colOf(s, "tasks");
  const hasNotesCol = !!colOf(s, "notes");
  if (leaveLabel && !hasLeaveCol && !hasTasksCol && !hasNotesCol) {
    throw new SheetError("This sheet has no leave, tasks or notes column to record leave in.", "unsupported");
  }
  const summedHours = tasks.some((t) => t.hours != null) ? tasks.reduce((a, t) => a + (t.hours ?? 0), 0) : null;
  let hours = input.hours ?? summedHours;
  if (input.leave === "full" && hours == null) hours = 0;
  const unmanaged = profile.sheets.find((x) => x.name === s.name)?.columns.filter((c) => c.meaning === "computed").length;
  if (unmanaged) warnings.push("This sheet has computed columns (formulas/totals). They were left alone; new rows may need the formula filled down.");

  const rowsTouched: number[] = [];
  let updated = false;
  let appended = false;

  if (s.layout === "row_per_day") {
    const description = tasks.map((t) => t.description.trim()).join("; ") || null;
    const project = [...new Set(tasks.map((t) => t.project?.trim()).filter(Boolean))].join(", ") || null;
    const existing = matches[0];
    const tasksIdx = (colOf(s, "tasks") ?? 0) - 1;
    const hoursIdx = (colOf(s, "hours") ?? 0) - 1;
    const oldDesc = existing && tasksIdx >= 0 ? str(existing.cells[tasksIdx]) : null;
    const oldHours = existing && hoursIdx >= 0 ? parseHours(existing.cells[hoursIdx]) : null;

    // undefined = leave the cell alone. Only things the caller actually supplied are written.
    let finalDesc: string | null | undefined = description;
    let finalHours: number | null | undefined = hours ?? undefined;
    let finalNotes: string | null | undefined = input.notes ?? undefined;
    if (!description && existing) finalDesc = undefined;
    if (existing && mode === "append") {
      if (oldDesc && description) finalDesc = `${oldDesc}; ${description}`;
      if (oldHours != null && hours != null) finalHours = oldHours + hours;
    }
    if (leaveLabel && !hasLeaveCol) {
      // no dedicated leave column: record the label in the task text, or in notes
      if (hasTasksCol) {
        const base = finalDesc === undefined ? oldDesc : finalDesc;
        if (!base || !base.toLowerCase().startsWith(leaveLabel.toLowerCase())) {
          finalDesc = [leaveLabel, base].filter(Boolean).join(" - ");
        }
      } else {
        finalNotes = [leaveLabel, input.notes].filter(Boolean).join(" - ");
      }
    }
    const content: RowContent = {
      hours: finalHours,
      description: hasTasksCol ? finalDesc : undefined,
      project: description ? (project ?? (mode === "replace" ? null : undefined)) : undefined,
      notes: hasNotesCol ? finalNotes : undefined,
      leaveLabel: hasLeaveCol ? (leaveLabel ?? undefined) : undefined,
    };
    if (existing) {
      await adapter.write(s.name, buildWrites(adapter, s, existing.row, input.date, content, false));
      rowsTouched.push(existing.row);
      updated = true;
    } else {
      const writes = buildWrites(adapter, s, 0, input.date, content, true);
      const row = await adapter.appendRow(s.name, rowValues(s, writes));
      rowsTouched.push(row);
      appended = true;
    }
  } else {
    // row_per_entry: one row per task
    let items: TaskInput[] = tasks;
    if (!items.length) items = [{ description: input.notes ?? "", hours }];
    if (leaveLabel) {
      items = [{ description: [leaveLabel, ...tasks.map((t) => t.description)].filter(Boolean).join(" - "), hours: hours ?? undefined }];
    }
    const oneRowHours = items.length === 1 && items[0].hours == null ? hours : undefined;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const content: RowContent = {
        hours: it.hours ?? oneRowHours ?? null,
        description: hasTasksCol ? it.description || null : undefined,
        project: it.project ?? null,
        notes: i === 0 && hasNotesCol ? (input.notes ?? null) : undefined,
        leaveLabel: hasLeaveCol ? (leaveLabel ?? null) : undefined,
      };
      const target = mode === "replace" ? matches[i] : undefined;
      if (target) {
        await adapter.write(s.name, buildWrites(adapter, s, target.row, input.date, content, false));
        rowsTouched.push(target.row);
        updated = true;
      } else {
        const writes = buildWrites(adapter, s, 0, input.date, content, true);
        rowsTouched.push(await adapter.appendRow(s.name, rowValues(s, writes)));
        appended = true;
      }
    }
    if (mode === "replace") {
      for (const extra of matches.slice(items.length)) {
        await adapter.write(s.name, buildWrites(adapter, s, extra.row, input.date, { hours: null, description: hasTasksCol ? null : undefined, project: null }, false));
        rowsTouched.push(extra.row);
        updated = true;
      }
    }
  }

  await adapter.save();
  return {
    sheet: s.name,
    action: updated && appended ? "updated_and_appended" : appended ? "appended" : "updated",
    rows: rowsTouched,
    warnings,
  };
}

export async function readEntries(
  adapter: SheetAdapter,
  profile: TimesheetProfile,
  opts: { from: string; to: string; sheet?: string },
): Promise<EntryRow[]> {
  const sheets = opts.sheet ? [pickSheet(profile, opts.from, opts.sheet)] : entrySheets(profile);
  const out: EntryRow[] = [];
  const fromM = monthKey(opts.from);
  const toM = monthKey(opts.to);
  for (const s of sheets) {
    if (!colOf(s, "date") || !s.firstDataRow) continue;
    const tabMonth = parseMonthFromTabName(s.name);
    if (tabMonth && profile.sheetSelection === "tab_per_month" && (tabMonth < fromM || tabMonth > toM)) continue;
    const order = orderFromFormat(s.dateFormat);
    const idx = (m: Parameters<typeof colOf>[1]) => (colOf(s, m) ?? 0) - 1;
    for (const { row, cells } of await scan(adapter, s)) {
      const date = parseCellDate(cells[idx("date")], order);
      if (!date || date < opts.from || date > opts.to) continue;
      const leaveIdx = idx("leave");
      const leaveDays =
        leaveIdx >= 0
          ? classifyLeave(cells[leaveIdx], { inLeaveColumn: true, markers: profile.leaveMarkers })
          : Math.max(
              idx("tasks") >= 0 ? classifyLeave(cells[idx("tasks")], { inLeaveColumn: false }) : 0,
              idx("notes") >= 0 ? classifyLeave(cells[idx("notes")], { inLeaveColumn: false }) : 0,
            );
      out.push({
        sheet: s.name,
        row,
        date,
        hours: idx("hours") >= 0 ? parseHours(cells[idx("hours")]) : null,
        tasks: idx("tasks") >= 0 ? str(cells[idx("tasks")]) : null,
        project: idx("project") >= 0 ? str(cells[idx("project")]) : null,
        notes: idx("notes") >= 0 ? str(cells[idx("notes")]) : null,
        leave: idx("leave") >= 0 ? str(cells[idx("leave")]) : null,
        leaveDays,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
}
