/**
 * End-to-end tests against an in-process Postgres (PGlite) with a scripted mock LLM and a stubbed
 * Telegram API. They exercise the real queries, encryption, tools, Telegram state machine, reminders
 * and the admin data layer: everything except the network.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, test } from "node:test";

process.env.QORLOG_MASTER_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.APP_URL = "https://qorlog.test";
process.env.ADMIN_EMAILS = "admin@example.com";

import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import ExcelJS from "exceljs";
import { MockLanguageModelV4 } from "ai/test";

import { __setModelOverride } from "../lib/agent/models";
import { analyseAndSave } from "../lib/agent/profiling";
import { runTurn } from "../lib/agent/run";
import { consumeCode, createCode, findLinkedUser, getState, linkChannel } from "../lib/data/channels";
import { adminListUsers, adminStats } from "../lib/data/admin";
import { getExport, recentMessages } from "../lib/data/messages";
import { createTimesheet, getTimesheet, loadAdapter, loadProfile } from "../lib/data/timesheets";
import { createUser } from "../lib/data/users";
import * as schema from "../lib/db/schema";
import { __useDbForTests, db } from "../lib/db";
import { readEntries } from "../lib/sheets/ops";
import { handleUpdate } from "../lib/telegram/handler";
import { runReminders } from "../lib/telegram/reminders";
import { localParts } from "../lib/time";
import { openBytes } from "../lib/vault";

// ---- test doubles -----------------------------------------------------------------------------

const sent: { chat_id: number | string; text: string }[] = [];
const docs: { chat: string; name: string }[] = [];
let uploadBytes: Buffer = Buffer.alloc(0);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.telegram.org")) {
    const ok = Response.json({ ok: true, result: {} });
    if (url.endsWith("/sendMessage")) {
      sent.push(JSON.parse(String(init?.body)));
      return ok;
    }
    if (url.endsWith("/sendDocument")) {
      const f = init?.body as FormData;
      docs.push({ chat: String(f.get("chat_id")), name: (f.get("document") as File).name });
      return ok;
    }
    if (url.endsWith("/getFile")) return Response.json({ ok: true, result: { file_path: "docs/file.xlsx" } });
    if (url.includes("/file/bot")) return new Response(new Uint8Array(uploadBytes));
    return ok;
  }
  return new Response('{"error":"network disabled in tests"}', { status: 500 });
}) as typeof fetch;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function scripted(steps: { tools?: { name: string; input: object }[]; text?: string }[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const s = steps[Math.min(i, steps.length - 1)];
      i++;
      const content: object[] = [
        ...(s.tools ?? []).map((t, k) => ({ type: "tool-call", toolCallId: `call-${i}-${k}`, toolName: t.name, input: JSON.stringify(t.input) })),
        ...(s.text ? [{ type: "text", text: s.text }] : []),
      ];
      return { content, finishReason: { unified: s.tools ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] } as never;
    },
  });
}

const useChatModel = (steps: Parameters<typeof scripted>[0]) => __setModelOverride(() => ({ model: scripted(steps) as never, modelId: "mock-chat" }));

async function workbookBytes(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Timesheet");
  ws.addRow(["Date", "Hours", "Tasks"]);
  ws.addRow([new Date("2026-10-01T00:00:00Z"), 8, "Kickoff"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const PROFILE_JSON = {
  summary: "A simple daily log with hours and tasks.",
  recordsMode: "mixed",
  sheetSelection: "single",
  sheets: [
    {
      name: "Timesheet", role: "entry", layout: "row_per_day", headerRow: 1, firstDataRow: 2, dateFormat: "DD/MM/YYYY",
      columns: [
        { col: 1, header: "Date", meaning: "date" },
        { col: 2, header: "Hours", meaning: "hours" },
        { col: 3, header: "Tasks", meaning: "tasks" },
      ],
      notes: null,
    },
  ],
  leaveConvention: null,
  warnings: [],
  confidence: "high",
};

const exec = (tool: unknown, input: object) =>
  (tool as { execute: (i: object, o: object) => Promise<Record<string, unknown>> }).execute(input, { toolCallId: "t", messages: [] });

// ---- setup ------------------------------------------------------------------------------------

let alice: schema.User;
let bob: schema.User;
let aliceTs: schema.Timesheet;
const today = localParts("Asia/Kolkata").date;

before(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  const { apply } = await pushSchema(schema, pg as never);
  await apply();
  __useDbForTests(pg);
  uploadBytes = await workbookBytes();

  alice = await createUser({ name: "Alice Admin", email: "Admin@Example.com", passwordHash: "x", timezone: "Asia/Kolkata" });
  bob = await createUser({ name: "Bob", email: "bob@example.com", passwordHash: "x", timezone: "Europe/London" });
});

// ---- tests ------------------------------------------------------------------------------------

test("registration: admin by env, emails are case-insensitive unique", async () => {
  assert.equal(alice.role, "admin");
  assert.equal(bob.role, "user");
  await assert.rejects(() => createUser({ name: "Dup", email: "ADMIN@example.com", timezone: "UTC" }));
});

test("timesheet profiling: model output is validated, garbage falls back to heuristics", async () => {
  aliceTs = await createTimesheet(alice.id, { name: "Acme Corp", kind: "xlsx", file: uploadBytes });

  // 1) model returns a valid profile
  __setModelOverride(() => ({
    model: new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(PROFILE_JSON) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as never }) as never,
    modelId: "mock-analysis",
  }));
  let profile = await analyseAndSave(alice.id, aliceTs);
  assert.equal(profile.confidence, "high");
  assert.equal(profile.recordsMode, "mixed");

  // 2) model returns garbage -> rule-based fallback with a warning
  __setModelOverride(() => ({
    model: new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: "sorry, no" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as never }) as never,
    modelId: "mock-analysis",
  }));
  profile = await analyseAndSave(alice.id, aliceTs);
  assert.equal(profile.sheets[0].layout, "row_per_day");
  assert.ok(profile.warnings.some((w) => /rule-based/.test(w)));
  const stored = await getTimesheet(alice.id, "acme corp");
  assert.equal(stored?.profileStatus, "ready");
  aliceTs = stored!; // refresh: now carries the encrypted profile
});

test("isolation: another user cannot read, address or decrypt Alice's timesheet", async () => {
  assert.equal(await getTimesheet(bob.id, aliceTs.id), null);
  assert.equal(await getTimesheet(bob.id, "Acme Corp"), null);
  await assert.rejects(() => loadAdapter(bob.id, aliceTs), /Forbidden/);
  await assert.rejects(() => openBytes(bob.id, aliceTs.fileEnc!)); // wrong key + wrong AAD
  assert.equal(await loadProfile(bob.id, aliceTs), null);
  // ciphertext at rest is not the workbook
  const [raw] = await db().select().from(schema.timesheets).where(eq(schema.timesheets.id, aliceTs.id));
  assert.ok(raw.fileEnc!.startsWith("v1."));
  assert.ok(!raw.fileEnc!.includes("Kickoff"));
});

test("agent turn (telegram): tool call writes the sheet, reply is plain text, history is encrypted", async () => {
  useChatModel([
    { tools: [{ name: "set_day_entry", input: { date: today, hours: 7, tasks: [{ description: "Fixed invoice matching bug" }, { description: "Reviewed 2 PRs" }] } }] },
    { text: "## Done\n**Logged** 7h for `today` in *Acme Corp*.\n- Fixed invoice matching bug\n- Reviewed 2 PRs" },
  ]);
  const { text } = await runTurn({ user: alice, channel: "telegram", externalId: "111", text: "7 hours, fixed invoice bug and reviewed PRs" });
  assert.ok(!/[#*`]/.test(text), `markdown leaked: ${text}`);
  assert.match(text, /Logged 7h/);

  const entries = await readEntries(await loadAdapter(alice.id, (await getTimesheet(alice.id, "Acme Corp"))!), (await loadProfile(alice.id, aliceTs))!, { from: today, to: today });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hours, 7);
  assert.match(entries[0].tasks!, /Fixed invoice matching bug; Reviewed 2 PRs/);

  const history = await recentMessages(alice.id, 10);
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant"]);
  const rows = await db().select().from(schema.messages).where(eq(schema.messages.userId, alice.id));
  assert.ok(rows.every((r) => !r.contentEnc.includes("invoice")));
});

test("agent turn (web): markdown is preserved for the web channel", async () => {
  useChatModel([{ text: "You have **one** entry." }]);
  const { text } = await runTurn({ user: alice, channel: "web", text: "how many entries do I have?" });
  assert.equal(text, "You have **one** entry.");
});

test("agent tools: leave keeps tasks, export is owner-only, other users are locked out", async () => {
  const { createTools } = await import("../lib/agent/tools");
  const files: { id: string; filename: string; mime: string }[] = [];
  const t = createTools({ userId: alice.id, userName: alice.name, channel: "web", timezone: alice.timezone, files });

  const leave = await exec(t.mark_leave, { date: today, type: "half", hours: 4 });
  assert.equal(leave.ok, true);
  const rows = await readEntries(await loadAdapter(alice.id, (await getTimesheet(alice.id, "Acme Corp"))!), (await loadProfile(alice.id, aliceTs))!, { from: today, to: today });
  assert.equal(rows[0].hours, 4);
  assert.match(rows[0].tasks!, /Half day leave/);
  assert.match(rows[0].tasks!, /Fixed invoice matching bug/); // tasks were kept

  const needs = await exec(t.set_day_entry, { date: today });
  assert.equal(needs.ok, false); // mixed timesheet needs hours and/or tasks

  const farFuture = await exec(t.set_day_entry, { date: "2099-01-01", hours: 8 });
  assert.equal(farFuture.ok, false);

  for (const format of ["xlsx", "pdf"] as const) {
    const res = await exec(t.export_timesheet, { format });
    assert.equal(res.ok, true, JSON.stringify(res));
  }
  assert.equal(files.length, 2);
  assert.ok(await getExport(alice.id, files[1].id));
  assert.equal(await getExport(bob.id, files[1].id), null);

  const bobTools = createTools({ userId: bob.id, userName: "Bob", channel: "web", timezone: "Europe/London", files: [] });
  assert.deepEqual((await exec(bobTools.list_timesheets, {})).timesheets, []);
  const peek = await exec(bobTools.read_entries, { timesheet: "Acme Corp", from: today, to: today });
  assert.equal(peek.ok, false);
  const poke = await exec(bobTools.set_day_entry, { timesheet: "Acme Corp", date: today, hours: 1 });
  assert.equal(poke.ok, false);
});

test("link codes are single-use and bound to a user", async () => {
  const code = await createCode(bob.id, "telegram_link", 5);
  assert.equal(await consumeCode(code, "web_login"), null); // wrong kind
  assert.equal(await consumeCode(code, "telegram_link"), bob.id);
  assert.equal(await consumeCode(code, "telegram_link"), null); // already used
  assert.equal(await consumeCode("nonsense-code-value", "telegram_link"), null);
});

test("telegram: conversational registration -> timezone -> timesheet upload -> agent chat", async () => {
  sent.length = 0;
  const chat = 777001;
  let uid = 9000;
  const say = (text: string, extra: object = {}) =>
    handleUpdate({ update_id: ++uid, message: { message_id: uid, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Zed" }, text, ...extra } });
  const last = () => sent[sent.length - 1].text;

  await say("hello");
  assert.match(last(), /What should I call you/);
  await say("Zed Kumar");
  assert.match(last(), /timezone/i);
  await say("zzzz not a place");
  assert.match(last(), /couldn't work out that timezone/); // LLM fallback blocked -> asks again
  await say("Mumbai");
  assert.match(last(), /Timezone: Asia\/Kolkata/);

  const zed = await findLinkedUser("telegram", String(chat));
  assert.equal(zed?.name, "Zed Kumar");
  assert.equal(zed?.timezone, "Asia/Kolkata");
  assert.equal(zed?.email, null);
  assert.equal((await getState("telegram", String(chat)))?.state, "ts_name");

  await say("Globex");
  assert.match(last(), /Excel file/);
  await say("", { document: { file_id: "f1", file_name: "sheet.csv", file_size: 100 } });
  assert.match(last(), /only read \.xlsx/);

  __setModelOverride(() => ({
    model: new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(PROFILE_JSON) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as never }) as never,
    modelId: "mock-analysis",
  }));
  await say("", { document: { file_id: "f2", file_name: "sheet.xlsx", file_size: 5000 } });
  assert.match(last(), /Here's what I found in "Globex"/);
  assert.equal(await getState("telegram", String(chat)), null);
  assert.ok(await getTimesheet(zed!.id, "Globex"));

  // everyday chat: agent exports a PDF and the bot attaches it
  useChatModel([
    { tools: [{ name: "set_day_entry", input: { date: today, hours: 6, tasks: [{ description: "Wrote the spec" }] } }] },
    { tools: [{ name: "export_timesheet", input: { format: "pdf" } }] },
    { text: "All done. Your PDF is attached." },
  ]);
  await say("log 6 hours writing the spec and send me a pdf");
  assert.match(last(), /PDF is attached/);
  assert.equal(docs.length, 1);
  assert.match(docs[0].name, /^globex_.*\.pdf$/);

  // /web issues a single-use sign-in link
  await say("/web");
  const m = last().match(/https:\/\/qorlog\.test\/login\/link\?code=([\w-]+)/);
  assert.ok(m, last());
  assert.equal(await consumeCode(m![1], "web_login"), zed!.id);
});

test("telegram: deep link connects an existing web account; ignores groups and bots", async () => {
  sent.length = 0;
  const code = await createCode(bob.id, "telegram_link", 15);
  await handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 555 }, text: `/start link_${code}` } });
  assert.equal((await findLinkedUser("telegram", "555"))?.id, bob.id);
  assert.match(sent[sent.length - 1].text, /You're linked, Bob/);

  const before = sent.length;
  await handleUpdate({ update_id: 2, message: { message_id: 2, chat: { id: -100, type: "supergroup" }, from: { id: 1 }, text: "hi" } });
  await handleUpdate({ update_id: 3, message: { message_id: 3, chat: { id: 5, type: "private" }, from: { id: 5, is_bot: true }, text: "hi" } });
  assert.equal(sent.length, before);
});

test("reminders: local-time window, once per day, weekdays only, retry on failure", async () => {
  await linkChannel(alice.id, "telegram", "111");
  const ids = (await db().select().from(schema.channelLinks)).filter((l) => l.channel === "telegram");
  assert.ok(ids.length >= 3);

  // Pick an actual Tuesday and Saturday for the 6 PM IST slot (12:30 UTC)
  const tue = new Date("2026-10-20T12:30:00Z");
  const sat = new Date("2026-10-24T12:30:00Z");
  const only = (chatId: string) => sent.filter((m) => String(m.chat_id) === chatId);

  sent.length = 0;
  await runReminders(new Date("2026-10-20T12:00:00Z")); // 17:30 IST: not yet
  assert.equal(only("111").length, 0);

  await runReminders(tue); // 18:00 IST
  assert.equal(only("111").length, 1);
  assert.match(only("111")[0].text, /what did you (work on|get done)|how was the day/i);
  assert.ok(!/[*_#`]/.test(only("111")[0].text.replace(/"6 hours: fixed login bug, reviewed PRs"/, "")), "reminder must be plain text");

  await runReminders(new Date("2026-10-20T13:10:00Z")); // same local day: no duplicate
  assert.equal(only("111").length, 1);

  sent.length = 0;
  await runReminders(sat); // Saturday: skipped
  assert.equal(only("111").length, 0);

  // failure path: Telegram down -> claim is released so the next run retries
  const realFetch = globalThis.fetch;
  const wed = new Date("2026-10-21T12:45:00Z");
  globalThis.fetch = (async () => Response.json({ ok: false, description: "boom" })) as typeof fetch;
  const failed = await runReminders(wed);
  globalThis.fetch = realFetch;
  assert.ok(failed.failed >= 1);
  sent.length = 0;
  await runReminders(wed);
  assert.equal(only("111").length, 1);
});

test("admin data layer: metadata and counts only, no content", async () => {
  const list = await adminListUsers();
  const everything = JSON.stringify(list) + JSON.stringify(await adminStats());
  assert.deepEqual(
    Object.keys(list[0]).sort(),
    ["createdAt", "email", "id", "lastActiveAt", "name", "role", "status", "telegram", "timesheetCount", "timezone"].sort(),
  );
  assert.ok(!everything.includes("v1."), "ciphertext leaked into admin data");
  assert.ok(!/Acme|Globex|invoice/i.test(everything), "timesheet content leaked into admin data");
  const a = list.find((u) => u.id === alice.id)!;
  assert.equal(a.timesheetCount, 1);
  assert.equal(a.telegram, true);
  const stats = await adminStats();
  assert.equal(stats.timesheets, 2);
  assert.ok(stats.tokens30d.input > 0); // usage is recorded without content
});

test("telegram webhook self-setup: sets once, is idempotent, derives a secret", async () => {
  const { ensureWebhook, webhookSecret } = await import("../lib/telegram/webhook");
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  let current = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = url.split("/").pop()!;
    calls.push(method);
    if (method === "setWebhook") {
      const body = JSON.parse(String(init?.body));
      current = body.url;
      assert.equal(body.secret_token, webhookSecret());
    }
    return Response.json({ ok: true, result: method === "getWebhookInfo" ? { url: current } : true });
  }) as typeof fetch;
  try {
    assert.ok(webhookSecret()!.length >= 32);
    const first = await ensureWebhook();
    assert.equal(first.status, "updated");
    assert.equal(first.url, "https://qorlog.test/api/telegram/webhook");
    assert.ok(calls.includes("setMyCommands"));
    calls.length = 0;
    assert.equal((await ensureWebhook()).status, "ok");
    assert.deepEqual(calls, ["getWebhookInfo"]); // no redundant writes
  } finally {
    globalThis.fetch = realFetch;
  }
});
