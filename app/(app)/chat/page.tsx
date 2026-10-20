import type { UIMessage } from "ai";

import { Chat } from "@/components/chat/chat";
import { recentMessages } from "@/lib/data/messages";
import { listTimesheets } from "@/lib/data/timesheets";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Chat" };

export default async function ChatPage() {
  const user = await requireUser();
  const [history, sheets] = await Promise.all([recentMessages(user.id, 30), listTimesheets(user.id)]);
  const initialMessages: UIMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.text }],
  }));
  return (
    <div className="h-full">
      <Chat initialMessages={initialMessages} firstName={user.name.split(" ")[0]} hasTimesheets={sheets.length > 0} />
    </div>
  );
}
