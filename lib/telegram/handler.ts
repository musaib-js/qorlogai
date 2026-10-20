import { appUrl } from "@/lib/app-url";
import { friendlySummary } from "@/lib/agent/summary";
import { resolveTimezoneSmart } from "@/lib/agent/timezone";
import { analyseAndSave } from "@/lib/agent/profiling";
import { runTurn } from "@/lib/agent/run";
import {
  clearState,
  consumeCode,
  createCode,
  findLinkedUser,
  getState,
  linkChannel,
  setState,
} from "@/lib/data/channels";
import { countRecentUserMessages, getExport } from "@/lib/data/messages";
import { createTimesheet, getTimesheet, listTimesheets } from "@/lib/data/timesheets";
import { createUser, touchUser } from "@/lib/data/users";
import type { User } from "@/lib/db/schema";
import { parseSpreadsheetId, probeSpreadsheet, serviceAccountEmail } from "@/lib/sheets/google";
import { SheetError } from "@/lib/sheets/types";
import { XlsxAdapter } from "@/lib/sheets/xlsx-adapter";
import { downloadFile, sendDocument, sendMessage, sendTyping, type TgDocument, type TgMessage, type TgUpdate } from "./api";

const CH = "telegram" as const;
const MAX_FILE = 8 * 1024 * 1024;

const HELP = `I'm Qorlog, your timesheet assistant. Just talk to me:

- "worked 7 hours today: fixed login bug, reviewed PRs" logs your day
- "half day leave today" marks leave
- "change last Friday to 6 hours" fixes a past date
- "send my October timesheet as PDF" gives you a file

Commands: /addtimesheet, /timesheets, /web, /cancel`;

export async function handleUpdate(update: TgUpdate) {
  const msg = update.message;
  if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) return;
  const chatId = String(msg.chat.id);
  try {
    const user = await findLinkedUser(CH, chatId);
    if (!user) return await onUnregistered(msg, chatId);
    if (user.status !== "active") return await sendMessage(chatId, "This account is suspended. Please contact your administrator.");
    void touchUser(user.id);
    await onRegistered(msg, chatId, user);
  } catch (e) {
    console.error("telegram handler error", e);
    await sendMessage(chatId, "Sorry, something went wrong. Please try again in a moment.").catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

async function onUnregistered(msg: TgMessage, chatId: string) {
  const text = (msg.text ?? "").trim();

  // Deep link from the web app: /start link_<code>
  const linkMatch = text.match(/^\/start\s+link_([A-Za-z0-9_-]{10,})$/);
  if (linkMatch) {
    const userId = await consumeCode(linkMatch[1], "telegram_link");
    if (!userId) return sendMessage(chatId, "That link has expired or was already used. Open Settings in the web app and generate a new one.");
    await linkChannel(userId, CH, chatId);
    const user = await findLinkedUser(CH, chatId);
    await clearState(CH, chatId);
    return sendMessage(chatId, `You're linked, ${user?.name ?? "friend"}! 🎉\n\n${HELP}`);
  }

  const st = await getState(CH, chatId);

  if (text.startsWith("/cancel")) {
    await clearState(CH, chatId);
    return sendMessage(chatId, "No problem. Send /start whenever you want to begin.");
  }

  if (!st || text.startsWith("/start")) {
    await setState(CH, chatId, "reg_name", {});
    return sendMessage(
      chatId,
      "Hi! I'm Qorlog AI 👋 I keep your timesheets filled in, so you don't have to think about them.\n\nLet's get you set up. What should I call you?\n\n(Already have an account on the web? Open Settings there and press \"Connect Telegram\" instead.)",
    );
  }

  if (st.state === "reg_name") {
    const name = text.replace(/\s+/g, " ").slice(0, 60);
    if (!name || name.startsWith("/")) return sendMessage(chatId, "Please type the name you'd like me to use.");
    await setState(CH, chatId, "reg_tz", { name });
    return sendMessage(
      chatId,
      `Nice to meet you, ${name}! Which timezone are you in? I use it to remind you at the right time in the evening.\n\nYou can type a city (Mumbai, London, New York), an abbreviation (IST, PST) or a name like Asia/Kolkata.`,
    );
  }

  if (st.state === "reg_tz") {
    await sendTyping(chatId);
    const tz = await resolveTimezoneSmart(text);
    if (!tz) {
      return sendMessage(chatId, "I couldn't work out that timezone. Try the closest big city, e.g. \"Kolkata\" or \"Berlin\", or a name like Europe/Paris.");
    }
    const name = String(st.data.name ?? msg.from?.first_name ?? "there");
    const user = await createUser({ name, timezone: tz });
    await linkChannel(user.id, CH, chatId);
    await setState(CH, chatId, "ts_name", {});
    return sendMessage(
      chatId,
      `All set, ${name}! Timezone: ${tz}. I'll check in with you every evening around 6 PM.\n\nLet's register your first timesheet. What would you like to call it? (for example "Acme Corp")\n\nType /cancel to do this later.`,
    );
  }

  await clearState(CH, chatId);
  return sendMessage(chatId, "Send /start to get set up.");
}

// ---------------------------------------------------------------------------------------------
// Registered users
// ---------------------------------------------------------------------------------------------

async function onRegistered(msg: TgMessage, chatId: string, user: User) {
  const text = (msg.text ?? msg.caption ?? "").trim();
  const st = await getState(CH, chatId);

  // Commands always win over onboarding state
  if (text.startsWith("/")) {
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    switch (cmd) {
      case "/start":
        return sendMessage(chatId, `Welcome back, ${user.name}! ${HELP}`);
      case "/help":
        return sendMessage(chatId, HELP);
      case "/cancel":
        await clearState(CH, chatId);
        return sendMessage(chatId, "Okay, cancelled.");
      case "/addtimesheet":
        await setState(CH, chatId, "ts_name", {});
        return sendMessage(chatId, "What would you like to call the new timesheet? (for example \"Acme Corp\")");
      case "/timesheets": {
        const list = await listTimesheets(user.id);
        if (!list.length) return sendMessage(chatId, "You don't have any timesheets yet. Send /addtimesheet to register one.");
        return sendMessage(chatId, `Your timesheets:\n${list.map((t) => `- ${t.name} (${t.kind === "gsheet" ? "Google Sheet" : "Excel"})`).join("\n")}`);
      }
      case "/web": {
        const code = await createCode(user.id, "web_login", 10);
        const base = appUrl();
        return sendMessage(chatId, `Here's your one-time sign-in link (valid for 10 minutes, works once):\n${base}/login/link?code=${code}\n\nDon't share it with anyone.`);
      }
      default:
        return sendMessage(chatId, "I don't know that command. Send /help to see what I can do.");
    }
  }

  // --- timesheet onboarding ---
  if (st?.state === "ts_name") {
    const name = text.replace(/\s+/g, " ").slice(0, 60);
    if (!name) return sendMessage(chatId, "Please type a name for the timesheet.");
    if (await getTimesheet(user.id, name)) return sendMessage(chatId, `You already have a timesheet called "${name}". Pick a different name.`);
    await setState(CH, chatId, "ts_source", { name });
    return sendMessage(
      chatId,
      `Great: "${name}". Now give me the timesheet itself. Either:\n\n1) Send the Excel file (.xlsx) here, or\n2) Paste a Google Sheets link.\n\nFor a Google Sheet I'll tell you exactly how to give me access.`,
    );
  }

  if (st?.state === "ts_source" || st?.state === "ts_share") {
    const name = String(st.data.name ?? "Timesheet");
    if (msg.document) return await onTimesheetFile(chatId, user, name, msg.document);
    const idFromText = parseSpreadsheetId(text);
    if (st.state === "ts_share" && !idFromText && /done|ready|shared|ok|yes/i.test(text)) {
      return onTimesheetLink(chatId, user, name, String(st.data.spreadsheetId), String(st.data.url));
    }
    if (idFromText) return onTimesheetLink(chatId, user, name, idFromText, text);
    return sendMessage(chatId, "Please send the .xlsx file or paste a Google Sheets link. (/cancel to stop)");
  }

  if (msg.document) {
    return sendMessage(chatId, "To register a timesheet file, send /addtimesheet first and I'll guide you.");
  }
  if (!text) return;

  // --- everyday conversation: hand over to the agent ---
  if ((await countRecentUserMessages(user.id, 60)) >= 12) {
    return sendMessage(chatId, "You're sending messages quite fast. Give me a minute to catch up.");
  }
  await sendTyping(chatId);
  const { text: reply, files } = await runTurn({ user, channel: "telegram", externalId: chatId, text });
  await sendMessage(chatId, reply);
  for (const f of files) {
    const file = await getExport(user.id, f.id);
    if (file) await sendDocument(chatId, file);
  }
}

async function onTimesheetFile(chatId: string, user: User, name: string, doc: TgDocument) {
  const fname = doc.file_name ?? "";
  if (!/\.xlsx$/i.test(fname)) {
    return sendMessage(chatId, "I can only read .xlsx files. If yours is .xls or .csv, open it in Excel, choose Save As > .xlsx, and send it again.");
  }
  if ((doc.file_size ?? 0) > MAX_FILE) return sendMessage(chatId, "That file is bigger than 8 MB. Please remove old sheets or images and try again.");
  await sendTyping(chatId);
  const bytes = await downloadFile(doc.file_id);
  try {
    await XlsxAdapter.load(bytes); // validates it really is a workbook
  } catch (e) {
    return sendMessage(chatId, e instanceof SheetError ? e.message : "I couldn't open that file.");
  }
  await sendMessage(chatId, "Got it! Reading through your timesheet now. This takes a few seconds ⏳");
  await finishOnboarding(chatId, user, () => createTimesheet(user.id, { name, kind: "xlsx", file: bytes }));
}

async function onTimesheetLink(chatId: string, user: User, name: string, spreadsheetId: string, url: string) {
  await sendTyping(chatId);
  const email = serviceAccountEmail();
  if (!email) return sendMessage(chatId, "Google Sheets isn't set up on this server yet. Please upload an .xlsx file instead, or tell your administrator.");
  try {
    await probeSpreadsheet(spreadsheetId);
  } catch (e) {
    if (e instanceof SheetError && e.code === "no_access") {
      await setState(CH, chatId, "ts_share", { name, spreadsheetId, url });
      return sendMessage(
        chatId,
        `I can't open that sheet yet. To let me fill it in, share it with my service account:\n\n1) Open the sheet and tap Share\n2) Add this address as an Editor:\n${email}\n3) Untick "Notify people" if you like, then Share\n4) Come back here and reply "done"\n\nI only ever see sheets that you explicitly share with that address.`,
      );
    }
    return sendMessage(chatId, e instanceof SheetError ? e.message : "I couldn't open that link.");
  }
  await sendMessage(chatId, "I can see the sheet! Reading through it now ⏳");
  await finishOnboarding(chatId, user, () => createTimesheet(user.id, { name, kind: "gsheet", spreadsheetId, url }));
}

async function finishOnboarding(chatId: string, user: User, create: () => ReturnType<typeof createTimesheet>) {
  try {
    const ts = await create();
    await clearState(CH, chatId);
    try {
      const profile = await analyseAndSave(user.id, ts);
      await sendMessage(chatId, friendlySummary(ts.name, profile));
    } catch (e) {
      console.error("profiling failed", e);
      await sendMessage(chatId, `I saved "${ts.name}" but couldn't analyse it just now. Say "re-analyse my timesheet" in a minute and I'll try again.`);
    }
  } catch (e) {
    await sendMessage(chatId, e instanceof SheetError ? e.message : "I couldn't save that timesheet.");
  }
}
