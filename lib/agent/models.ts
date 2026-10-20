import { createGroq } from "@ai-sdk/groq";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiModels, usageEvents } from "@/lib/db/schema";

export type Purpose = "chat" | "analysis" | "utility";

const FALLBACK: Record<Purpose, string> = {
  chat: process.env.DEFAULT_CHAT_MODEL || "llama-3.3-70b-versatile",
  analysis: process.env.DEFAULT_ANALYSIS_MODEL || "openai/gpt-oss-120b",
  utility: process.env.DEFAULT_UTILITY_MODEL || "llama-3.1-8b-instant",
};

let groqClient: ReturnType<typeof createGroq> | null = null;
function groq() {
  if (!groqClient) groqClient = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

let cache: { at: number; rows: (typeof aiModels.$inferSelect)[] } | null = null;

async function catalog() {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  try {
    const rows = await db().select().from(aiModels).where(sql`${aiModels.enabled} = true`);
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    return [];
  }
}

export function invalidateModelCache() {
  cache = null;
}

type ModelPick = { model: ReturnType<ReturnType<typeof createGroq>>; modelId: string };
let override: ((purpose: Purpose) => ModelPick) | null = null;
/** Test seam: substitute a mock model. */
export function __setModelOverride(fn: ((purpose: Purpose) => ModelPick) | null) {
  override = fn;
}

/** Picks the model for a purpose from the admin-managed catalog; env defaults if the catalog is empty. */
export async function resolveModel(purpose: Purpose): Promise<ModelPick> {
  if (override) return override(purpose);
  const rows = (await catalog()).filter((m) => m.provider === "groq" && m.purposes.includes(purpose));
  const pick = rows.find((m) => m.defaultFor.includes(purpose)) ?? rows[0];
  const modelId = pick?.modelId ?? FALLBACK[purpose];
  return { model: groq()(modelId), modelId };
}

export async function recordUsage(args: {
  userId: string | null;
  modelId: string;
  purpose: Purpose;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  try {
    await db().insert(usageEvents).values({
      userId: args.userId,
      modelId: args.modelId,
      purpose: args.purpose,
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
    });
  } catch {
    /* usage accounting must never break a reply */
  }
}

export function isRateLimit(e: unknown): boolean {
  const err = e as { statusCode?: number; status?: number; message?: string };
  return err?.statusCode === 429 || err?.status === 429 || /rate.?limit/i.test(err?.message ?? "");
}
