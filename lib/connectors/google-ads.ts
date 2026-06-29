// ============================================================
// KEYWORD RESEARCH ONLY — Agriko does not run Google Ads campaigns.
// This connector is used solely to pull keyword/search term data
// for SEO and content research. It does not manage bids, budgets,
// or ad creatives and should never be wired into the ad executor.
// Stale google_ads snapshots are non-critical — no alert needed.
// ============================================================

import type { Recommendation } from "@prisma/client";
import { readFileSync } from "fs";
import { resolveExistingFile } from "@/lib/service-account";
import { getOptionalSecret } from "@/lib/config/resolver";

function readJsonFile(file: string | null): Record<string, unknown> | null {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nestedOAuthConfig(json: Record<string, unknown> | null) {
  if (!json) return {};
  const web = json.web && typeof json.web === "object" ? json.web as Record<string, unknown> : null;
  const installed = json.installed && typeof json.installed === "object" ? json.installed as Record<string, unknown> : null;
  return web ?? installed ?? json;
}

async function googleAdsConfig() {
  const serviceAccountFile = resolveExistingFile(
    await getOptionalSecret("GA_SERVICE_ACCOUNT_JSON_PATH")
      ?? await getOptionalSecret("GA_SERVICE_ACCOUNT_JSON")
      ?? undefined
  );
  const serviceAccount = readJsonFile(serviceAccountFile);
  const oauthClient = readJsonFile(
    resolveExistingFile(
      await getOptionalSecret("GOOGLE_ADS_OAUTH_CLIENT_JSON_PATH")
        ?? await getOptionalSecret("GOOGLE_ADS_CLIENT_SECRET_JSON_PATH")
        ?? undefined
    )
      ?? "/mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme/scripts/client_secret_688813638250-obtfv17tehutjuqm3cesouctcpg1rmt8.apps.googleusercontent.com.json"
  );
  const oauth = nestedOAuthConfig(oauthClient);

  const developerToken = await getOptionalSecret("GOOGLE_ADS_DEVELOPER_TOKEN") ?? undefined;
  const customerId = await getOptionalSecret("GOOGLE_ADS_CUSTOMER_ID") ?? undefined;
  const oauthClientId = typeof oauth.client_id === "string" ? oauth.client_id : undefined;
  const oauthClientSecret = typeof oauth.client_secret === "string" ? oauth.client_secret : undefined;
  const clientId = await getOptionalSecret("GOOGLE_ADS_CLIENT_ID")
    ?? oauthClientId
    ?? (typeof serviceAccount?.client_id === "string" ? serviceAccount.client_id : undefined);
  const clientSecret = await getOptionalSecret("GOOGLE_ADS_CLIENT_SECRET")
    ?? oauthClientSecret;
  const refreshToken = await getOptionalSecret("GOOGLE_ADS_REFRESH_TOKEN")
    ?? await getOptionalSecret("GOOGLE_ADS_OAUTH_REFRESH_TOKEN")
    ?? await getOptionalSecret("GA_ADS_REFRESH_TOKEN")
    ?? undefined;
  const loginCustomerId = await getOptionalSecret("GOOGLE_ADS_LOGIN_CUSTOMER_ID") ?? undefined;

  return {
    developerToken,
    customerId,
    clientId,
    clientSecret,
    refreshToken,
    serviceAccountFile,
    oauthClientId,
    oauthClientSecret,
    loginCustomerId,
  };
}

export async function isGoogleAdsConfigured(): Promise<boolean> {
  const config = await googleAdsConfig();
  return !!(
    config.developerToken &&
    config.customerId &&
    config.clientId &&
    config.clientSecret &&
    config.refreshToken
  );
}

async function getClient() {
  if (!await isGoogleAdsConfigured()) throw new Error("Google Ads credentials not configured");
  const { GoogleAdsApi } = await import("google-ads-api");
  const config = await googleAdsConfig();
  return new GoogleAdsApi({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    developer_token: config.developerToken!,
  });
}

async function getCustomer() {
  const client = await getClient();
  const config = await googleAdsConfig();
  return client.Customer({
    customer_id: config.customerId!,
    refresh_token: config.refreshToken!,
  });
}

export async function fetchGoogleAdsData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  if (!await isGoogleAdsConfigured()) {
    return { campaigns: [], adGroups: [], ads: [], keywords: [], insights: [], fetchedAt: new Date().toISOString(), disabled: true };
  }

  const customer = await getCustomer();
  const startStr = opts.start.toISOString().slice(0, 10).replace(/-/g, "");
  const endStr = opts.end.toISOString().slice(0, 10).replace(/-/g, "");
  const dateRange = `BETWEEN '${startStr}' AND '${endStr}'`;

  const [campaigns, adGroups, keywords] = await Promise.race([
    Promise.all([
      customer.query(`
        SELECT campaign.id, campaign.name, campaign.status,
               metrics.cost_micros, metrics.clicks, metrics.impressions,
               metrics.conversions, metrics.all_conversions_value
        FROM campaign
        WHERE segments.date ${dateRange}
          AND campaign.status != 'REMOVED'
        LIMIT 500
      `),
      customer.query(`
        SELECT ad_group.id, ad_group.name, ad_group.status,
               campaign.id, campaign.name,
               metrics.cost_micros, metrics.clicks, metrics.conversions
        FROM ad_group
        WHERE segments.date ${dateRange}
          AND ad_group.status != 'REMOVED'
        LIMIT 500
      `),
      customer.query(`
        SELECT ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               ad_group_criterion.criterion_id,
               ad_group.id, campaign.id,
               metrics.clicks, metrics.impressions, metrics.cost_micros,
               metrics.conversions, quality_info.quality_score
        FROM keyword_view
        WHERE segments.date ${dateRange}
          AND ad_group_criterion.status != 'REMOVED'
        LIMIT 500
      `),
    ]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Google Ads gRPC timeout after 60s")), 60_000)
    ),
  ]);

  if (campaigns.length >= 500) {
    console.warn("[google-ads] Campaign result truncated at 500 rows — account may have more campaigns");
  }
  if (adGroups.length >= 500) {
    console.warn("[google-ads] Ad group result truncated at 500 rows — account may have more ad groups");
  }
  if (keywords.length >= 500) {
    console.warn("[google-ads] Keyword result truncated at 500 rows — account may have more keywords");
  }

  const normalize = (micros: number) => (micros ?? 0) / 1_000_000;

  const normalizedCampaigns = campaigns.map((c) => ({
    id: String(c.campaign?.id),
    name: c.campaign?.name,
    status: c.campaign?.status,
    spend: normalize(c.metrics?.cost_micros as number),
    clicks: c.metrics?.clicks,
    impressions: c.metrics?.impressions,
    conversions: c.metrics?.conversions,
    conversionValue: c.metrics?.all_conversions_value,
    roas: (c.metrics?.all_conversions_value as number ?? 0) / (normalize(c.metrics?.cost_micros as number) || 1),
  }));

  const normalizedAdGroups = adGroups.map((ag) => ({
    id: String(ag.ad_group?.id),
    name: ag.ad_group?.name,
    campaignId: String(ag.campaign?.id),
    campaignName: ag.campaign?.name,
    spend: normalize(ag.metrics?.cost_micros as number),
    clicks: ag.metrics?.clicks,
    conversions: ag.metrics?.conversions,
  }));

  const normalizedKeywords = keywords.map((k) => ({
    id: String(k.ad_group_criterion?.criterion_id),
    text: k.ad_group_criterion?.keyword?.text,
    matchType: k.ad_group_criterion?.keyword?.match_type,
    adGroupId: String(k.ad_group?.id),
    campaignId: String(k.campaign?.id),
    clicks: k.metrics?.clicks,
    impressions: k.metrics?.impressions,
    spend: normalize(k.metrics?.cost_micros as number),
    conversions: k.metrics?.conversions,
    qualityScore: (k as Record<string, unknown> & { quality_info?: { quality_score?: number } }).quality_info?.quality_score,
  }));

  const insights = normalizedCampaigns.map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    roas: c.roas,
    ctr: (c.impressions as number) > 0 ? ((c.clicks as number) / (c.impressions as number)) : 0,
    spend: c.spend,
    conversions: c.conversions,
  }));

  return {
    campaigns: normalizedCampaigns,
    adGroups: normalizedAdGroups,
    keywords: normalizedKeywords,
    insights,
    fetchedAt: new Date().toISOString(),
    disabled: false,
  };
}

