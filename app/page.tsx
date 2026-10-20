import { CalendarClock, FileSpreadsheet, Lock, MessageCircle, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo, LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";

const FEATURES = [
  { icon: Send, title: "Lives where you chat", body: "Message Qorlog on Telegram (WhatsApp next) or use the web chat. Same assistant, same memory." },
  { icon: FileSpreadsheet, title: "Works with your sheet", body: "Bring your own Excel file or Google Sheet. Qorlog learns its layout and writes entries the way you do." },
  { icon: CalendarClock, title: "A 6 PM nudge, in your timezone", body: "Every evening it asks what you worked on, and fills in your timesheet from your reply." },
  { icon: MessageCircle, title: "Say it however you like", body: "“Half day leave today”, “change Friday to 6 hours”, “send October as PDF”. No forms, no formulas." },
  { icon: Lock, title: "Private by design", body: "Your timesheets are encrypted with a key that belongs to you. Other users can't open them, and neither can admins." },
  { icon: ShieldCheck, title: "Admins manage, never peek", body: "Admins see accounts and the model catalog, not anyone's timesheets or conversations." },
];

export default async function Home() {
  if ((await auth())?.user) redirect("/chat");
  return (
    <div className="aurora min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="brand">
            <Link href="/register">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-12 pb-20 lg:grid-cols-2 lg:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Now with Telegram
          </span>
          <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            Timesheets that <span className="text-gradient">fill themselves.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            Tell Qorlog what you did today. It updates your Excel file or Google Sheet, handles leave, fixes past days and exports on demand.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="brand">
              <Link href="/register">Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">I already have one</Link>
            </Button>
          </div>
        </div>

        {/* static preview of the conversation */}
        <div className="mx-auto w-full max-w-md rounded-3xl border bg-card/90 p-4 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <LogoMark className="size-7 rounded-lg" />
            <div className="text-sm font-medium">Qorlog AI</div>
            <span className="ml-auto text-xs text-muted-foreground">6:00 PM</span>
          </div>
          <div className="space-y-3 text-sm">
            <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">Hey Musaib! 👋 What did you work on today?</p>
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground">
              7 hours. Fixed the invoice matching bug and reviewed two PRs
            </p>
            <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
              Done ✅ Logged 7h for today in “Acme Corp”: invoice matching fix, PR reviews.
            </p>
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground">Send me October as a PDF</p>
            <div className="flex w-fit items-center gap-3 rounded-xl border bg-background px-3 py-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <FileSpreadsheet className="size-4" />
              </span>
              <div>
                <div className="text-sm font-medium">acme-corp_2026-10.pdf</div>
                <div className="text-xs text-muted-foreground">Ready to download</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border bg-card/80 p-5 backdrop-blur transition-shadow hover:shadow-md">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
