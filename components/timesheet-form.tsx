"use client";

import { Check, CheckCircle2, Copy, FileSpreadsheet, Link2, Loader2, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Kind = "xlsx" | "gsheet";

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function TimesheetForm({ serviceEmail }: { serviceEmail: string | null }) {
  const [kind, setKind] = useState<Kind>("xlsx");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [needShare, setNeedShare] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; summary: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Give your timesheet a name first.");
    const fd = new FormData();
    fd.set("name", name);
    fd.set("kind", kind);
    if (kind === "xlsx") {
      if (!file) return setError("Choose an .xlsx file.");
      fd.set("file", file);
    } else {
      if (!url.trim()) return setError("Paste the Google Sheet link.");
      fd.set("url", url);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/timesheets", { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 409 && data.code === "no_access") {
        setNeedShare(data.serviceAccountEmail);
        return;
      }
      if (!res.ok) return setError(data.error ?? "Something went wrong.");
      setNeedShare(null);
      setDone({ id: data.id, summary: data.summary });
      toast.success("Timesheet added");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Timesheet added</h2>
            <p className="text-sm text-muted-foreground">Here&apos;s what Qorlog understood about it.</p>
          </div>
        </div>
        <pre className="rounded-xl bg-muted/60 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{done.summary}</pre>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="brand">
            <Link href="/chat">
              <Sparkles /> Start chatting
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/timesheets/${done.id}`}>View details</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-2xl border bg-card p-6">
      <div className="space-y-2">
        <Label htmlFor="ts-name">Name</Label>
        <Input id="ts-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp" maxLength={60} />
        <p className="text-xs text-muted-foreground">You&apos;ll use this name to tell Qorlog which timesheet you mean.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        {([
          ["xlsx", Upload, "Upload Excel"],
          ["gsheet", Link2, "Google Sheet"],
        ] as const).map(([k, Icon, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setError(null);
            }}
            className={cn("flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all", kind === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {kind === "xlsx" ? (
        <div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <FileSpreadsheet className="size-8 text-primary" />
            {file ? (
              <span className="text-sm font-medium">{file.name}</span>
            ) : (
              <>
                <span className="text-sm font-medium">Drop your .xlsx here or click to browse</span>
                <span className="text-xs text-muted-foreground">Up to 4 MB. Stored encrypted, only you can open it.</span>
              </>
            )}
          </button>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ts-url">Google Sheet link</Label>
            <Input id="ts-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
          <div className={cn("space-y-3 rounded-xl border p-4 text-sm", needShare ? "border-amber-500/40 bg-amber-500/10" : "bg-muted/40")}>
            <p className="font-medium">{needShare ? "Almost there: Qorlog can't open that sheet yet." : "How access works"}</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Open your Google Sheet and click <b className="text-foreground">Share</b>.</li>
              <li>
                Add this address as an <b className="text-foreground">Editor</b>:
              </li>
            </ol>
            {serviceEmail || needShare ? <CopyField value={(needShare ?? serviceEmail)!} /> : <p className="text-destructive">Google Sheets isn&apos;t configured on this server. Upload an .xlsx instead.</p>}
            <ol start={3} className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Paste the sheet link above and press Add timesheet.</li>
            </ol>
            <p className="text-xs text-muted-foreground">Qorlog can only see sheets you share with that address. You never give us a password or key file, and you can remove access at any time from Share.</p>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Button type="button" variant="brand" size="lg" className="w-full" disabled={busy} onClick={submit}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> Reading your timesheet…
          </>
        ) : needShare ? (
          "I've shared it, try again"
        ) : (
          "Add timesheet"
        )}
      </Button>
    </div>
  );
}
