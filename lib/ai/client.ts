import OpenAI from "openai";
import { getOptionalSecret } from "@/lib/config/resolver";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

export interface AiClientOptions {
  deepseekModel?: string;
  openRouterModel?: string;
}

export async function getAiClient(options: AiClientOptions = {}) {
  const [
    deepseekApiKey,
    openRouterApiKey,
    deepseekModel,
    openRouterModel,
  ] = await Promise.all([
    getOptionalSecret("DEEPSEEK_API_KEY"),
    getOptionalSecret("OPENROUTER_API_KEY"),
    getOptionalSecret("DEEPSEEK_MODEL"),
    getOptionalSecret("OPENROUTER_MODEL"),
  ]);

  if (deepseekApiKey) {
    return {
      provider: "deepseek" as const,
      model: deepseekModel ?? options.deepseekModel ?? DEFAULT_DEEPSEEK_MODEL,
      client: new OpenAI({
        baseURL: "https://api.deepseek.com/v1",
        apiKey: deepseekApiKey,
        // DeepSeek occasionally resets the socket mid-response (ECONNRESET) on
        // long narrative prompts; retry transient connection errors with backoff.
        maxRetries: 5,
      }),
    };
  }

  if (openRouterApiKey) {
    return {
      provider: "openrouter" as const,
      model: openRouterModel ?? options.openRouterModel ?? DEFAULT_OPENROUTER_MODEL,
      client: new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: openRouterApiKey,
        maxRetries: 5,
        defaultHeaders: {
          "HTTP-Referer": "https://agrikoph.com",
          "X-Title": "Agriko Autopilot",
        },
      }),
    };
  }

  throw new Error("No AI provider configured: set DEEPSEEK_API_KEY or OPENROUTER_API_KEY");
}
