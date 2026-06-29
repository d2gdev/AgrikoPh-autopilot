export type RunProfile = "smoke" | "shopping" | "meta-pages" | "meta-keywords" | "scheduled";

export interface ResolvedLimits {
  keywordLimit: number;
  shoppingResultLimit: number;
  competitorPageLimit: number;
  adLimitPerPage: number;
  longRunningAdDays: number;
  sources: Array<"shopping" | "meta">;
}

export interface MarketIntelRunOptions {
  profile: RunProfile;
  // Explicit overrides — only honoured up to the profile's hard cap.
  keywordLimit?: number;
  shoppingResultLimit?: number;
  competitorPageLimit?: number;
  adLimitPerPage?: number;
}

// Hard caps per profile. Manual UI triggers can never exceed these regardless of
// what the caller passes. The scheduled profile defers to env vars instead.
const PROFILE_CAPS: Record<RunProfile, Omit<ResolvedLimits, "longRunningAdDays">> = {
  smoke: {
    keywordLimit: 1,
    shoppingResultLimit: 5,
    competitorPageLimit: 1,
    adLimitPerPage: 10,
    sources: ["shopping", "meta"],
  },
  shopping: {
    keywordLimit: 10,
    shoppingResultLimit: 20,
    competitorPageLimit: 0,
    adLimitPerPage: 0,
    sources: ["shopping"],
  },
  "meta-pages": {
    keywordLimit: 0,
    shoppingResultLimit: 0,
    competitorPageLimit: 10,
    adLimitPerPage: 50,
    sources: ["meta"],
  },
  "meta-keywords": {
    keywordLimit: 0,
    shoppingResultLimit: 0,
    competitorPageLimit: 5,
    adLimitPerPage: 50,
    sources: ["meta"],
  },
  // Scheduled defers entirely to env vars — no hard caps applied here.
  scheduled: {
    keywordLimit: Infinity,
    shoppingResultLimit: Infinity,
    competitorPageLimit: Infinity,
    adLimitPerPage: Infinity,
    sources: ["shopping", "meta"],
  },
};

export function resolveRunLimits(options: MarketIntelRunOptions): ResolvedLimits {
  const longRunningAdDays = Math.max(1, Number(process.env.MARKET_INTEL_LONG_RUNNING_AD_DAYS ?? 30));

  if (options.profile === "scheduled") {
    return {
      keywordLimit: Math.max(0, Number(process.env.MARKET_INTEL_KEYWORD_LIMIT ?? 5)),
      shoppingResultLimit: Math.max(1, Number(process.env.MARKET_INTEL_RESULTS_PER_KEYWORD ?? 20)),
      competitorPageLimit: Math.max(0, Number(process.env.MARKET_INTEL_COMPETITOR_PAGE_LIMIT ?? 10)),
      adLimitPerPage: Math.max(1, Number(process.env.MARKET_INTEL_ADS_PER_PAGE_LIMIT ?? 50)),
      longRunningAdDays,
      sources: ["shopping", "meta"],
    };
  }

  const caps = PROFILE_CAPS[options.profile];
  return {
    keywordLimit: Math.min(caps.keywordLimit, Math.max(0, options.keywordLimit ?? caps.keywordLimit)),
    shoppingResultLimit: Math.min(caps.shoppingResultLimit, Math.max(1, options.shoppingResultLimit ?? caps.shoppingResultLimit)),
    competitorPageLimit: Math.min(caps.competitorPageLimit, Math.max(0, options.competitorPageLimit ?? caps.competitorPageLimit)),
    adLimitPerPage: Math.min(caps.adLimitPerPage, Math.max(1, options.adLimitPerPage ?? caps.adLimitPerPage)),
    longRunningAdDays,
    sources: caps.sources,
  };
}

export const VALID_PROFILES: RunProfile[] = ["smoke", "shopping", "meta-pages", "meta-keywords", "scheduled"];
