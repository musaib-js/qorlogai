import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { EntryRow } from "./ops";
import { formatDate, weekdayName } from "@/lib/time";

export interface Report {
  title: string; // timesheet name
  person: string;
  from: string;
  to: string;
  entries: EntryRow[];
}

export function totals(entries: EntryRow[]) {
  const hours = entries.reduce((a, e) => a + (e.hours ?? 0), 0);
  // one value per date (a task-per-row sheet repeats dates), taken from the leave classification
  const perDate = new Map<string, number>();
  for (const e of entries) perDate.set(e.date, Math.max(perDate.get(e.date) ?? 0, e.leaveDays));
  const leaveDates = [...perDate].filter(([, d]) => d > 0).sort(([a], [b]) => a.localeCompare(b));
  return {
    hours: Math.round(hours * 100) / 100,
    leaveDays: leaveDates.reduce((a, [, d]) => a + d, 0),
    fullLeaveDays: leaveDates.filter(([, d]) => d >= 1).length,
    halfLeaveDays: leaveDates.filter(([, d]) => d > 0 && d < 1).length,
    leaveDates: leaveDates.map(([date, d]) => `${date}${d < 1 ? " (half)" : ""}`),
    days: perDate.size,
  };
}

const notesOf = (e: EntryRow) => [e.leave, e.notes].filter(Boolean).join(" | ");

export async function reportXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Qorlog AI";
  const ws = wb.addWorksheet(r.title.slice(0, 28) || "Timesheet", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([`${r.title} - ${r.person}`]).font = { bold: true, size: 14 };
  ws.addRow([`${r.from} to ${r.to}`]).font = { color: { argb: "FF666666" } };
  const head = ws.addRow(["Date", "Day", "Hours", "Tasks", "Project", "Notes / Leave"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B4BDB" } };
  });
  for (const e of r.entries) {
    ws.addRow([new Date(`${e.date}T00:00:00Z`), weekdayName(e.date), e.hours, e.tasks ?? "", e.project ?? "", notesOf(e)]);
  }
  const t = totals(r.entries);
  const last = ws.rowCount;
  const sum = ws.addRow(["Total", "", { formula: `SUM(C4:C${Math.max(last, 4)})`, result: t.hours }, "", "", t.leaveDays ? `${t.leaveDays} leave day(s)` : ""]);
  sum.font = { bold: true };
  ws.getColumn(1).numFmt = "dd-mmm-yyyy";
  ws.columns = [{ width: 14 }, { width: 12 }, { width: 8 }, { width: 60 }, { width: 18 }, { width: 28 }];
  ws.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// --- PDF ------------------------------------------------------------------------------------

/** Standard PDF fonts only cover Latin-1; map common typography and replace anything else. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\r\n]+/g, " / ")
    .replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      // hard-split very long tokens
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let i = rest.length - 1;
        while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
        lines.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      cur = rest;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function reportPdf(r: Report): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const M = 40;
  const cols = [
    { label: "Date", w: 66 },
    { label: "Hrs", w: 34 },
    { label: "Tasks", w: 228 },
    { label: "Project", w: 78 },
    { label: "Notes / Leave", w: 109 },
  ];
  const size = 9;
  const lh = 12;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const drawHeader = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: rgb(0.36, 0.29, 0.86) });
    for (const c of cols) {
      page.drawText(c.label, { x: x + 4, y: y, size, font: bold, color: rgb(1, 1, 1) });
      x += c.w;
    }
    y -= 22;
  };

  page.drawText(pdfSafe(`${r.title}`), { x: M, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.15) });
  y -= 18;
  page.drawText(pdfSafe(`${r.person}  |  ${formatDate(r.from, "D MMM YYYY")} - ${formatDate(r.to, "D MMM YYYY")}`), {
    x: M, y, size: 10, font, color: rgb(0.4, 0.4, 0.45),
  });
  y -= 26;
  drawHeader();

  for (const e of r.entries) {
    const cells = [
      `${formatDate(e.date, "DD MMM")} ${weekdayName(e.date).slice(0, 3)}`,
      e.hours == null ? "" : String(e.hours),
      e.tasks ?? "",
      e.project ?? "",
      notesOf(e),
    ];
    const wrapped = cells.map((t, i) => wrap(t, font, size, cols[i].w - 8));
    const rows = Math.max(...wrapped.map((w) => w.length));
    const rowH = rows * lh + 4;
    if (y - rowH < M + 30) {
      page = pdf.addPage([W, H]);
      y = H - M;
      drawHeader();
    }
    let x = M;
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, li) => page.drawText(ln, { x: x + 4, y: y - li * lh, size, font, color: rgb(0.12, 0.12, 0.15) }));
      x += cols[i].w;
    });
    y -= rowH;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: rgb(0.88, 0.88, 0.92) });
  }

  const t = totals(r.entries);
  if (y < M + 40) {
    page = pdf.addPage([W, H]);
    y = H - M;
  }
  y -= 10;
  page.drawText(pdfSafe(`Total: ${t.hours} hours across ${t.days} day(s)${t.leaveDays ? `  |  ${t.leaveDays} leave day(s)` : ""}`), {
    x: M, y, size: 11, font: bold, color: rgb(0.1, 0.1, 0.15),
  });
  page.drawText("Generated by Qorlog AI", { x: M, y: M - 12, size: 8, font, color: rgb(0.6, 0.6, 0.65) });

  return Buffer.from(await pdf.save());
}
