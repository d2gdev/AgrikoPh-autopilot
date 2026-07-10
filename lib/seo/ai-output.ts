import { z } from "zod";

export type AiStructuredParse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "empty" | "invalid-json" | "invalid-schema" };

function parse<T>(text: string, schema: z.ZodType<T>, open: string, close: string): AiStructuredParse<T> {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: "empty" };
  let sawSchemaInvalid = false;
  for (let start = raw.indexOf(open); start >= 0; start = raw.indexOf(open, start + 1)) {
    let depth = 0, end = -1, quoted = false, escaped = false;
    for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    let value: unknown;
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch { continue; }
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, data: result.data };
    sawSchemaInvalid = true;
  }
  return { ok: false, reason: sawSchemaInvalid ? "invalid-schema" : "invalid-json" };
}
export function parseJsonObject<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "{", "}"); }
export function parseJsonArray<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "[", "]"); }
