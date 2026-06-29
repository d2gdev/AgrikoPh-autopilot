import type { Recommendation } from "@prisma/client";
import { getToken, detectAndLogTokenExpiry } from "./meta-token";
import { getSecret } from "@/lib/config/resolver";
import { parseMetaApiError } from "@/lib/connectors/meta-errors";

const BASE_URL = "https://graph.facebook.com/v20.0";

async function getAccountId() {
  const id = await getSecret("META_AD_ACCOUNT_ID");
  // Meta API requires act_ prefix
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function graphGet(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${await getToken()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    detectAndLogTokenExpiry(err);
    throw parseMetaApiError(res.status, err);
  }
  return res.json();
}

async function graphPost(endpoint: string, body: Record<string, string> = {}): Promise<unknown> {
  const params = new URLSearchParams(body);
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${await getToken()}`,
    },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    detectAndLogTokenExpiry(err);
    throw parseMetaApiError(res.status, err);
  }
  return res.json();
}

/** Fetch all pages of a paginated Graph API endpoint, following paging.next cursors. */
async function graphGetAll(endpoint: string, params: Record<string, string> = {}): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;

  do {
    const pageParams = cursor ? { ...params, after: cursor } : params;
    const page = await graphGet(endpoint, pageParams) as Record<string, unknown>;
    const items = Array.isArray((page as any).data) ? (page as any).data : [];
    results.push(...items);
    const paging = (page as any).paging as Record<string, unknown> | undefined;
    cursor = (paging?.cursors as any)?.after as string | undefined;
    // Stop if there is no next page
    if (!paging?.next) cursor = undefined;
  } while (cursor);

  return results;
}

async function graphGetEntity(entityId: string): Promise<Record<string, unknown>> {
  const data = await graphGet(entityId, {
    fields: "id,name,status,daily_budget,effective_status",
  });
  return data as Record<string, unknown>;
}

export async function fetchMetaData(opts: { start: Date; end: Date }): Promise<Record<string, unknown>> {
  const accountId = await getAccountId();
  const since = opts.start.toISOString().split("T")[0];
  const until = opts.end.toISOString().split("T")[0];
  const timeRange = JSON.stringify({ since, until });

  const [campaignsData, adSetsData, adsData] = await Promise.all([
    graphGetAll(`${accountId}/campaigns`, {
      fields: "id,name,status,daily_budget,lifetime_budget,objective",
      limit: "100",
    }),
    graphGetAll(`${accountId}/adsets`, {
      fields: "id,name,campaign_id,status,daily_budget,targeting,optimization_goal",
      limit: "200",
    }),
    graphGetAll(`${accountId}/ads`, {
      fields: "id,name,adset_id,campaign_id,status,creative{id,name,thumbnail_url}",
      limit: "200",
    }),
  ]);

  const insightsData = await graphGetAll(`${accountId}/insights`, {
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,clicks,spend,cpc,cpm,ctr,actions,action_values,frequency",
    time_range: timeRange,
    level: "ad",
    limit: "500",
  });

  return {
    campaigns: campaignsData,
    adSets: adSetsData,
    ads: adsData,
    insights: insightsData,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchMetaEntityState(entityId: string): Promise<Record<string, unknown>> {
  return graphGetEntity(entityId);
}

function validateMetaEntityId(id: string | null | undefined, actionType: string): void {
  if (!id) throw new Error(`targetEntityId is required for ${actionType}`);
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid Meta entity ID for ${actionType}: must be numeric, got "${id}"`);
  }
}

export async function executeMetaAction(rec: Recommendation): Promise<Record<string, unknown>> {
  validateMetaEntityId(rec.targetEntityId, rec.actionType);
  switch (rec.actionType) {
    case "pause_campaign":
    case "pause_ad": {
      const res = await graphPost(rec.targetEntityId, { status: "PAUSED" });
      return { action: rec.actionType, entityId: rec.targetEntityId, result: res };
    }
    case "adjust_budget": {
      if (!rec.proposedValue) throw new Error("No proposed budget value");
      const cleaned = rec.proposedValue.replace(/[^0-9.]/g, "");
      if (!/^\d+(\.\d+)?$/.test(cleaned)) {
        throw new Error(`adjust_budget requires a valid numeric amount — got: "${rec.proposedValue}"`);
      }
      const numeric = parseFloat(cleaned);
      if (!numeric || isNaN(numeric) || numeric <= 0) {
        throw new Error(`adjust_budget requires a numeric amount — got: "${rec.proposedValue}"`);
      }
      const budgetCents = Math.round(numeric * 100);
      const res = await graphPost(rec.targetEntityId, { daily_budget: String(budgetCents) });
      return { action: "adjust_budget", entityId: rec.targetEntityId, result: res };
    }
    default:
      throw new Error(`Meta execution not implemented for action: ${rec.actionType}`);
  }
}
