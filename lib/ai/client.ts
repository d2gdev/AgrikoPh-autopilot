import OpenAI from "openai";
import { getOptionalSecret } from "@/lib/config/resolver";

// deepseek-v4-flash returns HTTP 200 with EMPTY content (not a valid served
// model), which silently breaks every JSON-parsing AI feature. deepseek-chat
// is the stable alias that actually returns content.
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat";

export interface AiClientOptions {
  deepseekModel?: string;
  openRouterModel?: string;
}

export type AiProvider = "deepseek" | "openrouter";

export interface ResolvedAiClient {
  provider: AiProvider;
  model: string;
  client: OpenAI;
}

async function buildClient(provider: AiProvider, options: AiClientOptions): Promise<ResolvedAiClient | null> {
  if (provider === "deepseek") {
    const [key, model] = await Promise.all([
      getOptionalSecret("DEEPSEEK_API_KEY"),
      getOptionalSecret("DEEPSEEK_MODEL"),
    ]);
    if (!key) return null;
    return {
      provider,
      model: model ?? options.deepseekModel ?? DEFAULT_DEEPSEEK_MODEL,
      client: new OpenAI({
        baseURL: "https://api.deepseek.com/v1",
        apiKey: key,
        // DeepSeek occasionally resets the socket mid-response (ECONNRESET) on
        // long narrative prompts; retry transient connection errors with backoff.
        // A persistent reset falls over to OpenRouter (see chatCompletionWithFailover).
        maxRetries: 5,
        timeout: 90_000,
      }),
    };
  }

  const [key, model] = await Promise.all([
    getOptionalSecret("OPENROUTER_API_KEY"),
    getOptionalSecret("OPENROUTER_MODEL"),
  ]);
  if (!key) return null;
  return {
    provider,
    model: model ?? options.openRouterModel ?? DEFAULT_OPENROUTER_MODEL,
    client: new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: key,
      maxRetries: 5,
      timeout: 90_000,
      defaultHeaders: {
        "HTTP-Referer": "https://agrikoph.com",
        "X-Title": "Agriko Autopilot",
      },
    }),
  };
}

export async function getAiClient(options: AiClientOptions = {}): Promise<ResolvedAiClient> {
  const deepseek = await buildClient("deepseek", options);
  if (deepseek) return deepseek;
  const openrouter = await buildClient("openrouter", options);
  if (openrouter) return openrouter;
  throw new Error("No AI provider configured: set DEEPSEEK_API_KEY or OPENROUTER_API_KEY");
}

/**
 * True for connection-level failures (not HTTP/application errors): socket
 * resets, timeouts, DNS, and undici's "Invalid response body … read ECONNRESET"
 * which fires when the peer drops the connection mid-response body.
 */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } } | null;
  const code = e?.code ?? e?.cause?.code ?? "";
  const msg = e?.message ?? String(err);
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|UND_ERR/i.test(code)) return true;
  return /ECONNRESET|Invalid response body|socket hang up|terminated|Connection error|fetch failed|network|timed out/i.test(msg);
}

function extractContent(res: OpenAI.Chat.ChatCompletion): string {
  const msg = res.choices?.[0]?.message as Record<string, unknown> | undefined;
  // Reasoning models put the answer in reasoning_content; chat models in content.
  return ((msg?.content as string) || (msg?.reasoning_content as string) || "").trim();
}

/**
 * Chat completion that fails over to the OTHER provider on a connection-level
 * error. DeepSeek intermittently resets the socket mid-response from this host,
 * and even the SDK's request retries can't recover a mid-body reset; OpenRouter
 * reaches the same models over a different network path. Returns message content
 * directly. Non-connection errors (bad request, auth, etc.) are NOT failed over.
 *
 * `requestOptions` (e.g. an AbortSignal) is forwarded to both attempts. Because
 * a mid-body ECONNRESET fails fast, a shared timeout signal usually still has
 * budget left for the failover attempt.
 */
export async function chatCompletionWithFailover(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">,
  options: AiClientOptions & { requestOptions?: OpenAI.RequestOptions } = {},
): Promise<{ content: string; provider: AiProvider; model: string }> {
  const { requestOptions, ...clientOptions } = options;
  const primary = await getAiClient(clientOptions);
  try {
    const res = await primary.client.chat.completions.create({ ...params, model: primary.model }, requestOptions);
    return { content: extractContent(res), provider: primary.provider, model: primary.model };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const otherProvider: AiProvider = primary.provider === "deepseek" ? "openrouter" : "deepseek";
    const fallback = await buildClient(otherProvider, clientOptions);
    if (!fallback) throw err;
    console.warn(`[ai] ${primary.provider} connection error (${err instanceof Error ? err.message : err}); failing over to ${fallback.provider}`);
    const res = await fallback.client.chat.completions.create({ ...params, model: fallback.model }, requestOptions);
    return { content: extractContent(res), provider: fallback.provider, model: fallback.model };
  }
}
