import { loadServiceAccountJson } from "@/lib/service-account";
import { getOptionalSecret, getSecret } from "@/lib/config/resolver";
import type { GscPropertyTotals } from "@/lib/seo/types";

export type { GscPropertyTotals } from "@/lib/seo/types";

// Ported from cinema/shopify-theme/scripts/gsc-analysis.mjs
// Uses JWT service account auth

const GSC_READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";

async function getAuth(
  scopes: string[] = [GSC_READ_SCOPE],
): Promise<import("google-auth-library").GoogleAuth> {
  const { GoogleAuth } = await import("google-auth-library");
  return new GoogleAuth({
    credentials: loadServiceAccountJson(
      await getOptionalSecret("GSC_SERVICE_ACCOUNT_JSON") ?? undefined,
      await getOptionalSecret("GSC_SERVICE_ACCOUNT_JSON_PATH") ?? undefined,
      "GSC"
    ),
    scopes,
  });
}

async function getAccessToken(scopes?: string[]): Promise<string> {
  const auth = await getAuth(scopes);
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("GSC: failed to obtain access token from service account");
  return token.token;
}

export async function submitGscSitemap(
  sitemapUrl: string,
): Promise<{ siteUrl: string; sitemapUrl: string; submitted: true }> {
  const parsed = new URL(sitemapUrl);
  if (parsed.protocol !== "https:" || !parsed.pathname.endsWith(".xml")) {
    throw new Error("GSC sitemap URL must be an HTTPS XML URL");
  }
  const token = await getAccessToken([GSC_WRITE_SCOPE]);
  const siteUrl = await getSecret("GSC_SITE_URL");
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`GSC sitemap API error ${res.status}`);
  return { siteUrl, sitemapUrl, submitted: true };
}

export async function listGscSitemaps(): Promise<Array<Record<string, unknown>>> {
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`GSC sitemap API error ${res.status}`);
  const data = await res.json() as { sitemap?: Array<Record<string, unknown>> };
  return Array.isArray(data.sitemap) ? data.sitemap : [];
}

export type GscPageMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  avgPosition: number | null;
};

export async function fetchGscPropertyTotals(opts: {
  start: Date;
  end: Date;
}): Promise<GscPropertyTotals | null> {
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");
  const body = {
    startDate: opts.start.toISOString().split("T")[0],
    endDate: opts.end.toISOString().split("T")[0],
    dataState: "final",
    rowLimit: 1,
  };
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`GSC API error ${res.status}`);

  const data = await res.json() as { rows?: Array<Record<string, unknown>> };
  const row = data.rows?.[0];
  if (!row) return null;
  return {
    clicks: Number(row.clicks ?? 0),
    impressions: Number(row.impressions ?? 0),
    avgCtr: Number(row.ctr ?? 0),
    avgPosition: Number(row.position ?? 0),
  };
}

export async function fetchGscPageMetrics(input: {
  startDate: string;
  endDate: string;
  pageUrl: string;
}): Promise<GscPageMetrics | null> {
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");
  const body = {
    startDate: input.startDate,
    endDate: input.endDate,
    dataState: "final",
    aggregationType: "byPage",
    dimensionFilterGroups: [{
      groupType: "and",
      filters: [{ dimension: "page", operator: "equals", expression: input.pageUrl }],
    }],
    rowLimit: 1,
  };

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`GSC API error ${res.status}`);

  const data = await res.json() as { rows?: Array<Record<string, unknown>> };
  const row = data.rows?.[0];
  if (!row) return null;
  return {
    clicks: Number(row.clicks ?? 0),
    impressions: Number(row.impressions ?? 0),
    ctr: typeof row.ctr === "number" ? row.ctr : null,
    avgPosition: typeof row.position === "number" ? row.position : null,
  };
}

export async function fetchGscData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  const propertyTotals = await fetchGscPropertyTotals(opts);
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");

  const since = opts.start.toISOString().split("T")[0];
  const until = opts.end.toISOString().split("T")[0];

  const body = {
    startDate: since,
    endDate: until,
    dataState: "final",
    dimensions: ["query"],
    rowLimit: 25000, // API maximum — fetch as many rows as possible per request
    orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
  };

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) throw new Error(`GSC API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;

  const topQueries = ((data.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    query: (row.keys as string[])?.[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: `${(((row.ctr as number) ?? 0) * 100).toFixed(1)}%`,
    position: ((row.position as number) ?? 0).toFixed(1),
  }));

  return { topQueries, propertyTotals, fetchedAt: new Date().toISOString() };
}

export async function fetchGscPageData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");

  const since = opts.start.toISOString().split("T")[0];
  const until = opts.end.toISOString().split("T")[0];

  const body = {
    startDate: since,
    endDate: until,
    dimensions: ["page"],
    rowLimit: 1000,
    orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
  };

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) throw new Error(`GSC API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;

  const topPages = ((data.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    page: (row.keys as string[])?.[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: `${(((row.ctr as number) ?? 0) * 100).toFixed(1)}%`,
    position: ((row.position as number) ?? 0).toFixed(1),
  }));

  return { topPages, fetchedAt: new Date().toISOString() };
}

export async function fetchGscQueryPageData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const siteUrl = await getSecret("GSC_SITE_URL");

  const since = opts.start.toISOString().split("T")[0];
  const until = opts.end.toISOString().split("T")[0];

  const body = {
    startDate: since,
    endDate: until,
    dimensions: ["query", "page"],
    rowLimit: 25000,
    orderBy: [{ fieldName: "impressions", sortOrder: "DESCENDING" }],
  };

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) throw new Error(`GSC API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;

  const pairs = ((data.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    query: (row.keys as string[])?.[0] ?? "",
    page: (row.keys as string[])?.[1] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    position: ((row.position as number) ?? 0).toFixed(1),
  }));

  return { pairs, fetchedAt: new Date().toISOString() };
}
