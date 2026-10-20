import { getTimesheet } from "@/lib/data/timesheets";
import { buildExport } from "@/lib/exporter";
import { json } from "@/lib/http";
import { apiUser } from "@/lib/session";
import { SheetError } from "@/lib/sheets/types";

export const maxDuration = 60;

/** GET /api/timesheets/:id/export?format=xlsx|pdf[&from=YYYY-MM-DD&to=YYYY-MM-DD] */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const ts = await getTimesheet(user.id, id);
  if (!ts) return json({ error: "Not found" }, 404);
  try {
    const out = await buildExport({
      user,
      ts,
      format,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return new Response(new Uint8Array(out.bytes), {
      headers: {
        "content-type": out.mime,
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return json({ error: e instanceof SheetError ? e.message : "Export failed." }, 422);
  }
}
