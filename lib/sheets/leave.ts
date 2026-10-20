import type { Cell } from "./types";

/**
 * Deterministic leave classification. The chat model must never count leave by eye: it asks for a
 * summary, and the numbers come from here, driven by what the analysis learned about the sheet.
 */

export interface LeaveMarker {
  text: string;
  days: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const NOT_LEAVE = /\b(holiday|weekend|week[\s-]?off|present|working|wfh|work from home|comp[\s-]?off|public)\b|^(off|-|na|n\/a)$/;
const HALF = /\bhalf[\s-]?day\b|\bhalf\b|\b1\/2\b|\bhd\b|\b0?\.5\b/;
const LEAVE_WORD = /\b(leave|absent|sick|casual|vacation|pto|time off|annual|earned|privilege|lop|loss of pay)\b|^(l|pl|sl|cl|el|ol|a)$/;

/**
 * Days of leave a cell represents: 0, 0.5 or 1.
 * inLeaveColumn: the cell sits in a column the analysis marked as the leave/status column. Elsewhere
 * (task or notes text) only text that STARTS like a leave label counts, so "reviewed leave policy" does not.
 */
export function classifyLeave(cell: Cell | undefined, opts: { inLeaveColumn: boolean; markers?: LeaveMarker[] }): number {
  if (cell == null || cell === "") return 0;
  const t = norm(String(cell));
  if (!t) return 0;
  if (opts.markers?.length) {
    const hit = opts.markers.find((m) => norm(m.text) === t);
    if (hit) return hit.days;
    if (opts.inLeaveColumn) return 0; // the sheet's own vocabulary is known; anything else is not leave
  }
  if (NOT_LEAVE.test(t) && !LEAVE_WORD.test(t)) return 0;
  if (opts.inLeaveColumn) {
    if (HALF.test(t)) return 0.5;
    return LEAVE_WORD.test(t) ? 1 : 0;
  }
  if (/^(half[\s-]?day\s+)?(leave|off|pto)\b/.test(t)) return HALF.test(t) ? 0.5 : 1;
  return 0;
}

/** Marker list for a column's distinct values, used when the analysis model didn't supply one. */
export function deriveMarkers(values: { value: string }[]): LeaveMarker[] {
  const out: LeaveMarker[] = [];
  for (const { value } of values) {
    const days = classifyLeave(value, { inLeaveColumn: true });
    if (days > 0) out.push({ text: value, days });
  }
  return out;
}
