import { chunkText } from "@/lib/agent/channel";

/** Minimal Telegram Bot API client (fetch only, no framework), safe for serverless. */

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

async function call<T>(method: string, body?: Record<string, unknown> | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: isForm || !body ? undefined : { "content-type": "application/json" },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string; error_code?: number };
  if (!json.ok) {
    const err = new Error(`Telegram ${method} failed: ${json.description ?? res.status}`) as Error & { code?: number };
    err.code = json.error_code;
    throw err;
  }
  return json.result;
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
export interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  document?: TgDocument;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/** Plain text only (no parse_mode): Telegram would otherwise try to interpret stray symbols. */
export async function sendMessage(chatId: string | number, text: string) {
  for (const part of chunkText(text)) {
    await call("sendMessage", { chat_id: chatId, text: part, link_preview_options: { is_disabled: true } });
  }
}

export async function sendTyping(chatId: string | number) {
  await call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}

export async function sendDocument(chatId: string | number, file: { filename: string; mime: string; bytes: Buffer }, caption?: string) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption);
  form.set("document", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
  await call("sendDocument", form);
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const info = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("Telegram returned no file path");
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${info.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function setWebhook(url: string, secret: string) {
  return call("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
}

export async function getWebhookInfo() {
  return call<{ url: string; last_error_message?: string }>("getWebhookInfo");
}

export async function setCommands() {
  return call("setMyCommands", {
    commands: [
      { command: "addtimesheet", description: "Register a new timesheet" },
      { command: "timesheets", description: "List your timesheets" },
      { command: "web", description: "Get a one-time link to the web app" },
      { command: "cancel", description: "Cancel what we're doing" },
      { command: "help", description: "What I can do" },
    ],
  });
}
