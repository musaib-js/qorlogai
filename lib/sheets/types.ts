export type Cell = string | number | boolean | null;

export interface SheetInfo {
  name: string;
  rows: number;
  cols: number;
}

export interface ReadOpts {
  /** 1-based first row to return (default 1) */
  startRow?: number;
  maxRows?: number;
  maxCols?: number;
  /** return formulas ("=SUM(A1:A3)") instead of computed values */
  formulas?: boolean;
}

export interface CellWrite {
  row: number; // 1-based
  col: number; // 1-based
  value: Cell | Date;
  /** xlsx only: number format to apply when the target cell has none (e.g. "dd/mm/yyyy") */
  numFmt?: string;
}

/** One interface over "an Excel file we hold for the user" and "a Google Sheet shared with us". */
export interface SheetAdapter {
  readonly kind: "xlsx" | "gsheet";
  listSheets(): Promise<SheetInfo[]>;
  read(sheet: string, opts?: ReadOpts): Promise<Cell[][]>;
  write(sheet: string, cells: CellWrite[]): Promise<void>;
  /** Appends after the last non-empty row. Returns the 1-based row number written. */
  appendRow(sheet: string, values: (Cell | Date)[]): Promise<number>;
  exportXlsx(): Promise<Buffer>;
  /** Persist pending changes (xlsx is held in memory until saved). */
  save(): Promise<void>;
}

export class SheetError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "no_access" | "bad_file" | "unsupported" | "invalid" = "invalid",
  ) {
    super(message);
  }
}