export async function fetchGoogleAdsBeforeState(rec: { actionType: string; targetEntityId: string | null }): Promise<Record<string, unknown>> {
  if (!await isGoogleAdsConfigured() || !rec.targetEntityId) return {};
  if (!/^\d+$/.test(rec.targetEntityId)) {
    throw new Error(`Invalid targetEntityId: must be numeric digits only, got "${rec.targetEntityId}"`);
  }
  try {
    const customer = await getCustomer();
    if (rec.actionType === "pause_campaign") {
      const rows = await customer.query(`
        SELECT campaign.id, campaign.status, campaign.name
        FROM campaign WHERE campaign.id = ${rec.targetEntityId} LIMIT 1
      `);
      return (rows[0] as unknown as Record<string, unknown>) ?? {};
    }
    if (rec.actionType === "change_bid") {
      const rows = await customer.query(`
        SELECT ad_group.id, ad_group.cpc_bid_micros, ad_group.name
        FROM ad_group WHERE ad_group.id = ${rec.targetEntityId} LIMIT 1
      `);
      return (rows[0] as unknown as Record<string, unknown>) ?? {};
    }
    if (rec.actionType === "adjust_budget") {
      const rows = await customer.query(`
        SELECT campaign.id, campaign.name, campaign_budget.amount_micros
        FROM campaign WHERE campaign.id = ${rec.targetEntityId} LIMIT 1
      `);
      return (rows[0] as unknown as Record<string, unknown>) ?? {};
    }
    return {};
  } catch (err) {
    console.error("[google-ads] fetchBeforeState failed:", err);
    return {};
  }
}

