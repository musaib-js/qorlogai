import { deleteTimesheet } from "@/lib/data/timesheets";
import { json, sameOrigin } from "@/lib/http";
import { apiUser } from "@/lib/session";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await apiUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { id } = await ctx.params;
  const ok = await deleteTimesheet(user.id, id); // scoped to the owner inside
  return ok ? json({ ok: true }) : json({ error: "Not found" }, 404);
}
