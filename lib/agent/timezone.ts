import { generateText, Output } from "ai";
import { z } from "zod";

import { recordUsage, resolveModel } from "./models";
import { isValidTimezone, resolveTimezoneLocal } from "@/lib/time";

/** Rules first (instant, free); the utility model only when the text is something like "I'm in Pune, India". */
export async function resolveTimezoneSmart(text: string): Promise<string | null> {
  const local = resolveTimezoneLocal(text);
  if (local) return local;
  if (text.trim().length < 2 || text.length > 80) return null;
  try {
    const { model, modelId } = await resolveModel("utility");
    const res = await generateText({
      model,
      instructions:
        "Map the user's text (a city, country, region, abbreviation or UTC offset) to the single best IANA timezone name. If it is ambiguous or not a place, return null.",
      prompt: text,
      output: Output.object({ schema: z.object({ timezone: z.string().nullable() }) }),
      timeout: { totalMs: 12_000 },
      maxRetries: 0,
    });
    void recordUsage({ userId: null, modelId, purpose: "utility", inputTokens: res.totalUsage?.inputTokens, outputTokens: res.totalUsage?.outputTokens });
    const tz = res.output.timezone;
    return tz && isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}
