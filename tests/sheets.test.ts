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
    { sheet: "s", row: 2, date: "2026-10-20", hours: 8, tasks: "Wrote “spec” — नमस्ते", project: "P", notes: null, leave: null },
    { sheet: "s", row: 3, date: "2026-10-21", hours: 4, tasks: null, project: null, notes: null, leave: "Half day leave" },
  ];
  const r = { title: "Acme", person: "Musaib", from: "2026-10-01", to: "2026-10-31", entries };
  assert.deepEqual(totals(entries), { hours: 12, leaveDays: 0.5, days: 2 });
  const x = await reportXlsx(r);
  const p = await reportPdf(r);
  assert.ok(x.length > 1000);
  assert.equal(p.subarray(0, 4).toString(), "%PDF");
});
