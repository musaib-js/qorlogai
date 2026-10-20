"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  AlertCircle,
  ArrowUp,
  CalendarCheck,
  CalendarOff,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { clearChatAction } from "@/app/actions";
import { Markdown } from "@/components/chat/markdown";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  set_day_entry: { running: "Updating your timesheet", done: "Timesheet updated" },
  mark_leave: { running: "Marking leave", done: "Leave recorded" },
  export_timesheet: { running: "Preparing your file", done: "File ready" },
  read_entries: { running: "Reading your entries", done: "Entries read" },
  read_sheet: { running: "Reading the sheet", done: "Sheet read" },
  write_cells: { running: "Writing to the sheet", done: "Sheet updated" },
  get_timesheet_info: { running: "Checking the timesheet layout", done: "Layout checked" },
  list_timesheets: { running: "Looking at your timesheets", done: "Timesheets listed" },
  reanalyse_timesheet: { running: "Re-analysing the timesheet", done: "Timesheet re-analysed" },
  update_settings: { running: "Saving settings", done: "Settings saved" },
  begin_add_timesheet: { running: "Getting ready", done: "Ready" },
};

const SUGGESTIONS = [
  { icon: CalendarCheck, label: "Log today's work", text: "Here's what I worked on today: " },
  { icon: CalendarOff, label: "Half day leave today", text: "Put me on a half day leave today" },
  { icon: FileSpreadsheet, label: "Show this week", text: "What have I logged this week?" },
  { icon: FileText, label: "Export this month as PDF", text: "Send me this month's timesheet as a PDF" },
];

type ToolPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` }> & {
  state: string;
  output?: unknown;
  errorText?: string;
};

function ToolChip({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const label = TOOL_LABELS[name] ?? { running: "Working", done: "Done" };
  const output = part.output as { ok?: boolean; error?: string; fileId?: string; filename?: string } | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || output?.ok === false;

  if (!running && !failed && name === "export_timesheet" && output?.fileId) {
    return (
      <a
        href={`/api/exports/${output.fileId}`}
        className="my-1 flex w-fit max-w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-xs transition-colors hover:bg-accent"
      >
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          {output.filename?.endsWith(".pdf") ? <FileText className="size-4" /> : <FileSpreadsheet className="size-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{output.filename}</span>
          <span className="text-xs text-muted-foreground">Click to download</span>
        </span>
        <Download className="ml-2 size-4 text-muted-foreground" />
      </a>
    );
  }

  return (
    <div
      className={cn(
        "my-1 flex w-fit max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs",
        failed ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-muted/60 text-muted-foreground",
      )}
    >
      {running ? <Loader2 className="size-3 animate-spin" /> : failed ? <AlertCircle className="size-3" /> : <Check className="size-3 text-emerald-600 dark:text-emerald-400" />}
      <span className="truncate">{running ? `${label.running}…` : failed ? (output?.error ?? part.errorText ?? "That didn't work") : label.done}</span>
    </div>
  );
}

function Message({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-xs">{text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        {message.parts.map((part, i) => {
          if (part.type === "text") return part.text ? <Markdown key={i}>{part.text}</Markdown> : null;
          if (isToolUIPart(part)) return <ToolChip key={i} part={part as unknown as ToolPart} />;
          return null;
        })}
      </div>
    </div>
  );
}

export function Chat({ initialMessages, firstName, hasTimesheets }: { initialMessages: UIMessage[]; firstName: string; hasTimesheets: boolean }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // The server keeps the history; only the newest message travels.
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages[messages.length - 1] } }),
      }),
    [],
  );
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({ messages: initialMessages, transport });
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages, status]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    stick.current = true;
    sendMessage({ text: t });
    setInput("");
  };

  const last = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && last?.role === "assistant" && last.parts.length === 0);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.length === 0 ? (
            <div className="my-auto flex flex-col items-center py-10 text-center">
              <LogoMark className="size-12 rounded-2xl" />
              <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
                Hi {firstName}, <span className="text-gradient">what did you work on?</span>
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Tell me in your own words. I&apos;ll fill in your timesheet, handle leave, fix past days, or export it for you.
              </p>
              {!hasTimesheets && (
                <Link href="/timesheets/new" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15">
                  <Sparkles className="size-4" /> Add your first timesheet
                </Link>
              )}
              <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map(({ icon: Icon, label, text }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => (text.endsWith(": ") ? (setInput(text), area.current?.focus()) : send(text))}
                    className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
                  >
                    <Icon className="size-4 text-primary" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <Message key={m.id} message={m} />)
          )}

          {waiting && (
            <div className="flex items-center gap-3">
              <LogoMark className="size-7 rounded-lg" />
              <div className="flex gap-1" aria-label="Qorlog is thinking">
                <span className="qor-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="qor-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="qor-dot size-1.5 rounded-full bg-muted-foreground" />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span className="flex-1">{error.message?.includes("429") ? "You're sending messages too fast. Wait a moment." : "Something went wrong."}</span>
              <Button size="sm" variant="outline" onClick={() => regenerate()}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-2">
        <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow focus-within:border-ring focus-within:shadow-md focus-within:ring-[3px] focus-within:ring-ring/20">
            <textarea
              ref={area}
              value={input}
              rows={1}
              placeholder="Tell Qorlog what you worked on…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            {busy ? (
              <Button type="button" size="icon" variant="secondary" onClick={() => stop()} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" variant="brand" disabled={!input.trim()} aria-label="Send">
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </form>
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>Qorlog can make mistakes. Check important entries.</span>
          {messages.length > 0 && (
            <form action={clearChatAction}>
              <button type="submit" className="inline-flex items-center gap-1 hover:text-foreground">
                <Trash2 className="size-3" /> Clear chat
              </button>
            </form>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
