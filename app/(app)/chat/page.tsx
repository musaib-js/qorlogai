import type { UIMessage } from "ai";

import { Chat } from "@/components/chat/chat";
import { recentMessages } from "@/lib/data/messages";
import { listTimesheets } from "@/lib/data/timesheets";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Chat" };

export default async function ChatPage() {
  const user = await requireUser();
  const [history, sheets] = await Promise.all([recentMessages(user.id, 30), listTimesheets(user.id)]);
  const initialMessages = history.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [
      ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
      ...m.files.map((f) => ({ type: "data-file" as const, data: f })),
    ],
  })) as UIMessage[];
  return (
    <div className="h-full">
      <Chat initialMessages={initialMessages} firstName={user.name.split(" ")[0]} hasTimesheets={sheets.length > 0} />
    </div>
  );
}
