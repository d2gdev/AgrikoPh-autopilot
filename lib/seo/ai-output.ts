import { z } from "zod";

export type AiStructuredParse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "empty" | "invalid-json" | "invalid-schema" };

function parse<T>(text: string, schema: z.ZodType<T>, open: string, close: string): AiStructuredParse<T> {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: "empty" };
  const start = raw.indexOf(open);
  if (start < 0) return { ok: false, reason: "invalid-json" };
  let depth = 0, end = -1, quoted = false, escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) { end = i; break; }
  }
  if (end < 0) return { ok: false, reason: "invalid-json" };
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return { ok: false, reason: "invalid-json" }; }
  const result = schema.safeParse(value);
  return result.success ? { ok: true, data: result.data } : { ok: false, reason: "invalid-schema" };
}
export function parseJsonObject<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "{", "}"); }
export function parseJsonArray<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "[", "]"); }
