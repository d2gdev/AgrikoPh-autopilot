import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function OpenAIMock(config) {
    return { config };
  }),
}));

vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: vi.fn(),
}));

import { getOptionalSecret } from "@/lib/config/resolver";
import OpenAI from "openai";
import { getAiClient } from "@/lib/ai/client";

const mockGetOptionalSecret = vi.mocked(getOptionalSecret);

function mockSecrets(values: Record<string, string | null>) {
  mockGetOptionalSecret.mockImplementation(async (key: string) => values[key] ?? null);
}

describe("getAiClient", () => {
  beforeEach(() => {
    mockGetOptionalSecret.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers DeepSeek when both providers are configured", async () => {
    mockSecrets({
      DEEPSEEK_API_KEY: "deepseek-key",
      OPENROUTER_API_KEY: "openrouter-key",
      DEEPSEEK_MODEL: "deepseek-custom",
      OPENROUTER_MODEL: "openrouter-custom",
    });

    const ai = await getAiClient();

    expect(ai.provider).toBe("deepseek");
    expect(ai.model).toBe("deepseek-custom");
    expect(vi.mocked(OpenAI).mock.calls.at(-1)?.[0]).toMatchObject({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "deepseek-key",
    });
  });

  it("falls back to OpenRouter when DeepSeek is absent", async () => {
    mockSecrets({
      OPENROUTER_API_KEY: "openrouter-key",
    });

    const ai = await getAiClient({ openRouterModel: "fallback-model" });

    expect(ai.provider).toBe("openrouter");
    expect(ai.model).toBe("fallback-model");
    expect(vi.mocked(OpenAI).mock.calls.at(-1)?.[0]).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
    });
  });

  it("throws when no provider is configured", async () => {
    mockSecrets({});

    await expect(getAiClient()).rejects.toThrow("No AI provider configured");
  });
});
