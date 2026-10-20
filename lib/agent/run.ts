import {
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  ToolChoiceViolationError,
  toUIMessageStream,
  type ModelMessage,
} from "ai";

import { formatForChannel, type Channel } from "./channel";
import { isRateLimit, recordUsage, resolveModel } from "./models";
import { buildInstructions } from "./prompt";
import { createTools, type ToolContext } from "./tools";
import { recentMessages, saveMessage } from "@/lib/data/messages";
import { timesheetDigest } from "@/lib/data/timesheets";
import type { User } from "@/lib/db/schema";

const HISTORY = 14;
const MAX_STEPS = 8;

/**
 * Messages that ask about or change timesheet data. For these the first step MUST be a tool call:
 * a model that is free to answer directly will sometimes just say "done" without doing anything.
 */
const DATA_INTENT =
  /\b(log|logged|add|put|enter|record|change|fix|update|edit|set|mark|delete|remove|correct|export|send|pdf|excel|xlsx|download|file|how many|how much|count|total|sum|show|list|what|which|when|leave|leaves|holiday|hours?|sheet|tab|timesheet|worked|entries|entry|summary|report|today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export const needsTool = (text: string) => DATA_INTENT.test(text);

export interface TurnInput {
  user: User;
  channel: Channel;
  externalId?: string;
  text: string;
}

async function prepare({ user, channel, externalId, text }: TurnInput) {
  const [digest, history, { model, modelId }] = await Promise.all([
    timesheetDigest(user.id),
    recentMessages(user.id, HISTORY),
    resolveModel("chat"),
  ]);
  const files: ToolContext["files"] = [];
  const tools = createTools({ userId: user.id, userName: user.name, channel, externalId, timezone: user.timezone, files });
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.files.length ? `${m.text}\n(Attached: ${m.files.map((f) => f.filename).join(", ")})` : m.text }) as ModelMessage),
    { role: "user", content: text },
  ];
  await saveMessage(user.id, channel, "user", text);
  return { model, modelId, tools, files, messages, forceTool: needsTool(text), instructions: buildInstructions({ user, channel, digest }) };
}

const RATE_LIMITED = "I'm getting a lot of requests right now. Please try again in a minute.";
const FAILED = "Sorry, something went wrong on my side. Please try again.";

/** Non-streaming turn for messenger channels (Telegram, later WhatsApp). */
export async function runTurn(input: TurnInput): Promise<{ text: string; files: ToolContext["files"] }> {
  const p = await prepare(input);
  const generate = (force: boolean) =>
    generateText({
      model: p.model,
      instructions: p.instructions,
      messages: p.messages,
      tools: p.tools,
      stopWhen: isStepCount(MAX_STEPS),
      prepareStep: ({ stepNumber }) => (stepNumber === 0 && force ? { toolChoice: "required" as const } : undefined),
      timeout: { totalMs: 50_000 },
      maxRetries: 1,
    });
  try {
    // A provider that ignores "tool required" must not take the whole turn down: ask again freely.
    const res = await generate(p.forceTool).catch((e) => (ToolChoiceViolationError.isInstance(e) ? generate(false) : Promise.reject(e)));
    void recordUsage({
      userId: input.user.id,
      modelId: p.modelId,
      purpose: "chat",
      inputTokens: res.totalUsage?.inputTokens,
      outputTokens: res.totalUsage?.outputTokens,
    });
    const raw = res.text.trim() || (p.files.length ? "Here is your file." : "Done.");
    const text = formatForChannel(raw, input.channel);
    await saveMessage(input.user.id, input.channel, "assistant", text, p.files);
    return { text, files: p.files };
  } catch (e) {
    console.error("agent turn failed", e);
    return { text: isRateLimit(e) ? RATE_LIMITED : FAILED, files: p.files };
  }
}

/** Streaming turn for the web chat. Returns a UI-message-stream Response for useChat. */
export async function streamTurn(input: TurnInput): Promise<Response> {
  const p = await prepare(input);
  const result = streamText({
    model: p.model,
    instructions: p.instructions,
    messages: p.messages,
    tools: p.tools,
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => (stepNumber === 0 && p.forceTool ? { toolChoice: "required" as const } : undefined),
    timeout: { totalMs: 55_000 },
    maxRetries: 1,
    onEnd: async (event) => {
      const last = [...event.steps].reverse().find((s) => s.text.trim());
      const text = (last?.text ?? event.text ?? "").trim();
      await saveMessage(input.user.id, input.channel, "assistant", text, p.files);
      void recordUsage({
        userId: input.user.id,
        modelId: p.modelId,
        purpose: "chat",
        inputTokens: event.totalUsage?.inputTokens,
        outputTokens: event.totalUsage?.outputTokens,
      });
    },
    onError: ({ error }) => console.error("stream failed", error),
  });
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => (isRateLimit(error) ? RATE_LIMITED : FAILED),
    }),
  });
}
