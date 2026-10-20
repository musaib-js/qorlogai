import { getExport } from "@/lib/data/messages";
import { json } from "@/lib/http";
import { apiUser } from "@/lib/session";

/** Files produced by the chat agent. Only the owner can fetch them, and only for 30 minutes. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { id } = await ctx.params;
  const file = await getExport(user.id, id);
  if (!file) return json({ error: "This file has expired or doesn't exist." }, 404);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
