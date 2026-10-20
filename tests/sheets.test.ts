import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";

import { heuristicProfile } from "../lib/sheets/profile";
import { readEntries, setDayEntry } from "../lib/sheets/ops";
import { reportPdf, reportXlsx, totals } from "../lib/sheets/export";
import { XlsxAdapter } from "../lib/sheets/xlsx-adapter";

async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<XlsxAdapter> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return XlsxAdapter.load(buf);
}

async function profileOf(a: XlsxAdapter) {
  const sheets = [];
  for (const s of await a.listSheets()) sheets.push({ name: s.name, rows: await a.read(s.name, { maxRows: 40, formulas: true }) });
  return heuristicProfile(sheets);
}

test("row-per-day timesheet: detects layout, appends and updates a day", async () => {
  const a = await workbook((wb) => {
    const ws = wb.addWorksheet("Oct 2026");
    ws.addRow(["Acme Corp timesheet"]);
    ws.addRow([]);
    ws.addRow(["Date", "Day", "Hours", "Tasks", "Total"]);
    ws.addRow([new Date("2026-10-19T00:00:00Z"), "Monday", 8, "Standup, code review", { formula: "C4", result: 8 }]);
  });
  const p = await profileOf(a);
  const s = p.sheets[0];
  assert.equal(s.layout, "row_per_day");
  assert.equal(s.headerRow, 3);
  assert.equal(s.columns.find((c) => c.header === "Total")?.meaning, "computed");

  const r1 = await setDayEntry(a, p, { date: "2026-10-20", hours: 7.5, tasks: [{ description: "Built login page" }] });
  assert.equal(r1.action, "appended");
  const r2 = await setDayEntry(a, p, { date: "2026-10-20", tasks: [{ description: "Fixed bug 42" }], hours: 1, mode: "append" });
  assert.equal(r2.action, "updated");

  const entries = await readEntries(a, p, { from: "2026-10-19", to: "2026-10-21" });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].date, "2026-10-20");
  assert.equal(entries[1].hours, 8.5);
  assert.match(entries[1].tasks ?? "", /Built login page; Fixed bug 42/);
});

test("leave: half day writes into the leave column", async () => {
  const a = await workbook((wb) => {
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Date", "Hours", "Project", "Leave"]);
    ws.addRow(["20/10/2026", 8, "X", null]);
  });
  const p = await profileOf(a);
  await setDayEntry(a, p, { date: "2026-10-20", leave: "half", hours: 4, mode: "replace" });
  const e = await readEntries(a, p, { from: "2026-10-20", to: "2026-10-20" });
  assert.equal(e[0].hours, 4);
  assert.equal(e[0].leave, "Half day leave");
});

test("row-per-entry timesheet: one row per task, replace trims extras", async () => {
  const a = await workbook((wb) => {
    const ws = wb.addWorksheet("Log");
    ws.addRow(["Date", "Task", "Hours"]);
    ws.addRow(["2026-10-19", "A", 2]);
    ws.addRow(["2026-10-19", "B", 3]);
    ws.addRow(["2026-10-19", "C", 3]);
    ws.addRow(["2026-10-20", "D", 4]);
  });
  const p = await profileOf(a);
  assert.equal(p.sheets[0].layout, "row_per_entry");
  await setDayEntry(a, p, {
    date: "2026-10-19",
    tasks: [{ description: "Only one", hours: 8 }],
    mode: "replace",
  });
  const e = await readEntries(a, p, { from: "2026-10-19", to: "2026-10-19" });
  assert.equal(e.filter((x) => x.tasks).length, 1);
  assert.equal(e.find((x) => x.tasks)?.tasks, "Only one");
});

test("tab-per-month picks the right tab and refuses a missing one", async () => {
  const a = await workbook((wb) => {
    for (const n of ["Sep 2026", "Oct 2026"]) {
      const ws = wb.addWorksheet(n);
      ws.addRow(["Date", "Hours", "Tasks"]);
    }
  });
  const p = await profileOf(a);
  assert.equal(p.sheetSelection, "tab_per_month");
  const r = await setDayEntry(a, p, { date: "2026-10-05", hours: 8, tasks: [{ description: "x" }] });
  assert.equal(r.sheet, "Oct 2026");
  await assert.rejects(() => setDayEntry(a, p, { date: "2026-12-05", hours: 8 }), /no tab for 2026-12/);
});

test("reports render to xlsx and pdf, including non-latin text", async () => {
  const entries = [
    { sheet: "s", row: 2, date: "2026-10-20", hours: 8, tasks: "Wrote “spec” — नमस्ते", project: "P", notes: null, leave: null, leaveDays: 0 },
    { sheet: "s", row: 3, date: "2026-10-21", hours: 4, tasks: null, project: null, notes: null, leave: "Half day leave", leaveDays: 0.5 },
  ];
  const r = { title: "Acme", person: "Musaib", from: "2026-10-01", to: "2026-10-31", entries };
  const t = totals(entries);
  assert.equal(t.hours, 12);
  assert.equal(t.leaveDays, 0.5);
  assert.equal(t.days, 2);
  const x = await reportXlsx(r);
  const p = await reportPdf(r);
  assert.ok(x.length > 1000);
  assert.equal(p.subarray(0, 4).toString(), "%PDF");
});

