import { z } from "zod";

import type { Cell } from "./types";
import { parseCellDate, parseMonthFromTabName } from "@/lib/time";

/**
 * A TimesheetProfile is what the profiling agent learns about a user's timesheet: which sheets exist,
 * where the header is, which column means what. Every later write is driven by it.
 * (Fields are nullable rather than optional so the schema works with strict structured outputs.)
 */

export const COLUMN_MEANINGS = [
  "date", "hours", "tasks", "project", "notes", "leave", "start_time", "end_time", "day_of_week", "computed", "other",
] as const;
export const LAYOUTS = ["row_per_day", "row_per_entry", "grid", "unknown"] as const;

export const ColumnSchema = z.object({
  col: z.number().int().min(1).describe("1-based column number (A=1)"),
  header: z.string(),
  description: z.string().describe(
    'One plain sentence on what this column holds, with real example values from the sheet, e.g. "Attendance status per day: Present, Leave, Half Day, Holiday, Weekend"',
  ),
  meaning: z.enum(COLUMN_MEANINGS).describe(
    "date | hours (numeric hours) | tasks (description of work) | project | notes | leave (leave/status marker) | start_time | end_time | day_of_week | computed (formula/total, never write) | other",
  ),
});

export const SheetProfileSchema = z.object({
  name: z.string().describe("Exact sheet tab name"),
  role: z.enum(["entry", "summary", "reference", "empty", "other"]).describe("entry = where daily work is recorded"),
  layout: z.enum(LAYOUTS).describe(
    "row_per_day: one row per date | row_per_entry: several rows per date, one per task | grid: dates across columns | unknown",
  ),
  headerRow: z.number().int().nullable(),
  firstDataRow: z.number().int().nullable(),
  dateFormat: z.string().nullable().describe('Format of date cells, e.g. "DD/MM/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"'),
  columns: z.array(ColumnSchema),
  notes: z.string().nullable().describe("Anything unusual about this sheet"),
});

export const TimesheetProfileSchema = z.object({
  summary: z.string().describe("2-3 sentence plain-language description of how this timesheet looks"),
  recordsMode: z.enum(["hours_only", "task_based", "mixed"]).describe(
    "hours_only: just hours | task_based: descriptions of tasks | mixed: both",
  ),
  sheetSelection: z.enum(["single", "tab_per_month", "tab_per_week", "other"]).describe("How entries are spread over tabs"),
  sheets: z.array(SheetProfileSchema),
  leaveConvention: z.string().nullable().describe('How leave is recorded, e.g. "write Leave in the Status column"'),
  leaveMarkers: z.array(z.object({ text: z.string(), days: z.number() })).describe(
    "Exact cell texts that mean the person was on leave, with the days each is worth: 1 = full day, 0.5 = half day. Copy the texts exactly as they appear in the sheet. Do NOT include holidays, weekends, week-offs or present/working values.",
  ),
  warnings: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
});

/** Counted by code over the whole sheet (not by the model), so the chat agent can rely on it. */
export interface ColumnStat {
  col: number;
  filled: number;
  /** most common values of a categorical column */
  values?: { value: string; count: number }[];
  /** numeric columns */
  min?: number;
  max?: number;
}

export type SheetProfile = z.infer<typeof SheetProfileSchema> & { stats?: ColumnStat[]; dataRows?: number };
export type TimesheetProfile = Omit<z.infer<typeof TimesheetProfileSchema>, "sheets"> & { sheets: SheetProfile[]; version?: number };
/** Bump when the profile gains information the agent needs; older profiles are re-analysed on use. */
export const PROFILE_VERSION = 2;
export type ColumnMeaning = (typeof COLUMN_MEANINGS)[number];

export function colOf(sheet: SheetProfile, meaning: ColumnMeaning): number | null {
  return sheet.columns.find((c) => c.meaning === meaning)?.col ?? null;
}

// ---------------------------------------------------------------------------------------------
// Heuristic profiler: deterministic fallback, and a "draft" handed to the LLM to correct.
// ---------------------------------------------------------------------------------------------

