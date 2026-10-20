import { Activity, FileSpreadsheet, MessageSquare, Send, Users, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminModelUsage, adminRecentAudit, adminStats } from "@/lib/data/admin";

export const metadata = { title: "Admin overview" };

const fmt = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

export default async function AdminOverview() {
  const [s, usage, audit] = await Promise.all([adminStats(), adminModelUsage(), adminRecentAudit()]);
  const stats = [
    { label: "Users", value: s.users, icon: Users },
    { label: "Active (7 days)", value: s.activeUsers7d, icon: Activity },
    { label: "Telegram linked", value: s.telegramLinked, icon: Send },
    { label: "Timesheets", value: s.timesheets, icon: FileSpreadsheet },
    { label: "Messages (7 days)", value: s.messages7d, icon: MessageSquare },
    { label: "Tokens (30 days)", value: s.tokens30d.input + s.tokens30d.output, icon: Zap },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="gap-2 py-4">
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-3xl font-semibold tracking-tight">{fmt(value)}</p>
              </div>
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Model usage (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {usage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model calls yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((u) => (
                    <TableRow key={`${u.modelId}-${u.purpose}`}>
                      <TableCell className="font-mono text-xs">{u.modelId}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{u.purpose}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{u.calls}</TableCell>
                      <TableCell className="text-right">{fmt(u.input + u.output)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent admin actions</CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>
                      <span className="font-medium">{a.actor ?? "Admin"}</span> <span className="text-muted-foreground">{a.action}</span>
                      {a.target && <span> · {a.target}</span>}
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground">{a.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
