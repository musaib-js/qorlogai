import type { TimesheetProfile } from "@/lib/sheets/profile";

/** Plain-language summary of what the profiling agent learned. Plain text so it works on every channel. */
export function friendlySummary(name: string, p: TimesheetProfile): string {
  const entry = p.sheets.filter((s) => s.role === "entry");
  const lines: string[] = [`Here's what I found in "${name}":`, p.summary];
  lines.push(
    `- ${p.sheets.length} sheet${p.sheets.length === 1 ? "" : "s"}: ${p.sheets.map((s) => s.name).join(", ")}`,
    `- It records ${p.recordsMode === "hours_only" ? "hours only" : p.recordsMode === "task_based" ? "the tasks you did" : "hours and tasks"}`,
  );
  if (p.sheetSelection === "tab_per_month") lines.push("- A new tab per month");
  for (const s of entry.slice(0, 3)) {
    const cols = s.columns
      .filter((c) => c.meaning !== "other")
      .map((c) => `${c.header} (${c.meaning.replace("_", " ")})`)
      .slice(0, 6)
      .join(", ");
    lines.push(`- Entries go in "${s.name}" (${s.layout.replace(/_/g, " ")}): ${cols}`);
  }
  for (const w of p.warnings.slice(0, 2)) lines.push(`- Heads up: ${w}`);
  lines.push(
    p.confidence === "low" || entry.length === 0
      ? "I'm not very sure about this one. Tell me which sheet and columns to use and I'll adjust."
      : "If anything looks off, just tell me. Otherwise you're all set!",
  );
  return lines.join("\n");
}
