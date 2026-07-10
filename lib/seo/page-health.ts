import type {
  Ga4PageRow,
  GscPageRow,
  PageHealthFlag,
  PageHealthRow,
} from "@/lib/seo/types";
import { parseNum, parsePercent } from "@/lib/seo/types";

function parseNullablePercent(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !/\d/.test(value)) return null;
  return parsePercent(value);
}

/**
 * Normalize a page identifier to a path for cross-source joining.
 * GSC stores absolute URLs ("https://host/path?q"); GA4 stores path-only
 * ("/path"). Strip protocol/host, query, and hash; collapse trailing slash.
 */
export function normalizePagePath(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim();
  if (!s) return "";

  // Drop protocol + host when present.
  const protoMatch = s.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (protoMatch) {
    s = protoMatch[1] ?? "/";
  }

  // Strip query string and hash.
  s = (s.split("#")[0] ?? "").split("?")[0] ?? "";

  // Ensure leading slash.
  if (!s.startsWith("/")) s = "/" + s;

  // Collapse trailing slash (but keep root "/").
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);

  return s.toLowerCase();
}

// B3 — thresholds for flagging.
const HIGH_IMPRESSIONS = 500;
const HIGH_BOUNCE = 0.7; // 70%
const LOW_CONVERSION = 0.01; // 1%

/**
 * Join GSC landing-page performance with GA4 page metrics by normalized path.
 *
 * Pure function — no DB calls. GSC rows that have no matching GA4 row keep
 * null GA4 metrics and receive no flag.
 *
 * Severity ranks rows for sorting: scaled by impressions so the highest-traffic
 * problem pages float to the top. 0 when no flag.
 */
export function computePageHealth(
  gscPages: GscPageRow[],
  ga4Pages: Ga4PageRow[],
): PageHealthRow[] {
  // Index GA4 rows by normalized path; keep the highest-session row on collision.
  const ga4ByPath = new Map<string, Ga4PageRow>();
  for (const g of ga4Pages ?? []) {
    if (!g || !g.page) continue;
    const key = normalizePagePath(g.page);
    if (!key) continue;
    const existing = ga4ByPath.get(key);
    if (!existing || parseNum(g.sessions) > parseNum(existing.sessions)) {
      ga4ByPath.set(key, g);
    }
  }

  const rows: PageHealthRow[] = [];

  for (const p of gscPages ?? []) {
    if (!p || !p.page) continue;
    const url = normalizePagePath(p.page);
    const impressions = parseNum(p.impressions);
    const clicks = parseNum(p.clicks);
    const position = parseNum(p.position);

    const ga4 = ga4ByPath.get(url) ?? null;
    const sessions = ga4 ? parseNum(ga4.sessions) : null;
    const bounceRate = ga4 ? parseNullablePercent(ga4.bounceRate) : null;
    const conversionRate = ga4 ? parseNullablePercent(ga4.conversionRate) : null;

    const flags: PageHealthFlag[] = [];
    let severity = 0;

    if (impressions >= HIGH_IMPRESSIONS && ga4) {
      if (bounceRate !== null && bounceRate >= HIGH_BOUNCE) {
        flags.push("high-impressions-high-bounce");
        // Severity weighted by impressions and bounce excess.
        severity += impressions * (bounceRate - HIGH_BOUNCE + 0.01);
      }
      if (conversionRate !== null && conversionRate < LOW_CONVERSION) {
        flags.push("high-impressions-low-conversion");
        severity += impressions * (LOW_CONVERSION - conversionRate + 0.01);
      }
    }

    rows.push({
      url,
      rawUrl: p.page,
      impressions,
      clicks,
      position,
      sessions,
      bounceRate,
      conversionRate,
      flag: flags[0] ?? null,
      flags,
      severity,
    });
  }

  rows.sort((a, b) => b.severity - a.severity || b.impressions - a.impressions);
  return rows;
}
