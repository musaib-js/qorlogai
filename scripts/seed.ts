import "dotenv/config";
import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { aiModels } from "../lib/db/schema";

/** Seeds the admin model catalog with Groq's free-tier models. Edit them later in /admin/models. */
const MODELS = [
  { modelId: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B Versatile", purposes: ["chat"], defaultFor: ["chat"], contextWindow: 131072, notes: "Main chat + tool-calling model." },
  { modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B", purposes: ["analysis", "chat"], defaultFor: ["analysis"], contextWindow: 131072, notes: "Timesheet analysis (structured output)." },
  { modelId: "openai/gpt-oss-20b", displayName: "GPT-OSS 20B", purposes: ["analysis", "chat"], defaultFor: [] as string[], contextWindow: 131072, notes: "Lighter alternative with structured output." },
  { modelId: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B Instant", purposes: ["utility", "chat"], defaultFor: ["utility"], contextWindow: 131072, notes: "Fast and cheap: timezone parsing, small jobs." },
];

async function main() {
  for (const m of MODELS) {
    await db()
      .insert(aiModels)
      .values({ provider: "groq", ...m })
      .onConflictDoNothing({ target: [aiModels.provider, aiModels.modelId] });
  }
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(aiModels);
  console.log(`Model catalog now has ${n} model(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
