import ExcelJS from "exceljs";

import type { Cell, CellWrite, ReadOpts, SheetAdapter, SheetInfo } from "./types";
import { SheetError } from "./types";
import { resolveSheetName } from "./names";

type Persist = (bytes: Buffer) => Promise<void>;

export function normalizeValue(v: ExcelJS.CellValue, formulas = false): Cell {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel "time only" values live around 1899-12-30
    if (v.getUTCFullYear() < 1950) return v.toISOString().slice(11, 16);
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      if (formulas) return `=${String(o.formula ?? o.sharedFormula ?? "")}`;
      return normalizeValue(o.result as ExcelJS.CellValue, false);
    }
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return String(o.error);
    return null;
  }
  return v as Cell;
}

export function excelNumFmt(fmt: string): string {
  return fmt.replace(/YYYY/g, "yyyy").replace(/YY/g, "yy").replace(/DD/g, "dd").replace(/D/g, "d").replace(/dddd/gi, "dddd");
}

export class XlsxAdapter implements SheetAdapter {
  readonly kind = "xlsx" as const;

  private constructor(
    private wb: ExcelJS.Workbook,
    private persist: Persist | null,
  ) {}

  static async load(bytes: Buffer, persist: Persist | null = null): Promise<XlsxAdapter> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw new SheetError("That file couldn't be opened as an .xlsx workbook.", "bad_file");
    }
    return new XlsxAdapter(wb, persist);
  }

  private ws(name: string): ExcelJS.Worksheet {
    const real = resolveSheetName(this.wb.worksheets.map((w) => w.name), name);
    return this.wb.getWorksheet(real) ?? this.wb.worksheets.find((w) => w.name === real)!;
  }

  async listSheets(): Promise<SheetInfo[]> {
    return this.wb.worksheets.map((w) => ({ name: w.name, rows: w.rowCount, cols: w.columnCount }));
  }

  async read(sheet: string, opts: ReadOpts = {}): Promise<Cell[][]> {
    const ws = this.ws(sheet);
    const start = Math.max(1, opts.startRow ?? 1);
    const end = Math.min(ws.rowCount, start + (opts.maxRows ?? 200) - 1);
    const cols = Math.min(ws.columnCount, opts.maxCols ?? 40);
    const out: Cell[][] = [];
    for (let r = start; r <= end; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= cols; c++) cells.push(normalizeValue(row.getCell(c).value, opts.formulas));
      out.push(cells);
    }
    return out;
  }

  async write(sheet: string, cells: CellWrite[]): Promise<void> {
    const ws = this.ws(sheet);
    for (const w of cells) {
      const cell = ws.getRow(w.row).getCell(w.col);
      cell.value = w.value as ExcelJS.CellValue;
      if (w.value instanceof Date && w.numFmt && (!cell.numFmt || cell.numFmt === "General")) {
        cell.numFmt = excelNumFmt(w.numFmt);
      }
      ws.getRow(w.row).commit?.();
    }
  }

  async appendRow(sheet: string, values: (Cell | Date)[]): Promise<number> {
    const ws = this.ws(sheet);
    let last = ws.rowCount;
    while (last > 0 && !this.rowHasData(ws.getRow(last))) last--;
    const target = last + 1;
    const prev = last > 0 ? ws.getRow(last) : null;
    const row = ws.getRow(target);
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      if (prev) {
        const p = prev.getCell(i + 1);
        if (p.style) cell.style = { ...p.style };
      }
      if (v !== null && v !== undefined) cell.value = v as ExcelJS.CellValue;
    });
    row.commit?.();
    return target;
  }

  private rowHasData(row: ExcelJS.Row): boolean {
    let has = false;
    row.eachCell({ includeEmpty: false }, (c) => {
      if (c.value !== null && c.value !== undefined && c.value !== "") has = true;
    });
    return has;
  }

  async exportXlsx(): Promise<Buffer> {
    return Buffer.from(await this.wb.xlsx.writeBuffer());
  }

  async save(): Promise<void> {
    if (this.persist) await this.persist(await this.exportXlsx());
  }
}
