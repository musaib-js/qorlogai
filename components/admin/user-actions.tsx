"use client";

import { Ban, CheckCircle2, Loader2, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteUserAction, setUserRoleAction, setUserStatusAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function UserActions({ id, name, status, role, isSelf }: { id: string; name: string; status: "active" | "suspended"; role: "user" | "admin"; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (isSelf) return <span className="text-xs text-muted-foreground">You</span>;

  const run = (fn: () => Promise<void>, ok: string) =>
    start(async () => {
      await fn();
      toast.success(ok);
    });

  return (
    <div className="flex items-center justify-end gap-1">
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => setUserStatusAction(id, status === "active" ? "suspended" : "active"), status === "active" ? `${name} suspended` : `${name} reactivated`)}
      >
        {status === "active" ? <Ban /> : <CheckCircle2 />} {status === "active" ? "Suspend" : "Activate"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => setUserRoleAction(id, role === "admin" ? "user" : "admin"), role === "admin" ? `${name} is no longer an admin` : `${name} is now an admin`)}
      >
        {role === "admin" ? <ShieldOff /> : <ShieldCheck />} {role === "admin" ? "Revoke admin" : "Make admin"}
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setConfirm(true)} aria-label={`Delete ${name}`}>
        <Trash2 />
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              Permanently removes this account and all of its encrypted data. You will never see that data; it simply stops existing. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                run(() => deleteUserAction(id), `${name} deleted`);
              }}
            >
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
