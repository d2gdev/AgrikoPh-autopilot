import { prisma } from "@/lib/db";
import { resolveConfigValues, type ResolvedConfigValue } from "@/lib/config/resolver";

export type ConnectorHealthStatus = "configured" | "partial" | "missing";

export interface ConnectorHealth {
  id: string;
  label: string;
  status: ConnectorHealthStatus;
  configured: boolean;
  sources: Array<{ key: string; source: "db" | "env" }>;
  missing: string[];
  notes: string[];
  jobName?: string;
  lastStatus?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
}

type Requirement = {
  label: string;
  keys: string[];
  mode: "all" | "any";
};

type ConnectorDefinition = {
  id: string;
  label: string;
  requirements: Requirement[];
  optionalKeys?: string[];
  notes?: string[];
  jobName?: string;
  getDynamicNotes?: (resolved: Map<string, ResolvedConfigValue>) => string[];
};

const DEFINITIONS: ConnectorDefinition[] = [
  {
    id: "shopify_admin",
    label: "Shopify Admin",
    requirements: [
      { label: "Store domain", keys: ["SHOPIFY_STORE_DOMAIN"], mode: "all" },
      { label: "Admin access token", keys: ["SHOPIFY_ADMIN_ACCESS_TOKEN"], mode: "all" },
    ],
  },
  {
    id: "ai",
    label: "AI Provider",
    requirements: [
      { label: "DeepSeek or OpenRouter API key", keys: ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"], mode: "any" },
    ],
    optionalKeys: ["DEEPSEEK_MODEL", "OPENROUTER_MODEL"],
    notes: ["DeepSeek is preferred; OpenRouter is fallback."],
    jobName: "run-skills",
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    requirements: [
      { label: "Access token", keys: ["META_ACCESS_TOKEN"], mode: "all" },
      { label: "Ad account ID", keys: ["META_AD_ACCOUNT_ID"], mode: "all" },
    ],
    optionalKeys: ["META_TOKEN_EXPIRES_AT"],
    jobName: "fetch-ads-data",
    getDynamicNotes(resolved) {
      const raw = resolved.get("META_TOKEN_EXPIRES_AT")?.value;
      if (!raw) return [];
      const expiresAt = new Date(raw);
      if (isNaN(expiresAt.getTime())) return [`META_TOKEN_EXPIRES_AT is set but not a valid date: "${raw}"`];
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
      const dateStr = expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      if (daysLeft < 0) return [`Token expired ${Math.abs(daysLeft)} days ago (${dateStr}) — renew immediately.`];
      if (daysLeft <= 7) return [`Token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${dateStr}) — renew now.`];
      if (daysLeft <= 30) return [`Token expires in ${daysLeft} days (${dateStr}).`];
      return [];
    },
  },
  {
    id: "meta_organic",
    label: "Meta Organic",
    requirements: [
      { label: "Access token", keys: ["META_ACCESS_TOKEN"], mode: "all" },
      { label: "Page ID", keys: ["META_PAGE_ID"], mode: "all" },
    ],
  },
  {
    id: "meta_ad_library",
    label: "Meta Ad Library",
    requirements: [
      {
        label: "API token or Playwright scraper flag",
        keys: ["META_AD_LIBRARY_ACCESS_TOKEN", "META_ACCESS_TOKEN", "META_AD_LIBRARY_SCRAPE_ENABLED"],
        mode: "any",
      },
    ],
    notes: ["API is preferred. Playwright only counts as configured when META_AD_LIBRARY_SCRAPE_ENABLED is true."],
    jobName: "fetch-market-intel",
  },
  {
    id: "google_ads_keyword_research",
    label: "Keyword Planner Research",
    requirements: [
      { label: "Developer token", keys: ["GOOGLE_ADS_DEVELOPER_TOKEN"], mode: "all" },
      { label: "Customer ID", keys: ["GOOGLE_ADS_CUSTOMER_ID"], mode: "all" },
      {
        label: "Service account or OAuth credentials",
        keys: [
          "GA_SERVICE_ACCOUNT_JSON_PATH",
          "GA_SERVICE_ACCOUNT_JSON",
          "GOOGLE_ADS_OAUTH_CLIENT_JSON_PATH",
          "GOOGLE_ADS_CLIENT_SECRET_JSON_PATH",
          "GOOGLE_ADS_REFRESH_TOKEN",
          "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
          "GA_ADS_REFRESH_TOKEN",
        ],
        mode: "any",
      },
    ],
    optionalKeys: ["GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_KEYWORD_GEO_TARGET_ID", "GOOGLE_ADS_KEYWORD_LANGUAGE_ID"],
    notes: ["Uses Google's Keyword Planner API for SEO research; paid Google Ads campaign snapshots remain disabled unless explicitly enabled."],
    jobName: "fetch-keyword-research",
  },
  {
    id: "ga4",
    label: "GA4",
    requirements: [
      { label: "Property ID", keys: ["GA4_PROPERTY_ID"], mode: "all" },
      { label: "Service account", keys: ["GA4_SERVICE_ACCOUNT_JSON", "GA4_SERVICE_ACCOUNT_JSON_PATH"], mode: "any" },
    ],
    jobName: "fetch-seo-data",
  },
  {
    id: "gsc",
    label: "Google Search Console",
    requirements: [
      { label: "Site URL", keys: ["GSC_SITE_URL"], mode: "all" },
      { label: "Service account", keys: ["GSC_SERVICE_ACCOUNT_JSON", "GSC_SERVICE_ACCOUNT_JSON_PATH"], mode: "any" },
    ],
    jobName: "fetch-seo-data",
  },
  {
    id: "shopping_serper",
    label: "Shopping API",
    requirements: [
      { label: "Shopping API key", keys: ["SERPER_API_KEY", "SERPER_DEV_API_KEY", "SERPER_KEY", "GOOGLE_SERPER_API_KEY"], mode: "any" },
    ],
    notes: ["Configuration check only; this does not call the shopping API."],
    jobName: "fetch-market-intel",
  },
  {
    id: "dataforseo",
    label: "DataForSEO",
    requirements: [
      { label: "Login", keys: ["DATAFORSEO_LOGIN"], mode: "all" },
      { label: "Password", keys: ["DATAFORSEO_PASSWORD"], mode: "all" },
    ],
    jobName: "fetch-market-intel",
  },
  {
    id: "alerts",
    label: "Failure Alerts",
    requirements: [
      { label: "Alert webhook URL", keys: ["ALERT_WEBHOOK_URL"], mode: "all" },
    ],
    notes: ["Missing webhook means failed-job alerts are dormant."],
  },
];

function isPresent(resolved: ResolvedConfigValue) {
  if (!resolved.value) return false;
  if (resolved.key === "META_AD_LIBRARY_SCRAPE_ENABLED") return resolved.value === "true";
  return true;
}

function requirementMet(requirement: Requirement, resolved: Map<string, ResolvedConfigValue>) {
  const present = requirement.keys.filter((key) => {
    const value = resolved.get(key);
    return value ? isPresent(value) : false;
  });
  return requirement.mode === "all"
    ? present.length === requirement.keys.length
    : present.length > 0;
}

function missingLabel(requirement: Requirement) {
  return requirement.keys.length === 1
    ? requirement.keys[0]
    : `${requirement.label} (${requirement.keys.join(" or ")})`;
}

async function getJobHealth(jobName?: string) {
  if (!jobName) return {};
  const [last, lastSuccess] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName },
      orderBy: { startedAt: "desc" },
      select: { status: true, errorLog: true },
    }),
    prisma.jobRun.findFirst({
      where: { jobName, status: { in: ["success", "partial"] } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
  ]);

  return {
    lastStatus: last?.status ?? null,
    lastSuccessAt: lastSuccess?.completedAt?.toISOString() ?? null,
    lastError: last?.status === "failed" ? (last.errorLog ?? "").slice(0, 300) : null,
  };
}

