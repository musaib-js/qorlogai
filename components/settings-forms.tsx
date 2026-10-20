"use client";

import { CheckCircle2, ExternalLink, Loader2, Send, Unplug } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import { createTelegramLinkAction, deleteAccountAction, unlinkTelegramAction, updateProfileAction, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { TimezoneInput } from "@/components/timezone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const initial: FormState = {};

export function ProfileForm({
  zones,
  user,
}: {
  zones: string[];
  user: { name: string; timezone: string; reminderMinutes: number; reminderEnabled: boolean; remindWeekends: boolean };
}) {
  const [state, action] = useActionState(updateProfileAction, initial);
  const hh = String(Math.floor(user.reminderMinutes / 60)).padStart(2, "0");
  const mm = String(user.reminderMinutes % 60).padStart(2, "0");
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={user.name} required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <TimezoneInput zones={zones} defaultValue={user.timezone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reminderTime">Daily reminder time</Label>
          <Input id="reminderTime" name="reminderTime" type="time" defaultValue={`${hh}:${mm}`} required />
          <p className="text-xs text-muted-foreground">In your local time, sent on Telegram.</p>
        </div>
      </div>
      <div className="space-y-3 rounded-xl border p-4">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="font-medium">Daily reminder</span>
            <span className="block text-muted-foreground">Ask me what I worked on each evening</span>
          </span>
          <Switch name="reminderEnabled" defaultChecked={user.reminderEnabled} />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="font-medium">Include weekends</span>
            <span className="block text-muted-foreground">Otherwise reminders only come Monday to Friday</span>
          </span>
          <Switch name="remindWeekends" defaultChecked={user.remindWeekends} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="brand">Save changes</SubmitButton>
        {state.ok && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {state.ok}
          </span>
        )}
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}

export function TelegramCard({ linked, botConfigured }: { linked: boolean; botConfigured: boolean }) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  if (linked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <Send className="size-5" />
          </span>
          <div>
            <p className="flex items-center gap-2 font-medium">
              Telegram <Badge variant="success">Connected</Badge>
            </p>
            <p className="text-sm text-muted-foreground">Chat with Qorlog and get your evening reminder there.</p>
          </div>
        </div>
        <form action={unlinkTelegramAction}>
          <SubmitButton variant="outline" size="sm">
            <Unplug /> Disconnect
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <Send className="size-5" />
        </span>
        <div>
          <p className="font-medium">Telegram</p>
          <p className="text-sm text-muted-foreground">Connect once, then log your day by simply messaging the bot.</p>
        </div>
      </div>
      {!botConfigured ? (
        <p className="text-sm text-muted-foreground">The Telegram bot isn&apos;t configured on this server yet.</p>
      ) : url ? (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
          <p>Open the link and press <b>Start</b> in Telegram. It expires in 15 minutes.</p>
          <Button asChild variant="brand" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open Telegram
            </a>
          </Button>
        </div>
      ) : (
        <Button
          variant="brand"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await createTelegramLinkAction();
              if (res.url) setUrl(res.url);
              else toast.error(res.error ?? "Couldn't create the link");
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />} Connect Telegram
        </Button>
      )}
    </div>
  );
}

export function DeleteAccount() {
  const [state, action] = useActionState(deleteAccountAction, initial);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete my account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, timesheet copies, chat history and Telegram connection. Google Sheets are not touched. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm">Type DELETE to confirm</Label>
            <Input id="confirm" name="confirm" autoComplete="off" />
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          </div>
          <DialogFooter>
            <SubmitButton variant="destructive">Delete everything</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
