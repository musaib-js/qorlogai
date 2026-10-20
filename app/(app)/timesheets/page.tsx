import { CalendarDays, FileSpreadsheet, Plus, Table2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTimesheet, listTimesheets, loadProfile } from "@/lib/data/timesheets";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Timesheets" };

export default async function TimesheetsPage() {
  const user = await requireUser();
  const list = await listTimesheets(user.id);
  const summaries = await Promise.all(
    list.map(async (t) => {
      const ts = await getTimesheet(user.id, t.id);
      const p = ts ? await loadProfile(user.id, ts).catch(() => null) : null;
      return p ? `${p.recordsMode.replace("_", " ")} · ${p.sheets.length} sheet${p.sheets.length === 1 ? "" : "s"}` : null;
    }),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
          <p className="text-sm text-muted-foreground">Only you can see these. They&apos;re encrypted with your personal key.</p>
        </div>
        <Button asChild variant="brand">
          <Link href="/timesheets/new">
            <Plus /> Add timesheet
          </Link>
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Table2 className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold">No timesheets yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Add an Excel file or a Google Sheet and Qorlog will learn how to fill it in.</p>
          <Button asChild variant="brand" className="mt-5">
            <Link href="/timesheets/new">Add your first timesheet</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((t, i) => (
            <Link key={t.id} href={`/timesheets/${t.id}`} className="group rounded-2xl border bg-card p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <FileSpreadsheet className="size-5" />
                </span>
                <Badge variant={t.profileStatus === "ready" ? "success" : t.profileStatus === "failed" ? "destructive" : "warning"}>
                  {t.profileStatus === "ready" ? "Ready" : t.profileStatus === "failed" ? "Needs attention" : "Analysing"}
                </Badge>
              </div>
              <h3 className="mt-4 truncate font-semibold group-hover:text-primary">{t.name}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.kind === "gsheet" ? "Google Sheet" : "Excel file"}{summaries[i] ? ` · ${summaries[i]}` : ""}</p>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" /> Added {t.createdAt.toLocaleDateString("en-GB", { timeZone: user.timezone, day: "numeric", month: "short", year: "numeric" })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
