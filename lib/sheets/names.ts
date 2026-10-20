import { parseMonthFromTabName } from "@/lib/time";
import { SheetError } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Finds the real tab for whatever the user (or the model) called it. "November 26", "nov 2026",
 * "Nov-26" and "11/2026" all reach a tab named "Nov-26". Returns null when nothing matches clearly.
 */
export function matchSheetName(names: string[], query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  const exact = names.find((n) => n === q) ?? names.find((n) => n.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const flat = names.filter((n) => squash(n) === squash(q));
  if (flat.length === 1) return flat[0];

  const month = parseMonthFromTabName(q);
  if (month) {
    const same = names.filter((n) => parseMonthFromTabName(n) === month);
    if (same.length >= 1) return same[0];
  }
  // a bare month name ("November") is fine when only one tab is for that month
  const bare = q.match(/^([A-Za-z]{3,9})\.?$/);
  if (bare) {
    const probe = parseMonthFromTabName(`${bare[1]} 2000`);
    if (probe) {
      const hits = names.filter((n) => parseMonthFromTabName(n)?.slice(5) === probe.slice(5));
      if (hits.length === 1) return hits[0];
    }
  }
  const partial = names.filter((n) => squash(n).includes(squash(q)) || squash(q).includes(squash(n)));
  return partial.length === 1 && squash(q).length >= 3 ? partial[0] : null;
}

export function resolveSheetName(names: string[], query: string): string {
  const hit = matchSheetName(names, query);
  if (!hit) {
    throw new SheetError(`There is no sheet matching "${query}". The sheets in this file are: ${names.map((n) => `"${n}"`).join(", ")}.`, "not_found");
  }
  return hit;
}
