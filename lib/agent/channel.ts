export type Channel = "web" | "telegram" | "whatsapp";

/**
 * The agent is told which surface it is writing for, so it can format natively.
 * stripMarkdown / formatForChannel are the safety net for models that ignore the instruction.
 */
export const CHANNEL_STYLE: Record<Channel, string> = {
  web: [
    "You are replying in the Qorlog web chat, which renders GitHub-flavoured Markdown.",
    "Use Markdown where it helps: short headings only for long answers, bullet lists, **bold** for key facts, tables for comparisons, fenced code blocks for code.",
    "Keep replies compact. Never paste raw spreadsheet dumps; summarise them.",
  ].join(" "),
  telegram: [
    "You are replying inside Telegram as PLAIN TEXT. Telegram will NOT render Markdown here.",
    "Never use *, _, #, backticks, pipes or tables. Use short paragraphs, simple hyphen lists (\"- item\"), and at most an occasional emoji.",
    "Describe tabular data as one line per row. Keep replies under about 900 characters unless the user asked for detail.",
    "Never paste file contents; if the user wants a file, use the export tool and say it is attached.",
  ].join(" "),
  whatsapp: [
    "You are replying inside WhatsApp. It supports only *bold*, _italic_ and simple hyphen lists. No headings, no tables, no code blocks.",
    "Keep replies short and conversational. If the user wants a file, use the export tool.",
  ].join(" "),
};

export function stripMarkdown(input: string): string {
  let s = input.replace(/\r\n/g, "\n");

  // code fences: drop the fence lines, keep the code
  s = s.replace(/^```[^\n]*\n?/gm, "").replace(/```/g, "");

  // tables: drop separator rows, turn rows into "a - b - c"
  s = s
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) || !l.includes("|"))
    .map((l) => {
      if (/^\s*\|.*\|\s*$/.test(l)) {
        return l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" - ");
      }
      return l;
    })
    .join("\n");

  s = s
    .replace(/^\s{0,3}#{1,6}\s*/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "") // horizontal rules
    .replace(/^(\s*)[*+]\s+/gm, "$1- ") // bullets -> hyphen
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)") // images
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // links
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** WhatsApp flavour: keep light emphasis, drop everything else. */
export function toWhatsApp(input: string): string {
  const withBold = input.replace(/\*\*([^*\n]+)\*\*/g, "\u0001$1\u0001");
  return stripMarkdown(withBold).replace(/\u0001([^\u0001]+)\u0001/g, "*$1*");
}

export function formatForChannel(text: string, channel: Channel): string {
  if (channel === "web") return text;
  if (channel === "whatsapp") return toWhatsApp(text);
  return stripMarkdown(text);
}

/** Telegram caps messages at 4096 characters. */
export function chunkText(text: string, size = 3800): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut <= 0) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
