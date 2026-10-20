"use client";

import { Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TimesheetActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"analyse" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function analyse() {
    setBusy("analyse");
    const res = await fetch(`/api/timesheets/${id}/analyse`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      toast.success("Timesheet re-analysed");
      router.refresh();
    } else toast.error(data.error ?? "Analysis failed");
  }

  async function remove() {
    setBusy("delete");
    const res = await fetch(`/api/timesheets/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      toast.success("Timesheet removed from Qorlog");
      router.push("/timesheets");
      router.refresh();
    } else toast.error("Couldn't delete it");
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/api/timesheets/${id}/export?format=xlsx`}>
          <Download /> Excel
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/timesheets/${id}/export?format=pdf`}>
          <Download /> PDF (this month)
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={analyse} disabled={busy !== null}>
        {busy === "analyse" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-analyse
      </Button>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
        <Trash2 /> Remove
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove “{name}”?</DialogTitle>
            <DialogDescription>
              This removes the timesheet from Qorlog, including the stored copy of an uploaded file. A Google Sheet itself is not touched; you can also stop sharing it from Google.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy === "delete"}>
              {busy === "delete" && <Loader2 className="animate-spin" />} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
