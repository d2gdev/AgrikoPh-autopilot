import { z } from "zod";

export type AiStructuredParse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "empty" | "invalid-json" | "invalid-schema" };

function parse<T>(text: string, schema: z.ZodType<T>, open: string, close: string): AiStructuredParse<T> {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: "empty" };
  const start = raw.indexOf(open);
  const end = raw.lastIndexOf(close);
  if (start < 0 || end <= start) return { ok: false, reason: "invalid-json" };
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return { ok: false, reason: "invalid-json" }; }
  const result = schema.safeParse(value);
  return result.success ? { ok: true, data: result.data } : { ok: false, reason: "invalid-schema" };
}
export function parseJsonObject<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "{", "}"); }
export function parseJsonArray<T>(text: string, schema: z.ZodType<T>): AiStructuredParse<T> { return parse(text, schema, "[", "]"); }
