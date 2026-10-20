import { Send } from "lucide-react";

import { UserActions } from "@/components/admin/user-actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminListUsers } from "@/lib/data/admin";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Users" };

export default async function AdminUsers() {
  const admin = await requireAdmin();
  const list = await adminListUsers();
  const ago = (d: Date | null) => {
    if (!d) return "never";
    const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">{list.length} account{list.length === 1 ? "" : "s"}</p>
      </div>
      <Card className="py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead className="text-right">Timesheets</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {u.name}
                    {u.role === "admin" && <Badge variant="default">admin</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email ?? "Telegram only"}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "success" : "destructive"}>{u.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.timezone}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {u.telegram ? <><Send className="size-3.5 text-sky-500" /> Telegram</> : "Web"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{u.timesheetCount}</TableCell>
                <TableCell className="text-muted-foreground">{ago(u.lastActiveAt)}</TableCell>
                <TableCell>
                  <UserActions id={u.id} name={u.name} status={u.status} role={u.role} isSelf={u.id === admin.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
