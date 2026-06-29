import { loadServiceAccountJson } from "@/lib/service-account";
import { getOptionalSecret, getSecret } from "@/lib/config/resolver";

// Ported from cinema/shopify-theme/scripts/ga4-analysis.mjs
// Uses JWT service account auth

async function getAuth(): Promise<import("google-auth-library").GoogleAuth> {
  const { GoogleAuth } = await import("google-auth-library");
  return new GoogleAuth({
    credentials: loadServiceAccountJson(
      await getOptionalSecret("GA4_SERVICE_ACCOUNT_JSON") ?? undefined,
      await getOptionalSecret("GA4_SERVICE_ACCOUNT_JSON_PATH") ?? undefined,
      "GA4"
    ),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

async function getAccessToken(): Promise<string> {
  const auth = await getAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("GA4: failed to obtain access token from service account");
  return token.token;
}

export async function fetchGa4Data(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const propertyId = await getSecret("GA4_PROPERTY_ID");
  const limit = Math.max(1, Number(process.env.GA4_PAGE_LIMIT ?? 1000));

  const since = opts.start.toISOString().split("T")[0];
  const until = opts.end.toISOString().split("T")[0];

  const body = {
    dateRanges: [{ startDate: since, endDate: until }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "sessions" },
      { name: "bounceRate" },
      { name: "conversions" },
      { name: "totalUsers" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  };

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) throw new Error(`GA4 API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;

  const rows = data.rows as Array<Record<string, unknown>> ?? [];
  const topPages = rows.map((row) => {
    const dims = row.dimensionValues as Array<{ value: string }>;
    const mets = row.metricValues as Array<{ value: string }>;
    const sessions = parseInt(mets[0]?.value ?? "0");
    const conversions = parseInt(mets[2]?.value ?? "0");
    const totalUsers = parseInt(mets[3]?.value ?? "0");
    return {
      page: dims[0]?.value ?? "unknown",
      sessions,
      totalUsers,
      conversions,
      bounceRate: `${(parseFloat(mets[1]?.value ?? "0") * 100).toFixed(1)}%`,
      conversionRate: sessions > 0 ? `${((conversions / sessions) * 100).toFixed(2)}%` : "0%",
    };
  });

  return { topPages, fetchedAt: new Date().toISOString() };
}
