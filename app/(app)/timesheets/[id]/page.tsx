import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TimesheetActions } from "@/components/timesheet-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTimesheet, loadProfile } from "@/lib/data/timesheets";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Timesheet" };

export default async function TimesheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const ts = await getTimesheet(user.id, id); // scoped to the signed-in user: someone else's id is simply "not found"
  if (!ts) notFound();
  const profile = await loadProfile(user.id, ts).catch(() => null);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href="/timesheets" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All timesheets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ts.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ts.kind === "gsheet" ? "Google Sheet" : "Excel file"}, added {ts.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <TimesheetActions id={ts.id} name={ts.name} />
      </div>

      {!profile ? (
        <Card>
          <CardContent className="flex items-center gap-3 text-sm">
            <AlertTriangle className="size-5 text-amber-500" />
            {ts.profileStatus === "failed" ? "Qorlog couldn't analyse this timesheet. Press Re-analyse to try again." : "This timesheet hasn't been analysed yet. Press Re-analyse."}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>What Qorlog understood</CardTitle>
                <Badge variant={profile.confidence === "high" ? "success" : profile.confidence === "medium" ? "warning" : "destructive"}>{profile.confidence} confidence</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>{profile.summary}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Records {profile.recordsMode === "hours_only" ? "hours" : profile.recordsMode === "task_based" ? "tasks" : "hours + tasks"}</Badge>
                <Badge variant="secondary">{profile.sheetSelection.replace(/_/g, " ")}</Badge>
                {profile.leaveConvention && <Badge variant="secondary">Leave: {profile.leaveConvention}</Badge>}
              </div>
              {profile.warnings.length > 0 && (
                <ul className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  {profile.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sheets</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sheet</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Layout</TableHead>
                    <TableHead>Columns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.sheets.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant={s.role === "entry" ? "success" : "secondary"}>{s.role}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.layout.replace(/_/g, " ")}</TableCell>
                      <TableCell className="max-w-xs text-muted-foreground">
                        {s.columns.filter((c) => c.meaning !== "other").map((c) => `${c.header} → ${c.meaning.replace("_", " ")}`).join(", ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