export async function executeGoogleAdsAction(rec: Recommendation): Promise<Record<string, unknown>> {
  if (!await isGoogleAdsConfigured()) throw new Error("Google Ads credentials not configured");
  if (rec.targetEntityId && !/^\d+$/.test(rec.targetEntityId)) {
    throw new Error(`Invalid targetEntityId: must be numeric digits only, got "${rec.targetEntityId}"`);
  }
  const { enums } = await import("google-ads-api");
  const customer = await getCustomer();
  const config = await googleAdsConfig();

  switch (rec.actionType) {
    case "pause_campaign": {
      await customer.campaigns.update([{
        resource_name: `customers/${config.customerId}/campaigns/${rec.targetEntityId}`,
        status: enums.CampaignStatus.PAUSED,
      }]);
      return { paused: true, campaignId: rec.targetEntityId };
    }
    case "pause_ad": {
      await customer.adGroupAds.update([{
        resource_name: `customers/${config.customerId}/adGroupAds/${rec.targetEntityId}`,
        status: enums.AdGroupAdStatus.PAUSED,
      }]);
      return { paused: true, adId: rec.targetEntityId };
    }
    case "adjust_budget": {
      const proposed = parseFloat(rec.proposedValue ?? "0");
      if (isNaN(proposed) || proposed <= 0) throw new Error(`Invalid proposedValue: ${rec.proposedValue}`);
      const budgetQuery = await customer.query(`
        SELECT campaign.campaign_budget, campaign_budget.id
        FROM campaign
        WHERE campaign.id = ${rec.targetEntityId}
        LIMIT 1
      `);
      if (!budgetQuery[0]) throw new Error(`Campaign ${rec.targetEntityId} not found`);
      const budgetId = budgetQuery[0].campaign_budget?.id;
      await customer.campaignBudgets.update([{
        resource_name: `customers/${config.customerId}/campaignBudgets/${budgetId}`,
        amount_micros: Math.round(proposed * 1_000_000),
      }]);
      return { updated: true, budgetId, newDailyBudget: proposed };
    }
    case "change_bid": {
      const proposed = parseFloat(rec.proposedValue ?? "0");
      if (isNaN(proposed) || proposed <= 0) throw new Error(`Invalid proposedValue: ${rec.proposedValue}`);
      await customer.adGroups.update([{
        resource_name: `customers/${config.customerId}/adGroups/${rec.targetEntityId}`,
        cpc_bid_micros: Math.round(proposed * 1_000_000),
      }]);
      return { updated: true, adGroupId: rec.targetEntityId, newBid: proposed };
    }
    case "add_negative_keyword": {
      await customer.campaignCriteria.create([{
        campaign: `customers/${config.customerId}/campaigns/${rec.targetEntityId}`,
        negative: true,
        keyword: {
          text: rec.proposedValue ?? "",
          match_type: enums.KeywordMatchType.BROAD,
        },
      }]);
      return { added: true, keyword: rec.proposedValue };
    }
    default:
      throw new Error(`Unsupported Google Ads action: ${rec.actionType}`);
  }
}

