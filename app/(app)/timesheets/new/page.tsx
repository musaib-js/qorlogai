import { Send } from "lucide-react";

import { TimesheetForm } from "@/components/timesheet-form";
import { requireUser } from "@/lib/session";
import { serviceAccountEmail } from "@/lib/sheets/google";

export const metadata = { title: "Add timesheet" };

export default async function NewTimesheetPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await requireUser();
  const { welcome } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {welcome && (
        <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm">
          <p className="font-semibold">Welcome to Qorlog AI 🎉</p>
          <p className="mt-1 text-muted-foreground">Your account is ready. Add your first timesheet below. You can also connect Telegram from Settings to chat with Qorlog on your phone.</p>
        </div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">Add a timesheet</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Upload an Excel file or connect a Google Sheet. Qorlog reads how it&apos;s laid out so it can fill it in later.
      </p>
      <TimesheetForm serviceEmail={serviceAccountEmail()} />
      <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
        <Send className="size-3.5" /> Prefer Telegram? Send /addtimesheet to the bot and it will walk you through the same steps.
      </p>
    </div>
  );
}
