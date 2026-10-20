"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteModelAction, saveModelAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface ModelRow {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  purposes: string[];
  defaultFor: string[];
  contextWindow: number | null;
  notes: string | null;
  enabled: boolean;
}

const PURPOSES = [
  { key: "chat", label: "Chat", hint: "Talks to users and calls tools" },
  { key: "analysis", label: "Analysis", hint: "Reads timesheet structure" },
  { key: "utility", label: "Utility", hint: "Small jobs like timezone parsing" },
];

export function ModelDialog({ model }: { model?: ModelRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      {model ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={`Edit ${model.displayName}`}>
          <Pencil />
        </Button>
      ) : (
        <Button variant="brand" onClick={() => setOpen(true)}>
          <Plus /> Add model
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <form
            action={(fd) =>
              start(async () => {
                await saveModelAction(fd);
                toast.success("Model saved");
                setOpen(false);
              })
            }
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{model ? "Edit model" : "Add a model"}</DialogTitle>
              <DialogDescription>Agents pick their model from this catalog. Changes apply within about 30 seconds.</DialogDescription>
            </DialogHeader>
            {model && <input type="hidden" name="id" value={model.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" name="displayName" defaultValue={model?.displayName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Input id="provider" name="provider" defaultValue={model?.provider ?? "groq"} required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="modelId">Model ID</Label>
                <Input id="modelId" name="modelId" defaultValue={model?.modelId} placeholder="llama-3.3-70b-versatile" className="font-mono text-sm" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contextWindow">Context window (tokens)</Label>
                <Input id="contextWindow" name="contextWindow" type="number" min={0} defaultValue={model?.contextWindow ?? ""} />
              </div>
              <label className="flex items-center justify-between gap-3 self-end rounded-lg border px-3 py-2.5 text-sm">
                Enabled
                <Switch name="enabled" defaultChecked={model?.enabled ?? true} />
              </label>
            </div>

            <div className="rounded-xl border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <span>Purpose</span>
                <span>Can serve</span>
                <span>Default</span>
              </div>
              {PURPOSES.map((p) => (
                <div key={p.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b px-4 py-2.5 text-sm last:border-0">
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.hint}</span>
                  </span>
                  <Switch name={`purpose_${p.key}`} defaultChecked={model ? model.purposes.includes(p.key) : p.key === "chat"} />
                  <Switch name={`default_${p.key}`} defaultChecked={model?.defaultFor.includes(p.key) ?? false} />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={model?.notes ?? ""} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={pending}>
                Save model
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteModelButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      aria-label={`Delete ${name}`}
      onClick={() => {
        if (!confirm(`Remove ${name} from the catalog?`)) return;
        start(async () => {
          await deleteModelAction(id);
          toast.success("Model removed");
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
