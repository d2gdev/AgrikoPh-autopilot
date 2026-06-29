// Aggregation + metric derivation for the Ad Pilot (Meta) report.
// Pure functions — no I/O — so they can be unit-tested and reused.

export interface RawMetrics {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
}

export interface DerivedMetrics extends RawMetrics {
  ctr: number; // %
  cpc: number;
  cpm: number;
  convRate: number; // %
  roas: number; // x
  cpa: number;
  aov: number;
}

const PURCHASE_ACTIONS = new Set(["purchase", "omni_purchase"]);

export const safeFloat = (v: unknown): number => {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
};
export const safeInt = (v: unknown): number => {
  const n = parseInt(String(v ?? "0"), 10);
  return isNaN(n) ? 0 : n;
};

export function emptyMetrics(): RawMetrics {
  return { spend: 0, clicks: 0, impressions: 0, conversions: 0, revenue: 0 };
}

/** Accumulate a single Meta ad-level insight row into a metrics bucket. */
export function addInsightRow(m: RawMetrics, row: Record<string, unknown>): void {
  m.spend += safeFloat(row.spend);
  m.clicks += safeInt(row.clicks);
  m.impressions += safeInt(row.impressions);

  const actions = (row.actions as Array<{ action_type: string; value: string }>) ?? [];
  for (const a of actions) {
    if (PURCHASE_ACTIONS.has(a.action_type)) m.conversions += safeFloat(a.value);
  }
  const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) ?? [];
  for (const av of actionValues) {
    if (PURCHASE_ACTIONS.has(av.action_type)) m.revenue += safeFloat(av.value);
  }
}

/** Compute derived KPIs from accumulated raw metrics. */
export function derive(m: RawMetrics): DerivedMetrics {
  const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
  const cpc = m.clicks > 0 ? m.spend / m.clicks : 0;
  const cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0;
  const convRate = m.clicks > 0 ? (m.conversions / m.clicks) * 100 : 0;
  const roas = m.spend > 0 ? m.revenue / m.spend : 0;
  const cpa = m.conversions > 0 ? m.spend / m.conversions : 0;
  const aov = m.conversions > 0 ? m.revenue / m.conversions : 0;
  return { ...m, ctr, cpc, cpm, convRate, roas, cpa, aov };
}

// ---- Hierarchy types returned to the client ----

export interface AdNode extends DerivedMetrics {
  id: string;
  name: string;
  status?: string;
}
export interface AdSetNode extends DerivedMetrics {
  id: string;
  name: string;
  status?: string;
  ads: AdNode[];
}
export interface CampaignNode extends DerivedMetrics {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  dailyBudget: number; // currency units (not cents)
  pendingRecs: number;
  adsets: AdSetNode[];
}

export interface AccountReport {
  account: DerivedMetrics & {
    activeCampaigns: number;
    totalCampaigns: number;
    dailyBudget: number;
    frequency: number;
  };
  campaigns: CampaignNode[];
}

interface MetaPayload {
  campaigns?: Array<Record<string, unknown>>;
  adSets?: Array<Record<string, unknown>>;
  ads?: Array<Record<string, unknown>>;
  insights?: Array<Record<string, unknown>>;
}

/**
 * Build the full account → campaign → adset → ad report from a Meta snapshot
 * payload, attaching pending-recommendation counts per campaign.
 */
