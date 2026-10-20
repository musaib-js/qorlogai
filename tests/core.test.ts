import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  decryptWithDek,
  encryptWithDek,
  newWrappedDek,
  unwrapDek,
} from "../lib/crypto";
import {
  addDays,
  formatDate,
  localParts,
  parseCellDate,
  parseMonthFromTabName,
  recentCalendar,
  resolveTimezoneLocal,
} from "../lib/time";
import { stripMarkdown } from "../lib/agent/channel";

process.env.QORLOG_MASTER_KEY = randomBytes(32).toString("base64");

test("envelope encryption round-trips and is bound to the owner", () => {
  const dek = unwrapDek("user-a", newWrappedDek("user-a"));
  const ct = encryptWithDek(dek, "user-a", "secret timesheet");
  assert.equal(decryptWithDek(dek, "user-a", ct).toString(), "secret timesheet");
  // another user id cannot open it, even with the right key
  assert.throws(() => decryptWithDek(dek, "user-b", ct));
  // another user's key cannot open it
  const otherDek = unwrapDek("user-b", newWrappedDek("user-b"));
  assert.throws(() => decryptWithDek(otherDek, "user-a", ct));
  // a wrapped key can't be moved to another user
  assert.throws(() => unwrapDek("user-b", newWrappedDek("user-a")));
});

test("local time respects half-hour zones", () => {
  const now = new Date("2026-10-20T12:30:00Z");
  const p = localParts("Asia/Kolkata", now);
  assert.equal(p.date, "2026-10-20");
  assert.equal(p.minutesOfDay, 18 * 60);
  assert.equal(localParts("America/Los_Angeles", now).date, "2026-10-20");
  assert.equal(localParts("Pacific/Auckland", new Date("2026-10-20T20:00:00Z")).date, "2026-10-21");
});

test("date helpers", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(formatDate("2026-10-20", "DD/MM/YYYY"), "20/10/2026");
  assert.equal(formatDate("2026-10-20", "ddd, D MMM YYYY"), "Tue, 20 Oct 2026");
  assert.equal(parseCellDate("20/10/2026", "DMY"), "2026-10-20");
  assert.equal(parseCellDate("10/20/2026", "DMY"), "2026-10-20"); // impossible DMY falls back to MDY
  assert.equal(parseCellDate("Oct 20, 2026"), "2026-10-20");
  assert.equal(parseCellDate("20-Oct-26"), "2026-10-20");
  assert.equal(parseCellDate(46315), "2026-10-20");
  assert.equal(parseMonthFromTabName("October 2026"), "2026-10");
  assert.equal(parseMonthFromTabName("Timesheet 10-2026"), "2026-10");
  assert.match(recentCalendar("Asia/Kolkata", 3, new Date("2026-10-20T12:30:00Z")), /Tue 2026-10-20 \(today\)\nMon 2026-10-19 \(yesterday\)/);
});

test("timezone resolution from free text", () => {
  assert.equal(resolveTimezoneLocal("IST"), "Asia/Kolkata");
  assert.equal(resolveTimezoneLocal("Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(resolveTimezoneLocal("asia/calcutta"), "Asia/Calcutta");
  assert.equal(resolveTimezoneLocal("+05:30"), "Asia/Kolkata");
  assert.equal(resolveTimezoneLocal("UTC-8"), "America/Los_Angeles");
  assert.equal(resolveTimezoneLocal("Tokyo"), "Asia/Tokyo");
  assert.equal(resolveTimezoneLocal("new york"), "America/New_York");
  assert.equal(resolveTimezoneLocal("banana"), null);
});

test("markdown is stripped for plain-text channels", () => {
  const md = "## Summary\n**Logged** 8h on `Qorlog`.\n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[docs](https://x.y)";
  const out = stripMarkdown(md);
  assert.ok(!/[#*`|]/.test(out), out);
  assert.match(out, /Logged 8h on Qorlog/);
  assert.match(out, /docs \(https:\/\/x\.y\)/);
  assert.match(out, /- item one/);
});
