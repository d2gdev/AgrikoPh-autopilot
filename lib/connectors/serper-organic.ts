import { getOptionalSecret } from "@/lib/config/resolver";

export type SerperOrganicDevice = "desktop" | "mobile";

export interface SerperOrganicInput {
  query: string;
  location?: string | null;
  countryCode?: string | null;
  languageCode?: string | null;
  device?: SerperOrganicDevice;
  limit?: number;
}

export interface SerperOrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string | null;
  rawPayload: Record<string, unknown>;
}

const SEARCH_URL = "https://google.serper.dev/search";

async function getSerperApiKey() {
  return await getOptionalSecret("SERPER_API_KEY")
    ?? await getOptionalSecret("SERPER_DEV_API_KEY")
    ?? await getOptionalSecret("SERPER_KEY")
    ?? await getOptionalSecret("GOOGLE_SERPER_API_KEY")
    ?? "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function result(value: unknown, index: number): SerperOrganicResult | null {
  const item = record(value);
  if (typeof item.title !== "string" || typeof item.link !== "string") return null;
  return {
    position: typeof item.position === "number" ? item.position : index + 1,
    title: item.title,
    link: item.link,
    snippet: typeof item.snippet === "string" ? item.snippet : null,
    rawPayload: item,
  };
}

export async function fetchSerperOrganicResults(input: SerperOrganicInput): Promise<{
  disabled?: boolean;
  results: SerperOrganicResult[];
}> {
  const apiKey = await getSerperApiKey();
  if (!apiKey) return { disabled: true, results: [] };

  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      q: input.query,
      ...(input.location ? { location: input.location } : {}),
      gl: input.countryCode ?? "ph",
      hl: input.languageCode ?? "en",
      num: limit,
      device: input.device ?? "desktop",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  const payload = text ? record(JSON.parse(text)) : {};
  if (!response.ok) {
    if ([401, 402, 403, 429].includes(response.status)) return { disabled: true, results: [] };
    throw new Error(`Serper Organic error ${response.status}: ${String(payload.message ?? text).slice(0, 500)}`);
  }

  const organic = Array.isArray(payload.organic) ? payload.organic : [];
  return {
    results: organic.map(result).filter((item): item is SerperOrganicResult => item !== null),
  };
}