export function buildReport(
  payload: MetaPayload,
  recCountByCampaign: Record<string, number> = {},
): AccountReport {
  const campaigns = payload.campaigns ?? [];
  const adSets = payload.adSets ?? [];
  const ads = payload.ads ?? [];
  const insights = payload.insights ?? [];

  // Index entity metadata.
  const adMeta = new Map(ads.map((a) => [String(a.id), a]));
  const adsetMeta = new Map(adSets.map((s) => [String(s.id), s]));

  // Accumulate metrics at each level keyed by id.
  const campaignMetrics = new Map<string, RawMetrics>();
  const adsetMetrics = new Map<string, RawMetrics>();
  const adMetrics = new Map<string, RawMetrics>();
  const account = emptyMetrics();
  let frequencyWeighted = 0; // frequency * impressions, for an impression-weighted avg

  const bucket = (map: Map<string, RawMetrics>, key: string): RawMetrics => {
    let m = map.get(key);
    if (!m) { m = emptyMetrics(); map.set(key, m); }
    return m;
  };

  for (const row of insights) {
    const cid = String(row.campaign_id ?? row.campaignId ?? "");
    const sid = String(row.adset_id ?? row.adsetId ?? "");
    const aid = String(row.ad_id ?? row.adId ?? "");

    addInsightRow(account, row);
    frequencyWeighted += safeFloat(row.frequency) * safeInt(row.impressions);
    if (cid) addInsightRow(bucket(campaignMetrics, cid), row);
    if (sid) addInsightRow(bucket(adsetMetrics, sid), row);
    if (aid) addInsightRow(bucket(adMetrics, aid), row);
  }

  // Map adsets/ads to their parents for hierarchy assembly.
  const adsByAdset = new Map<string, string[]>();
  for (const aid of adMetrics.keys()) {
    const meta = adMeta.get(aid);
    const sid = String(meta?.adset_id ?? "");
    if (!sid) continue;
    if (!adsByAdset.has(sid)) adsByAdset.set(sid, []);
    adsByAdset.get(sid)!.push(aid);
  }
  const adsetsByCampaign = new Map<string, Set<string>>();
  for (const sid of adsetMetrics.keys()) {
    const meta = adsetMeta.get(sid);
    const cid = String(meta?.campaign_id ?? "");
    if (!cid) continue;
    if (!adsetsByCampaign.has(cid)) adsetsByCampaign.set(cid, new Set());
    adsetsByCampaign.get(cid)!.add(sid);
  }

  const buildAd = (aid: string): AdNode => {
    const meta = adMeta.get(aid);
    return {
      id: aid,
      name: String(meta?.name ?? aid),
      status: meta?.status as string | undefined,
      ...derive(adMetrics.get(aid) ?? emptyMetrics()),
    };
  };
  const buildAdset = (sid: string): AdSetNode => {
    const meta = adsetMeta.get(sid);
    const adIds = (adsByAdset.get(sid) ?? []).sort(
      (a, b) => (adMetrics.get(b)?.spend ?? 0) - (adMetrics.get(a)?.spend ?? 0),
    );
    return {
      id: sid,
      name: String(meta?.name ?? sid),
      status: meta?.status as string | undefined,
      ...derive(adsetMetrics.get(sid) ?? emptyMetrics()),
      ads: adIds.map(buildAd),
    };
  };

  let activeCampaigns = 0;
  let accountDailyBudget = 0;
  const campaignNodes: CampaignNode[] = campaigns.map((c) => {
    const cid = String(c.id);
    const status = (c.status ?? c.effective_status) as string | undefined;
    if (status === "ACTIVE") activeCampaigns++;
    const dailyBudget = safeFloat(c.daily_budget ?? c.dailyBudget) / 100;
    accountDailyBudget += dailyBudget;
    const sids = [...(adsetsByCampaign.get(cid) ?? [])].sort(
      (a, b) => (adsetMetrics.get(b)?.spend ?? 0) - (adsetMetrics.get(a)?.spend ?? 0),
    );
    return {
      id: cid,
      name: String(c.name ?? cid),
      status,
      objective: c.objective as string | undefined,
      dailyBudget,
      pendingRecs: recCountByCampaign[cid] ?? 0,
      ...derive(campaignMetrics.get(cid) ?? emptyMetrics()),
      adsets: sids.map(buildAdset),
    };
  });
  campaignNodes.sort((a, b) => b.spend - a.spend);

  return {
    account: {
      ...derive(account),
      activeCampaigns,
      totalCampaigns: campaigns.length,
      dailyBudget: accountDailyBudget,
      frequency: account.impressions > 0 ? frequencyWeighted / account.impressions : 0,
    },
    campaigns: campaignNodes,
  };
}
