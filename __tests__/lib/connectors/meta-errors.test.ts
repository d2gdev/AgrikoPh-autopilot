import { describe, expect, it } from "vitest";
import { classifyMetaError, parseMetaApiError, serializableMetaError } from "@/lib/connectors/meta-errors";

describe("Meta API errors", () => {
  it("preserves structured Graph API fields", () => {
    const err = parseMetaApiError(400, JSON.stringify({
      error: {
        message: "Permissions error",
        type: "OAuthException",
        code: 200,
        error_subcode: 2490592,
        is_transient: false,
        fbtrace_id: "trace-1",
      },
    }));

    expect(err.code).toBe(200);
    expect(err.subcode).toBe(2490592);
    expect(err.isTransient).toBe(false);
    expect(err.fbtraceId).toBe("trace-1");
    expect(classifyMetaError(err)).toBe("global");
    expect(serializableMetaError(err)).toMatchObject({
      code: 200,
      subcode: 2490592,
      scope: "global",
    });
  });

  it("classifies rate limits and transient errors as transient", () => {
    expect(classifyMetaError(parseMetaApiError(400, JSON.stringify({
      error: { message: "Rate limit", code: 613, is_transient: false },
    })))).toBe("transient");

    expect(classifyMetaError(parseMetaApiError(503, JSON.stringify({
      error: { message: "Try later", is_transient: true },
    })))).toBe("transient");
  });
});
