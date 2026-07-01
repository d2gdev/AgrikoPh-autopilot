import { getOptionalSecret } from "@/lib/config/resolver";

// DataForSEO Google Ads "search volume" (live/synchronous) — monthly searches
// per keyword. Bulk: up to ~1000 keywords in one metered call.
const SEARCH_VOLUME_URL = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";

export interface SearchVolumeResult {
  /** True when credentials are missing or the account is out of quota — the
   *  caller should skip silently, never surface an error to the page. */
  disabled?: boolean;
  /** normalized (trim + lowercase) keyword → monthly search volume */
  volumes: Map<string, number>;
}

export function isDataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

async function authHeader(): Promise<string | null> {
  const login = (await getOptionalSecret("DATAFORSEO_LOGIN")) ?? "";
  const password = (await getOptionalSecret("DATAFORSEO_PASSWORD")) ?? "";
  if (!login || !password) return null;
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Fetch monthly search volume for a set of keywords in one bulk call.
 * Returns a normalized keyword → volume map. Degrades to `disabled` (never
 * throws) on missing credentials or quota/auth/rate-limit statuses, so a caller
 * populating a cache can skip cleanly. Caps at 1000 keywords per call.
 */
export async function fetchSearchVolume(
  keywords: string[],
  opts: { locationName?: string; languageCode?: string } = {},
): Promise<SearchVolumeResult> {
  const auth = await authHeader();
  if (!auth) return { disabled: true, volumes: new Map() };

  const cleaned = Array.from(
    new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0)),
  ).slice(0, 1000);
  if (cleaned.length === 0) return { volumes: new Map() };

  const body = [{
    keywords: cleaned,
    location_name: opts.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
    language_code: opts.languageCode ?? "en",
  }];

  const res = await fetch(SEARCH_VOLUME_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    // Quota/credit/auth/rate-limit → degrade so the cache-fill step skips
    // silently instead of failing the whole GSC job.
    if ([401, 402, 403, 429].includes(res.status)) return { disabled: true, volumes: new Map() };
    throw new Error(`DataForSEO search_volume error ${res.status}: ${String(payload.status_message ?? text).slice(0, 500)}`);
  }

  const volumes = new Map<string, number>();
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  for (const task of tasks) {
    const results = Array.isArray(asRecord(task).result) ? (asRecord(task).result as unknown[]) : [];
    for (const item of results) {
      const record = asRecord(item);
      const keyword = typeof record.keyword === "string" ? record.keyword.trim().toLowerCase() : null;
      const volume = typeof record.search_volume === "number" && Number.isFinite(record.search_volume)
        ? record.search_volume
        : null;
      if (keyword && volume != null) volumes.set(keyword, volume);
    }
  }
  return { volumes };
}
