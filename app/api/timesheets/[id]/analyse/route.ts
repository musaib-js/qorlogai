import { analyseAndSave } from "@/lib/agent/profiling";
import { friendlySummary } from "@/lib/agent/summary";
import { getTimesheet } from "@/lib/data/timesheets";
import { json, sameOrigin } from "@/lib/http";
import { apiUser } from "@/lib/session";
import { SheetError } from "@/lib/sheets/types";

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await apiUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { id } = await ctx.params;
  const ts = await getTimesheet(user.id, id);
  if (!ts) return json({ error: "Not found" }, 404);
  try {
    const profile = await analyseAndSave(user.id, ts);
    return json({ ok: true, summary: friendlySummary(ts.name, profile) });
  } catch (e) {
    return json({ error: e instanceof SheetError ? e.message : "Analysis failed." }, 422);
  }
}
