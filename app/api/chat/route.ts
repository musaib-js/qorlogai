import { streamTurn } from "@/lib/agent/run";
import { countRecentUserMessages } from "@/lib/data/messages";
import { touchUser } from "@/lib/data/users";
import { sameOrigin } from "@/lib/http";
import { apiUser } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const user = await apiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as { message?: { parts?: { type: string; text?: string }[] } } | null;
  const text = (body?.message?.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text) return new Response("Empty message", { status: 400 });
  if (text.length > 4000) return new Response("Message too long", { status: 413 });
  if ((await countRecentUserMessages(user.id, 60)) >= 15) return new Response("Slow down a little", { status: 429 });

  void touchUser(user.id);
  return streamTurn({ user, channel: "web", text });
}