const RULES: [ColumnMeaning, RegExp][] = [
  ["computed", /total|sum\b|overtime|balance|cumulative|amount|billable/i],
  ["start_time", /start|in[\s-]?time|^in$|check[\s-]?in|from/i],
  ["end_time", /end|out[\s-]?time|^out$|check[\s-]?out|^to$/i],
  ["date", /date|^dt$/i],
  ["day_of_week", /^(day|weekday|dow)$/i],
  ["hours", /hour|hrs|duration|time spent|worked|effort/i],
  ["tasks", /task|activit|description|work done|^work$|details|summary|deliverable/i],
  ["project", /project|client|ticket|jira|code|module/i],
  ["leave", /leave|status|attendance|absen|type/i],
  ["notes", /note|remark|comment/i],
];

function text(c: Cell): string {
  return c == null ? "" : String(c).trim();
}

export function guessDateFormat(samples: string[]): string {
  for (const s of samples) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "YYYY-MM-DD";
  }
  for (const s of samples) {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      const sep = s.match(/[/.-]/)![0];
      const yr = m[3].length === 4 ? "YYYY" : "YY";
      if (+m[1] > 12) return `DD${sep}MM${sep}${yr}`;
      if (+m[2] > 12) return `MM${sep}DD${sep}${yr}`;
    }
  }
  if (samples.some((s) => /[A-Za-z]{3}/.test(s))) return "DD-MMM-YYYY";
  return "DD/MM/YYYY";
}

export function heuristicProfile(sheets: { name: string; rows: Cell[][] }[]): TimesheetProfile {
  const warnings: string[] = [];
  const profiles: SheetProfile[] = sheets.map(({ name, rows }) => {
    const nonEmpty = rows.filter((r) => r.some((c) => text(c)));
    if (nonEmpty.length === 0) {
      return { name, role: "empty", layout: "unknown", headerRow: null, firstDataRow: null, dateFormat: null, columns: [], notes: "Sheet is empty", };
    }
    // header row: first row (of the first 15) with >= 2 text cells that match a known header word
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hits = rows[i].filter((c) => typeof c === "string" && RULES.some(([, re]) => re.test(c.trim()))).length;
      if (hits >= 2) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      return { name, role: "other", layout: "unknown", headerRow: null, firstDataRow: null, dateFormat: null, columns: [], notes: "Couldn't find a header row", };
    }
    const header = rows[headerIdx];
    const data = rows.slice(headerIdx + 1);
    const columns = header
      .map((h, i) => ({ h: text(h), i }))
      .filter((x) => x.h)
      .map(({ h, i }) => {
        const formulaSamples = data.slice(0, 8).filter((r) => typeof r[i] === "string" && String(r[i]).startsWith("=")).length;
        let meaning: ColumnMeaning = RULES.find(([, re]) => re.test(h))?.[0] ?? "other";
        if (formulaSamples >= 2) meaning = "computed";
        return { col: i + 1, header: h, meaning, description: `${h} (${meaning.replace("_", " ")})` };
      });

    const dateCol = columns.find((c) => c.meaning === "date");
    const dateValues = dateCol ? data.map((r) => text(r[dateCol.col - 1])).filter(Boolean) : [];
    const parsed = dateValues.map((d) => parseCellDate(d)).filter(Boolean) as string[];
    const hasEntryCols = columns.some((c) => c.meaning === "hours" || c.meaning === "tasks");
    let layout: SheetProfile["layout"] = "unknown";
    if (dateCol && hasEntryCols) {
      layout = new Set(parsed).size < parsed.length * 0.8 && parsed.length > 3 ? "row_per_entry" : "row_per_day";
    } else if (header.filter((h) => parseCellDate(h) !== null).length >= 3) {
      layout = "grid";
    }
    const isSummary = /summary|dashboard|report|total|pivot/i.test(name);
    return {
      name,
      role: layout === "row_per_day" || layout === "row_per_entry" ? (isSummary ? "summary" : "entry") : isSummary ? "summary" : "other",
      layout,
      headerRow: headerIdx + 1,
      firstDataRow: headerIdx + 2,
      dateFormat: dateValues.length ? guessDateFormat(dateValues) : null,
      columns,
      notes: null,
    } satisfies SheetProfile;
  });

  const entry = profiles.filter((p) => p.role === "entry");
  const meanings = new Set(entry.flatMap((p) => p.columns.map((c) => c.meaning)));
  const recordsMode: TimesheetProfile["recordsMode"] =
    meanings.has("tasks") && meanings.has("hours") ? "mixed" : meanings.has("tasks") ? "task_based" : "hours_only";
  const monthTabs = profiles.filter((p) => parseMonthFromTabName(p.name)).length;
  const sheetSelection: TimesheetProfile["sheetSelection"] = monthTabs >= 2 ? "tab_per_month" : "single";
  if (entry.length === 0) warnings.push("No sheet looks like a daily entry sheet. Ask the user where work is recorded.");
  return {
    summary: `Detected ${profiles.length} sheet(s); ${entry.length} look like daily entry sheets (${recordsMode.replace("_", " ")}).`,
    recordsMode,
    sheetSelection,
    sheets: profiles,
    leaveConvention: null,
    leaveMarkers: [],
    warnings,
    confidence: entry.length ? "medium" : "low",
    version: PROFILE_VERSION,
  };
}

