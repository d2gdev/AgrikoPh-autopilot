import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: (...args: unknown[]) => createMock(...args) } };
  },
}));

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(async (key: string) => {
    if (key === "DEEPSEEK_API_KEY") return "dk-key";
    if (key === "OPENROUTER_API_KEY") return "or-key";
    return null; // models unset -> defaults
  }),
}));

import { chatCompletionWithFailover, isConnectionError } from "@/lib/ai/client";

function econnreset() {
  const e = new Error("Invalid response body while trying to fetch https://api.deepseek.com/v1/chat/completions: read ECONNRESET");
  (e as unknown as { code: string }).code = "ECONNRESET";
  return e;
}

beforeEach(() => {
  createMock.mockReset();
});

describe("isConnectionError", () => {
  it("matches ECONNRESET / mid-body read failures / timeouts", () => {
    expect(isConnectionError(econnreset())).toBe(true);
    expect(isConnectionError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isConnectionError(new Error("socket hang up"))).toBe(true);
    expect(isConnectionError(new Error("fetch failed"))).toBe(true);
  });
  it("does NOT match application/HTTP errors", () => {
    expect(isConnectionError(new Error("400 Bad Request: invalid schema"))).toBe(false);
    expect(isConnectionError(new Error("401 Authentication Fails"))).toBe(false);
  });
});

describe("chatCompletionWithFailover", () => {
  it("returns the primary (DeepSeek) result when it succeeds", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "FROM_DEEPSEEK" } }] });
    const r = await chatCompletionWithFailover({ messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("FROM_DEEPSEEK");
    expect(r.provider).toBe("deepseek");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("fails over to OpenRouter on a DeepSeek connection reset", async () => {
    createMock
      .mockImplementationOnce(() => { throw econnreset(); })
      .mockResolvedValueOnce({ choices: [{ message: { content: "FROM_OPENROUTER" } }] });
    const r = await chatCompletionWithFailover({ messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("FROM_OPENROUTER");
    expect(r.provider).toBe("openrouter");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT fail over on a non-connection error (rethrows)", async () => {
    createMock.mockImplementationOnce(() => { throw new Error("400 Bad Request"); });
    await expect(chatCompletionWithFailover({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("400 Bad Request");
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
