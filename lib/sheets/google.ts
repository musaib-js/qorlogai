import { auth, sheets, type sheets_v4 } from "@googleapis/sheets";
import ExcelJS from "exceljs";

import type { Cell, CellWrite, ReadOpts, SheetAdapter, SheetInfo } from "./types";
import { SheetError } from "./types";
import { resolveSheetName } from "./names";

/**
 * Google Sheets access uses ONE service account owned by Qorlog (env GOOGLE_SERVICE_ACCOUNT_JSON).
 * Users never hand over credentials: they share their sheet with the service account's email as
 * an Editor, and we can only ever touch sheets that were explicitly shared with it.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

let cachedAccount: ServiceAccount | null = null;

function serviceAccount(): ServiceAccount {
  if (cachedAccount) return cachedAccount;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new SheetError("Google Sheets isn't configured on this server yet.", "unsupported");
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  cachedAccount = JSON.parse(text) as ServiceAccount;
  return cachedAccount;
}

export function serviceAccountEmail(): string | null {
  try {
    return serviceAccount().client_email;
  } catch {
    return null;
  }
}

export function parseSpreadsheetId(input: string): string | null {
  const m = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  const bare = input.trim();
  return /^[a-zA-Z0-9-_]{30,}$/.test(bare) ? bare : null;
}

function client(): sheets_v4.Sheets {
  const sa = serviceAccount();
  const authClient = new auth.GoogleAuth({
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheets({ version: "v4", auth: authClient });
}

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const q = (name: string) => `'${name.replace(/'/g, "''")}'`;

/**
 * USER_ENTERED makes Sheets evaluate formulas. Text that came from a user or a model must never be
 * able to become one (=IMPORTDATA(...) could exfiltrate cell contents), so leading =,+,-,@ is escaped.
 */
const guard = (v: Cell | Date): Cell =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : (v ?? "");

function mapError(e: unknown): never {
  const err = e as { code?: number; status?: number; message?: string };
  const code = err.code ?? err.status;
  if (code === 403 || code === 401) throw new SheetError("Qorlog doesn't have access to that sheet yet.", "no_access");
  if (code === 404) throw new SheetError("That Google Sheet couldn't be found. Check the link.", "not_found");
  throw new SheetError(err.message ?? "Google Sheets request failed.", "invalid");
}

export class GoogleSheetAdapter implements SheetAdapter {
  readonly kind = "gsheet" as const;
  private api = client();

  private names: string[] | null = null;

  constructor(private spreadsheetId: string) {}

  /** Accepts "November 26" for a tab called "Nov-26". */
  private async tab(sheet: string): Promise<string> {
    this.names ??= (await this.listSheets()).map((s) => s.name);
    return resolveSheetName(this.names, sheet);
  }

  async listSheets(): Promise<SheetInfo[]> {
    try {
      const res = await this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties(title,gridProperties(rowCount,columnCount))",
      });
      return (res.data.sheets ?? []).map((s) => ({
        name: s.properties?.title ?? "Sheet",
        rows: s.properties?.gridProperties?.rowCount ?? 0,
        cols: s.properties?.gridProperties?.columnCount ?? 0,
      }));
    } catch (e) {
      return mapError(e);
    }
  }

  async read(sheetName: string, opts: ReadOpts = {}): Promise<Cell[][]> {
    const sheet = await this.tab(sheetName);
    const start = Math.max(1, opts.startRow ?? 1);
    const end = start + (opts.maxRows ?? 200) - 1;
    const lastCol = colLetter(opts.maxCols ?? 40);
    try {
      const res = await this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${q(sheet)}!A${start}:${lastCol}${end}`,
        valueRenderOption: opts.formulas ? "FORMULA" : "FORMATTED_VALUE",
      });
      const rows = (res.data.values ?? []) as Cell[][];
      return rows.map((r) => r.map((c) => (c === "" ? null : c)));
    } catch (e) {
      return mapError(e);
    }
  }

  async write(sheetName: string, cells: CellWrite[]): Promise<void> {
    if (!cells.length) return;
    const sheet = await this.tab(sheetName);
    try {
      await this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: cells.map((c) => ({
            range: `${q(sheet)}!${colLetter(c.col)}${c.row}`,
            values: [[guard(c.value)]],
          })),
        },
      });
    } catch (e) {
      mapError(e);
    }
  }

  async appendRow(sheetName: string, values: (Cell | Date)[]): Promise<number> {
    const sheet = await this.tab(sheetName);
    try {
      const res = await this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${q(sheet)}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [values.map(guard)],
        },
      });
      const m = res.data.updates?.updatedRange?.match(/!(?:[A-Z]+)(\d+)/);
      return m ? Number(m[1]) : 0;
    } catch (e) {
      return mapError(e);
    }
  }

  async exportXlsx(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    for (const s of await this.listSheets()) {
      const ws = wb.addWorksheet(s.name);
      const rows = await this.read(s.name, { maxRows: Math.min(s.rows || 500, 2000), maxCols: Math.min(s.cols || 26, 40) });
      rows.forEach((r) => ws.addRow(r));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async save(): Promise<void> {
    /* writes are applied immediately */
  }
}

/** Verifies we can reach the spreadsheet. Returns its title and sheet names. */
export async function probeSpreadsheet(spreadsheetId: string): Promise<{ title: string; sheets: string[] }> {
  try {
    const res = await client().spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
    return {
      title: res.data.properties?.title ?? "Untitled",
      sheets: (res.data.sheets ?? []).map((s) => s.properties?.title ?? "Sheet"),
    };
  } catch (e) {
    return mapError(e);
  }
}