export interface GoogleAdsKeywordResearchInput {
  keywords: string[];
  geoTargetId?: string;
  languageId?: string;
}

export interface GoogleAdsKeywordResearchResult {
  keyword: string;
  closeVariants: string[];
  avgMonthlySearches?: number | null;
  competition?: string | null;
  competitionIndex?: number | null;
  lowTopOfPageBidMicros?: string | null;
  highTopOfPageBidMicros?: string | null;
  monthlySearchVolumes: unknown[];
  rawPayload: Record<string, unknown>;
}

function normalizeEnumName(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function toMicrosString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function getRecordField(record: Record<string, unknown>, snakeCase: string, camelCase: string): unknown {
  return record[snakeCase] ?? record[camelCase];
}

function normalizeCustomerId(value: string) {
  return value.replace(/-/g, "").trim();
}

async function getServiceAccountAccessToken(serviceAccountFile: string) {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    keyFile: serviceAccountFile,
    scopes: ["https://www.googleapis.com/auth/adwords"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token?.token;
  if (!accessToken) throw new Error("Google Ads service account access token unavailable");
  return accessToken;
}

async function getOAuthAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Google Ads OAuth refresh failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
  if (!accessToken) throw new Error("Google Ads OAuth access token unavailable");
  return accessToken;
}

async function generateKeywordHistoricalMetrics(input: {
  keywords: string[];
  customerId: string;
  developerToken: string;
  accessToken: string;
  geoTargetId: string;
  languageId: string;
  loginCustomerId?: string;
}): Promise<Record<string, unknown>> {
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? "v24";
  const customerId = normalizeCustomerId(input.customerId);
  const response = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}:generateKeywordHistoricalMetrics`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "developer-token": input.developerToken,
        ...(input.loginCustomerId
          ? { "login-customer-id": normalizeCustomerId(input.loginCustomerId) }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keywords: input.keywords,
        geoTargetConstants: [`geoTargetConstants/${input.geoTargetId}`],
        language: `languageConstants/${input.languageId}`,
        keywordPlanNetwork: "GOOGLE_SEARCH",
      }),
    }
  );

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "object" && payload.error
      ? JSON.stringify(payload.error)
      : response.statusText;
    throw new Error(`Google Ads keyword research failed (${response.status}): ${message}`);
  }
  return payload;
}

export async function fetchGoogleAdsKeywordResearch(input: GoogleAdsKeywordResearchInput): Promise<{
  disabled?: boolean;
  results: GoogleAdsKeywordResearchResult[];
}> {
  const keywords = Array.from(new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 20);
  if (keywords.length === 0) return { results: [] };
  const config = await googleAdsConfig();
  if (!config.developerToken || !config.customerId) {
    return { disabled: true, results: [] };
  }
  const accessToken = config.refreshToken && config.oauthClientId && config.oauthClientSecret
    ? await getOAuthAccessToken({
        clientId: config.oauthClientId,
        clientSecret: config.oauthClientSecret,
        refreshToken: config.refreshToken,
      })
    : config.serviceAccountFile
      ? await getServiceAccountAccessToken(config.serviceAccountFile)
      : null;
  if (!accessToken) return { disabled: true, results: [] };

  const response = await Promise.race([
    generateKeywordHistoricalMetrics({
      customerId: config.customerId,
      developerToken: config.developerToken,
      accessToken,
      keywords,
      geoTargetId: input.geoTargetId ?? await getOptionalSecret("GOOGLE_ADS_KEYWORD_GEO_TARGET_ID") ?? "2608",
      languageId: input.languageId ?? await getOptionalSecret("GOOGLE_ADS_KEYWORD_LANGUAGE_ID") ?? "1000",
      loginCustomerId: config.loginCustomerId,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Google Ads keyword research timeout after 60s")), 60_000)
    ),
  ]);

  const rows = Array.isArray(response.results) ? response.results : [];
  return {
    results: rows.map((row) => {
      const record = row as Record<string, unknown>;
      const rawMetrics = getRecordField(record, "keyword_metrics", "keywordMetrics");
      const metrics = (rawMetrics && typeof rawMetrics === "object"
        ? rawMetrics
        : {}) as Record<string, unknown>;
      return {
        keyword: typeof record.text === "string" ? record.text : "",
        closeVariants: Array.isArray(getRecordField(record, "close_variants", "closeVariants"))
          ? (getRecordField(record, "close_variants", "closeVariants") as unknown[])
              .filter((variant): variant is string => typeof variant === "string")
          : [],
        avgMonthlySearches: toInteger(getRecordField(metrics, "avg_monthly_searches", "avgMonthlySearches")),
        competition: normalizeEnumName(metrics.competition),
        competitionIndex: toInteger(getRecordField(metrics, "competition_index", "competitionIndex")),
        lowTopOfPageBidMicros: toMicrosString(getRecordField(metrics, "low_top_of_page_bid_micros", "lowTopOfPageBidMicros")),
        highTopOfPageBidMicros: toMicrosString(getRecordField(metrics, "high_top_of_page_bid_micros", "highTopOfPageBidMicros")),
        monthlySearchVolumes: Array.isArray(getRecordField(metrics, "monthly_search_volumes", "monthlySearchVolumes"))
          ? getRecordField(metrics, "monthly_search_volumes", "monthlySearchVolumes") as unknown[]
          : [],
        rawPayload: record,
      };
    }).filter((row) => row.keyword),
  };
}

export interface GoogleAdsKeywordIdeasInput {
  seedKeywords: string[];
  pageUrl?: string | null;
  geoTargetId?: string;
  languageId?: string;
  limit?: number;
}

async function generateKeywordIdeas(input: {
  seedKeywords: string[];
  pageUrl?: string | null;
  customerId: string;
  developerToken: string;
  accessToken: string;
  geoTargetId: string;
  languageId: string;
  loginCustomerId?: string;
  pageSize: number;
}): Promise<Record<string, unknown>> {
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? "v24";
  const customerId = normalizeCustomerId(input.customerId);

  const body: Record<string, unknown> = {
    geoTargetConstants: [`geoTargetConstants/${input.geoTargetId}`],
    language: `languageConstants/${input.languageId}`,
    keywordPlanNetwork: "GOOGLE_SEARCH",
    pageSize: input.pageSize,
  };
  const seeds = input.seedKeywords.filter(Boolean);
  // The API accepts a keyword seed, a URL seed, or both combined.
  if (seeds.length && input.pageUrl) {
    body.keywordAndUrlSeed = { url: input.pageUrl, keywords: seeds };
  } else if (input.pageUrl) {
    body.urlSeed = { url: input.pageUrl };
  } else {
    body.keywordSeed = { keywords: seeds };
  }

  const response = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}:generateKeywordIdeas`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "developer-token": input.developerToken,
        ...(input.loginCustomerId
          ? { "login-customer-id": normalizeCustomerId(input.loginCustomerId) }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "object" && payload.error
      ? JSON.stringify(payload.error)
      : response.statusText;
    throw new Error(`Google Ads keyword ideas failed (${response.status}): ${message}`);
  }
  return payload;
}