// ---- regressions from real chat failures -------------------------------------------------------

async function novemberBook() {
  return workbook((wb) => {
    for (const [tab, m] of [["Oct-26", 10], ["Nov-26", 11]] as const) {
      const ws = wb.addWorksheet(tab);
      ws.addRow(["Date", "Day", "Project", "Task Description", "Hours", "Status"]);
      for (let d = 1; d <= 30; d++) {
        const dt = new Date(Date.UTC(2026, m - 1, d));
        const wd = dt.getUTCDay();
        const status = wd === 0 || wd === 6 ? "Weekend" : d === 9 || d === 18 ? "Leave" : d === 13 ? "Half Day" : d === 5 ? "Holiday" : "Present";
        const present = status === "Present";
        // "leave" appears in free text on purpose: it must not be counted as leave
        ws.addRow([dt, "", present ? "Acme" : "", present ? "Updated the leave policy page" : "", present ? 8 : 0, status]);
      }
    }
  });
}

test("a tab called Nov-26 is found however the user spells it", async () => {
  const { matchSheetName } = await import("../lib/sheets/names");
  const names = ["Oct-26", "Nov-26", "Summary"];
  for (const q of ["November 26", "nov 2026", "Nov-26", "nov-26", "November", "11/2026", "november 2026 sheet"]) {
    assert.equal(matchSheetName(names, q), "Nov-26", q);
  }
  assert.equal(matchSheetName(names, "Dec 26"), null);
  const a = await novemberBook();
  assert.ok((await a.read("November 26", { maxRows: 2 })).length === 2);
  await assert.rejects(() => a.read("Dec 26"), /sheets in this file are: "Oct-26", "Nov-26"/);
});

test("leave is counted from the status column, not from the word leave in task text", async () => {
  const a = await novemberBook();
  const p = await profileOf(a);
  const e = await readEntries(a, p, { from: "2026-11-01", to: "2026-11-30" });
  const t = totals(e);
  // 9 and 18 Nov are Mondays/Wednesdays (full leave), the 13th a half day. Holiday and weekends are not leave.
  assert.equal(t.fullLeaveDays, 2);
  assert.equal(t.halfLeaveDays, 1);
  assert.equal(t.leaveDays, 2.5);
});

test("leave classification handles real-world vocabulary", async () => {
  const { classifyLeave } = await import("../lib/sheets/leave");
  const col = { inLeaveColumn: true };
  assert.equal(classifyLeave("Leave", col), 1);
  assert.equal(classifyLeave("Sick Leave", col), 1);
  assert.equal(classifyLeave("Half Day", col), 0.5);
  assert.equal(classifyLeave("Half day leave", col), 0.5);
  assert.equal(classifyLeave("Holiday", col), 0);
  assert.equal(classifyLeave("Weekend", col), 0);
  assert.equal(classifyLeave("Present", col), 0);
  assert.equal(classifyLeave("WFH", col), 0);
  assert.equal(classifyLeave("Reviewed leave policy", { inLeaveColumn: false }), 0);
  assert.equal(classifyLeave("Leave - dentist", { inLeaveColumn: false }), 1);
  // a sheet that defines its own vocabulary is strict about it
  const markers = [{ text: "PL", days: 1 }, { text: "HD", days: 0.5 }];
  assert.equal(classifyLeave("PL", { inLeaveColumn: true, markers }), 1);
  assert.equal(classifyLeave("Leave", { inLeaveColumn: true, markers }), 0);
});

test("column statistics list the status values found in the whole sheet", async () => {
  const { columnStats } = await import("../lib/sheets/profile");
  const a = await novemberBook();
  const p = await profileOf(a);
  const s = p.sheets.find((x) => x.name === "Nov-26")!;
  const rows = await a.read("Nov-26", { startRow: 2, maxRows: 100, maxCols: 6 });
  const status = columnStats(rows, s.columns).find((c) => c.col === 6)!;
  assert.deepEqual(new Set(status.values!.map((v) => v.value)), new Set(["Present", "Weekend", "Leave", "Half Day", "Holiday"]));
});

test("writes land and can be read back; PDF for a month includes its rows", async () => {
  const a = await novemberBook();
  const p = await profileOf(a);
  await setDayEntry(a, p, { date: "2026-11-03", hours: 6, tasks: [{ description: "Fixed invoice bug" }], sheet: "November 26" });
  await a.save();
  const back = await readEntries(a, p, { from: "2026-11-03", to: "2026-11-03", sheet: "Nov-26" });
  assert.equal(back.length, 1);
  assert.equal(back[0].hours, 6);
  assert.match(back[0].tasks ?? "", /Fixed invoice bug/);
  const all = await readEntries(a, p, { from: "2026-11-01", to: "2026-11-30" });
  const pdf = await reportPdf({ title: "Acme", person: "M", from: "2026-11-01", to: "2026-11-30", entries: all });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