/** Looks at every data row (not just the first 30) and summarises each column. */
export function columnStats(dataRows: Cell[][], columns: SheetProfile["columns"]): ColumnStat[] {
  return columns.map((c) => {
    const vals = dataRows.map((r) => r[c.col - 1]).filter((v) => v != null && v !== "");
    const stat: ColumnStat = { col: c.col, filled: vals.length };
    if (c.meaning === "date" || c.meaning === "computed" || !vals.length) return stat;
    const nums = vals.filter((v): v is number => typeof v === "number");
    if (nums.length === vals.length) {
      stat.min = Math.min(...nums);
      stat.max = Math.max(...nums);
      return stat;
    }
    const counts = new Map<string, number>();
    for (const v of vals) {
      const t = String(v).replace(/\s+/g, " ").trim().slice(0, 40);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // free text (tasks, notes) has many distinct values and is not worth listing
    if (counts.size <= 25 && (counts.size <= vals.length / 2 || counts.size <= 8)) {
      stat.values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    }
    return stat;
  });
}

/** Compact text form of a profile for prompts and for showing to users. */
export function describeProfile(p: TimesheetProfile): string {
  const lines = [`${p.summary} (confidence: ${p.confidence}; mode: ${p.recordsMode}; tabs: ${p.sheetSelection})`];
  for (const s of p.sheets) {
    lines.push(
      `- Sheet "${s.name}" [${s.role}, ${s.layout}] header row ${s.headerRow ?? "?"}, data from row ${s.firstDataRow ?? "?"}${s.dataRows != null ? ` (${s.dataRows} rows)` : ""}, dates ${s.dateFormat ?? "?"}${s.notes ? `; note: ${s.notes}` : ""}`,
    );
    for (const c of s.columns) {
      const st = s.stats?.find((x) => x.col === c.col);
      const vals = st?.values ? ` Values: ${st.values.slice(0, 10).map((v) => `${v.value}×${v.count}`).join(", ")}.` : st?.min != null ? ` Range ${st.min}–${st.max}.` : "";
      lines.push(`    col ${c.col} "${c.header}" = ${c.meaning}: ${c.description ?? ""}${vals}`);
    }
  }
  if (p.leaveConvention) lines.push(`Leave: ${p.leaveConvention}`);
  if (p.leaveMarkers?.length) lines.push(`Leave markers (cell text = days): ${p.leaveMarkers.map((m) => `"${m.text}" = ${m.days}`).join(", ")}`);
  for (const w of p.warnings) lines.push(`Warning: ${w}`);
  return lines.join("\n");
}
