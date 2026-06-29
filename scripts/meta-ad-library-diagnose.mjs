#!/usr/bin/env node
import "dotenv/config";

const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN;

if (!token) {
  console.error("META_AD_LIBRARY_ACCESS_TOKEN or META_ACCESS_TOKEN is required.");
  process.exit(1);
}

function summarizeError(error) {
  if (!error || typeof error !== "object") return null;
  return {
    message: error.message ?? null,
    type: error.type ?? null,
    code: error.code ?? null,
    subcode: error.error_subcode ?? null,
    userTitle: error.error_user_title ?? null,
    userMessage: error.error_user_msg ?? null,
  };
}

async function graphGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const payload = await res.json().catch(() => ({}));
  return {
    status: res.status,
    ok: res.ok,
    count: Array.isArray(payload.data) ? payload.data.length : null,
    error: summarizeError(payload.error),
  };
}

const permissionCheck = await graphGet("v20.0/me/permissions");
console.log("Token permissions:");
console.log(JSON.stringify(permissionCheck, null, 2));

const fields = [
  "id",
  "page_id",
  "page_name",
  "ad_snapshot_url",
  "ad_delivery_start_time",
].join(",");

const checks = [
  {
    name: "Meta research repo style, CA",
    path: "v14.0/ads_archive",
    params: {
      fields,
      search_terms: "organic rice",
      ad_reached_countries: "CA",
      search_page_ids: "",
      ad_active_status: "ALL",
      limit: "5",
    },
  },
  {
    name: "Meta research repo style, US",
    path: "v14.0/ads_archive",
    params: {
      fields,
      search_terms: "organic rice",
      ad_reached_countries: "US",
      search_page_ids: "",
      ad_active_status: "ALL",
      limit: "5",
    },
  },
  {
    name: "Current Graph style, PH",
    path: "v20.0/ads_archive",
    params: {
      fields,
      search_terms: "organic rice",
      ad_reached_countries: JSON.stringify(["PH"]),
      ad_active_status: "ALL",
      ad_type: "ALL",
      limit: "5",
    },
  },
];

for (const check of checks) {
  const result = await graphGet(check.path, check.params);
  console.log(`\n${check.name}:`);
  console.log(JSON.stringify(result, null, 2));
}
