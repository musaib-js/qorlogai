import { Eye, EyeOff } from "lucide-react";

import { requireAdmin } from "@/lib/session";

/** Every page under /admin passes through this guard. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex items-start gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-medium text-foreground">Privacy boundary.</span> This panel shows accounts and aggregate counts only. Timesheets, files and conversations are encrypted per user and are not accessible here.
          <Eye className="sr-only" />
        </p>
      </div>
      {children}
    </div>
  );
}