export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const allKeys = Array.from(new Set(DEFINITIONS.flatMap((definition) => [
    ...definition.requirements.flatMap((requirement) => requirement.keys),
    ...(definition.optionalKeys ?? []),
  ])));
  const resolvedValues = await resolveConfigValues(allKeys);
  const resolved = new Map<string, ResolvedConfigValue>(Object.entries(resolvedValues));
  const jobHealthEntries = await Promise.all(
    Array.from(new Set(DEFINITIONS.flatMap((definition) => definition.jobName ? [definition.jobName] : [])))
      .map(async (jobName) => [jobName, await getJobHealth(jobName)] as const),
  );
  const jobHealthByName = new Map(jobHealthEntries);

  return DEFINITIONS.map((definition) => {
    const missing: string[] = definition.requirements
      .filter((requirement) => !requirementMet(requirement, resolved))
      .map((requirement) => missingLabel(requirement) ?? requirement.label);
    const relevantKeys = [
      ...definition.requirements.flatMap((requirement) => requirement.keys),
      ...(definition.optionalKeys ?? []),
    ];
    const sources = relevantKeys.flatMap((key) => {
      const value = resolved.get(key);
      if (!value || !isPresent(value) || value.source === "missing") return [];
      return [{ key: value.key, source: value.source }];
    });
    const configured = missing.length === 0;
    const status: ConnectorHealthStatus = configured
      ? "configured"
      : sources.length > 0
        ? "partial"
        : "missing";

    return {
      id: definition.id,
      label: definition.label,
      status,
      configured,
      sources,
      missing,
      notes: [...(definition.notes ?? []), ...(definition.getDynamicNotes?.(resolved) ?? [])],
      jobName: definition.jobName,
      ...(definition.jobName ? jobHealthByName.get(definition.jobName) : {}),
    };
  });
}