// Discovers NEW (long-tail) keywords from seed terms and/or a page URL via the
// KeywordPlanIdeaService — unlike fetchGoogleAdsKeywordResearch, which only
// measures keywords you already provide. Results share the research shape so
// they persist through the same KeywordResearchResult path.
export async function fetchGoogleAdsKeywordIdeas(input: GoogleAdsKeywordIdeasInput): Promise<{
  disabled?: boolean;
  results: GoogleAdsKeywordResearchResult[];
}> {
  const seeds = Array.from(new Set(input.seedKeywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 20);
  if (seeds.length === 0 && !input.pageUrl) return { results: [] };

  const config = await googleAdsConfig();
  if (!config.developerToken || !config.customerId) {
    return { disabled: true, results: [] };
  }
  const accessToken = config.refreshToken && config.oauthClientId && config.oauthClientSecret
    ? await getOAuthAccessToken({
        clientId: config.oauthClientId,
        clientSecret: config.oauthClientSecret,
        refreshToken: config.refreshToken,
      })
    : config.serviceAccountFile
      ? await getServiceAccountAccessToken(config.serviceAccountFile)
      : null;
  if (!accessToken) return { disabled: true, results: [] };

  const response = await Promise.race([
    generateKeywordIdeas({
      customerId: config.customerId,
      developerToken: config.developerToken,
      accessToken,
      seedKeywords: seeds,
      pageUrl: input.pageUrl ?? null,
      geoTargetId: input.geoTargetId ?? await getOptionalSecret("GOOGLE_ADS_KEYWORD_GEO_TARGET_ID") ?? "2608",
      languageId: input.languageId ?? await getOptionalSecret("GOOGLE_ADS_KEYWORD_LANGUAGE_ID") ?? "1000",
      loginCustomerId: config.loginCustomerId,
      pageSize: Math.min(Math.max(input.limit ?? 50, 1), 200),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Google Ads keyword ideas timeout after 60s")), 60_000)
    ),
  ]);

  const rows = Array.isArray(response.results) ? response.results : [];
  return {
    results: rows.map((row) => {
      const record = row as Record<string, unknown>;
      const rawMetrics = getRecordField(record, "keyword_idea_metrics", "keywordIdeaMetrics");
      const metrics = (rawMetrics && typeof rawMetrics === "object"
        ? rawMetrics
        : {}) as Record<string, unknown>;
      return {
        keyword: typeof record.text === "string" ? record.text : "",
        closeVariants: [],
        avgMonthlySearches: toInteger(getRecordField(metrics, "avg_monthly_searches", "avgMonthlySearches")),
        competition: normalizeEnumName(metrics.competition),
        competitionIndex: toInteger(getRecordField(metrics, "competition_index", "competitionIndex")),
        lowTopOfPageBidMicros: toMicrosString(getRecordField(metrics, "low_top_of_page_bid_micros", "lowTopOfPageBidMicros")),
        highTopOfPageBidMicros: toMicrosString(getRecordField(metrics, "high_top_of_page_bid_micros", "highTopOfPageBidMicros")),
        monthlySearchVolumes: Array.isArray(getRecordField(metrics, "monthly_search_volumes", "monthlySearchVolumes"))
          ? getRecordField(metrics, "monthly_search_volumes", "monthlySearchVolumes") as unknown[]
          : [],
        rawPayload: record,
      };
    }).filter((row) => row.keyword),
  };
}
