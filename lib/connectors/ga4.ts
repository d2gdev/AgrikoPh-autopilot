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

  const dateRanges = [{ startDate: since, endDate: until }];
  const body = {
    requests: [
      {
        dateRanges,
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "totalUsers" },
          { name: "purchaseRevenue" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit,
      },
      {
        dateRanges,
        dimensions: [{ name: "pagePath" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
            },
          },
        },
        limit: limit * 4,
      },
    ],
  };

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) throw new Error(`GA4 API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    reports?: Array<{
      rows?: Array<{
        dimensionValues?: Array<{ value?: string }>;
        metricValues?: Array<{ value?: string }>;
      }>;
    }>;
  };

  const rows = data.reports?.[0]?.rows ?? [];
  const funnelByPage = new Map<string, Record<string, number>>();
  for (const row of data.reports?.[1]?.rows ?? []) {
    const page = row.dimensionValues?.[0]?.value ?? "unknown";
    const eventName = row.dimensionValues?.[1]?.value;
    if (!eventName) continue;
    const events = funnelByPage.get(page) ?? {};
    events[eventName] = parseInt(row.metricValues?.[0]?.value ?? "0");
    funnelByPage.set(page, events);
  }

  const topPages = rows.map((row) => {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const page = dims[0]?.value ?? "unknown";
    const events = funnelByPage.get(page) ?? {};
    const sessions = parseInt(mets[0]?.value ?? "0");
    const totalUsers = parseInt(mets[2]?.value ?? "0");
    const purchases = events.purchase ?? 0;
    return {
      page,
      sessions,
      totalUsers,
      conversions: purchases,
      viewItem: events.view_item ?? 0,
      addToCart: events.add_to_cart ?? 0,
      beginCheckout: events.begin_checkout ?? 0,
      purchases,
      revenue: parseFloat(mets[3]?.value ?? "0"),
      bounceRate: `${(parseFloat(mets[1]?.value ?? "0") * 100).toFixed(1)}%`,
      conversionRate: sessions > 0 ? `${((purchases / sessions) * 100).toFixed(2)}%` : "0%",
    };
  });

  return { topPages, fetchedAt: new Date().toISOString() };
}
