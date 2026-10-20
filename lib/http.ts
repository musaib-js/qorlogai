/** Rejects cross-site state-changing requests. Browsers always send Origin on cross-site POST/DELETE. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, server-to-server) are authenticated by cookie anyway
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });
