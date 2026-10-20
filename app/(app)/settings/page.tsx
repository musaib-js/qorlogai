import { KeyRound, ShieldCheck } from "lucide-react";

import { DeleteAccount, ProfileForm, TelegramCard } from "@/components/settings-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLink } from "@/lib/data/channels";
import { requireUser } from "@/lib/session";
import { listTimezones } from "@/lib/time";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const telegram = await getLink(user.id, "telegram");
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">{user.email ?? "Signed up through Telegram"}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile & reminders</CardTitle>
          <CardDescription>Your timezone decides when your evening check-in arrives.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            zones={listTimezones()}
            user={{ name: user.name, timezone: user.timezone, reminderMinutes: user.reminderMinutes, reminderEnabled: user.reminderEnabled, remindWeekends: user.remindWeekends }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>The same assistant, wherever you prefer to talk to it.</CardDescription>
        </CardHeader>
        <CardContent>
          <TelegramCard linked={!!telegram} botConfigured={!!process.env.TELEGRAM_BOT_USERNAME} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> How your data is protected
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <KeyRound className="mr-1.5 inline size-3.5" />
            Your timesheets, uploaded files and conversations are encrypted with a key unique to you. Other users can&apos;t read them, and administrators only ever see account details such as your name, email and timezone.
          </p>
          <p>
            To understand your messages, the AI model provider receives the part of your timesheet and conversation needed for each request. Google Sheets are reachable only if you shared them with Qorlog&apos;s service address.
          </p>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>Permanently remove your account and everything stored in Qorlog.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccount />
        </CardContent>
      </Card>
    </div>
  );
}
