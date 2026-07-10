import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonArray, parseJsonObject } from "@/lib/seo/ai-output";
const obj = z.object({ quickWins: z.array(z.string()) });
const arr = z.array(z.object({ title: z.string() }));
describe("AI structured output", () => {
  it("parses plain and fenced/reasoning objects", () => {
    expect(parseJsonObject('{"quickWins":["x"]}', obj).ok).toBe(true);
    expect(parseJsonObject('reasoning... ```json\n{"quickWins":["x"]}\n``` trailing', obj).ok).toBe(true);
  });
  it("parses arrays and first balanced candidate", () => {
    expect(parseJsonArray('```json\n[{"title":"x"}]\n```', arr).ok).toBe(true);
    expect(parseJsonObject('preamble {"quickWins":["}"]} then {"quickWins":[]}', obj)).toEqual({ ok: true, data: { quickWins: ["}"] } });
  });
  it("returns typed failures", () => {
    expect(parseJsonObject("", obj)).toEqual({ ok: false, reason: "empty" });
    expect(parseJsonObject("reasoning only", obj)).toEqual({ ok: false, reason: "invalid-json" });
    expect(parseJsonObject('{"quickWins":42}', obj)).toEqual({ ok: false, reason: "invalid-schema" });
    expect(parseJsonArray("[bad]", arr)).toEqual({ ok: false, reason: "invalid-json" });
  });
});
