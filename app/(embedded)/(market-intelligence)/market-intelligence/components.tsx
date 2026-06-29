"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineStack, Link, SkeletonBodyText, Text } from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

export interface MarketInsight {
  id: string;
  createdAt: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  status: string;
  competitor?: { name: string } | null;
  keyword?: { keyword: string } | null;
}

export interface CompetitorAd {
  id: string;
  capturedAt: string;
  pageName?: string | null;
  headline?: string | null;
  headlineEn?: string | null;
  adCopy?: string | null;
  adCopyEn?: string | null;
  activeStatus?: string | null;
  creativeAngle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  cta?: string | null;
  landingPageUrl?: string | null;
  creativeType?: string | null;
  platforms?: string[] | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  adSnapshotUrl?: string | null;
  competitor?: { name: string } | null;
}

/** Days an ad has been running: startDate → (endDate ?? now). Null if no start. */
export function adRunningDays(ad: { startDate?: string | null; endDate?: string | null }): number | null {
  if (!ad.startDate) return null;
  const start = new Date(ad.startDate).getTime();
  if (Number.isNaN(start)) return null;
  const end = ad.endDate ? new Date(ad.endDate).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function severityTone(severity: string): "success" | "info" | "warning" | "critical" | undefined {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

// Severity ordering for sorting insights (lower = more urgent, shown first).
export const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2, success: 3 };

export function shortDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Human-friendly relative time, falling back to an absolute date for older values.
export function relativeTime(value?: string | null): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return shortDate(value);
}

/** One insight as a severity-toned card — the page's "what changed" headline unit. */
export function InsightCard({ insight }: { insight: MarketInsight }) {
  const source = insight.competitor?.name ?? insight.keyword?.keyword ?? null;
  return (
    <Card>
      <BlockStack gap="150">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Badge tone={severityTone(insight.severity)}>{insight.severity}</Badge>
          <Text variant="headingSm" as="h3">{insight.title}</Text>
        </InlineStack>
        <Text as="p" tone="subdued">{insight.summary}</Text>
        <InlineStack gap="200" wrap>
          <Text as="span" variant="bodySm" tone="subdued">{insight.type.replace(/_/g, " ")}</Text>
          {source && <Text as="span" variant="bodySm" tone="subdued">· {source}</Text>}
          <Text as="span" variant="bodySm" tone="subdued">· {relativeTime(insight.createdAt)}</Text>
          {insight.status && <Text as="span" variant="bodySm" tone="subdued">· {insight.status}</Text>}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

// ─── Price comparison ────────────────────────────────────────────────────────

export interface OurProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
}

interface CompetitorResult {
  id: string;
  title: string;
  titleEn?: string | null;
  price?: number | null;
  currency?: string | null;
  store?: string | null;
}

const STOP_WORDS = new Set([
  "the","a","an","and","of","for","with","in","on","at","to","by",
  "kg","g","ml","l","pack","set","pcs","pc","piece","pieces","box",
]);

function tokenise(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t))
  );
}

export function scoreMatch(ourTitle: string, competitorTitle: string): number {
  const a = tokenise(ourTitle);
  const b = tokenise(competitorTitle);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared); // Jaccard
}

export function findMatches(
  product: OurProduct,
  results: CompetitorResult[],
  { threshold = 0.25, limit = 5 }: { threshold?: number; limit?: number } = {},
): CompetitorResult[] {
  return results
    .map(r => ({ r, score: scoreMatch(product.title, r.titleEn ?? r.title) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => r)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

function marketBadge(ourPrice: number, matches: CompetitorResult[]): {
  label: string; tone: "success" | "warning" | "info";
} | null {
  const prices = matches.map(m => m.price).filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  if (ourPrice < avg * 0.97) return { label: "Below avg ↓", tone: "success" };
  if (ourPrice > avg * 1.03) return { label: "Above avg ↑", tone: "warning" };
  return { label: "At market", tone: "info" };
}

export function PriceComparisonCard({
  product,
  matches,
}: {
  product: OurProduct;
  matches: CompetitorResult[];
}) {
  const badge = marketBadge(product.price, matches);
  const fmt = (price: number | null | undefined, currency: string | null | undefined) =>
    price == null ? "-" : `${currency ?? ""} ${price.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">{product.title}</Text>
            <Text as="p" tone="subdued">Our price: {fmt(product.price, product.currency)}</Text>
          </BlockStack>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </InlineStack>
        {matches.length === 0 ? (
          <Text as="p" tone="subdued" variant="bodySm">No comparable products found in current data range.</Text>
        ) : (
          <BlockStack gap="100">
            {matches.map(m => (
              <InlineStack key={m.id} align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm">{m.store ?? "Unknown store"} — {m.titleEn ?? m.title}</Text>
                <Text as="span" variant="bodySm">{fmt(m.price, m.currency)}</Text>
              </InlineStack>
            ))}
            <Text as="p" tone="subdued" variant="bodySm">Matched by title similarity</Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Competitor ads ───────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseAdCopy(raw: string): { body: string; hashtags: string[] } {
  const decoded = decodeHtmlEntities(raw);
  // Strip embedded URLs (http/https)
  const noUrls = decoded.replace(/https?:\/\/\S+/g, "").trim();
  // Extract hashtags
  const hashtags = (noUrls.match(/#\w+/g) ?? []);
  const body = noUrls.replace(/#\w+/g, "").replace(/\s{2,}/g, " ").trim();
  return { body, hashtags };
}

/** One competitor ad as a creative card — readable headline/copy instead of a table row. */
interface StolenAd {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;
  suggestedContentType: string;
}

export function AdCreativeCard({ ad, count = 1 }: { ad: CompetitorAd; count?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [stealing, setStealing] = useState(false);
  const [stolen, setStolen] = useState<StolenAd | null>(null);
  const [stealError, setStealError] = useState<string | null>(null);
  const [sendingToCP, setSendingToCP] = useState(false);
  const [sentToCP, setSentToCP] = useState(false);
  const authFetch = useAuthFetch();

  const handleSteal = async () => {
    setStealing(true);
    setStealError(null);
    setStolen(null);
    setSentToCP(false);
    try {
      const res = await authFetch("/api/market-intelligence/steal-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId: ad.id }),
      });
      const data = await res.json() as { result?: StolenAd; error?: string };
      if (data.error) { setStealError(data.error); return; }
      if (data.result) setStolen(data.result);
    } catch {
      setStealError("Failed to rewrite ad. Please try again.");
    } finally {
      setStealing(false);
    }
  };

  const handleSendToCP = async () => {
    if (!stolen) return;
    setSendingToCP(true);
    try {
      const res = await authFetch("/api/market-intelligence/steal-ad/send-to-content-pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...stolen, sourceAdId: ad.id }),
      });
      const data = await res.json() as { proposalId?: string; error?: string };
      if (data.error) { setStealError(data.error); return; }
      setSentToCP(true);
    } catch {
      setStealError("Failed to send to Content Pilot.");
    } finally {
      setSendingToCP(false);
    }
  };

  const handleCopy = () => {
    if (!stolen) return;
    void navigator.clipboard.writeText(`${stolen.headline}\n\n${stolen.adCopy}`);
  };
  const name = ad.competitor?.name ?? ad.pageName ?? "Unknown";
  const isActive = (ad.activeStatus ?? "").toLowerCase().includes("active");
  const ended = Boolean(ad.endDate);
  // Prefer the English translation of scraped competitor copy when available.
  const headline = ad.headlineEn ?? ad.headline;
  const rawCopy = ad.adCopyEn ?? ad.adCopy ?? "";
  const { body: copy, hashtags } = parseAdCopy(rawCopy);
  const isLong = copy.length > 220;
  const shownCopy = expanded || !isLong ? copy : `${copy.slice(0, 220)}…`;

  const days = adRunningDays(ad);
  const durationLabel = days == null ? null : ended ? `Ran ${days} days · ended` : `Running ${days} days`;
  // Long runs are the proven-winner signal — escalate the badge tone with age.
  const durationTone = days == null ? undefined : ended ? undefined : days >= 120 ? "success" : "attention";

  const platforms = (ad.platforms ?? []).filter(Boolean);

  return (
    <Card>
      <BlockStack gap="150">
        <InlineStack gap="200" align="space-between" blockAlign="center" wrap={false}>
          <Badge tone="info">{name}</Badge>
          {count > 1 && <Badge tone="new">{`×${count}`}</Badge>}
        </InlineStack>

        {durationLabel && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Badge tone={durationTone as "success" | "attention" | undefined}>{durationLabel}</Badge>
            <Badge tone={isActive && !ended ? "success" : undefined}>{ended ? "inactive" : (ad.activeStatus ?? "unknown")}</Badge>
            {ad.creativeAngle && <Badge tone="info">{ad.creativeAngle.replace(/-/g, " ")}</Badge>}
            {ad.creativeType && <Badge>{ad.creativeType.toLowerCase()}</Badge>}
            {platforms.map((p) => <Badge key={p}>{p.toLowerCase()}</Badge>)}
          </InlineStack>
        )}

        {headline && <Text variant="headingSm" as="h3">{headline}</Text>}
        <Text as="p" tone="subdued">{shownCopy || "No ad text"}</Text>
        {isLong && (
          <Link removeUnderline onClick={() => setExpanded((v) => !v)}>{expanded ? "Show less" : "Show more"}</Link>
        )}
        {hashtags.length > 0 && (
          <InlineStack gap="100" wrap>
            {hashtags.slice(0, 8).map((tag) => (
              <Badge key={tag} tone="info">{tag}</Badge>
            ))}
            {hashtags.length > 8 && <Text as="span" variant="bodySm" tone="subdued">+{hashtags.length - 8} more</Text>}
          </InlineStack>
        )}

        {ad.cta && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Badge tone="info">{ad.cta}</Badge>
            {ad.landingPageUrl && <Link url={ad.landingPageUrl} target="_blank">Landing page ↗</Link>}
          </InlineStack>
        )}

        <InlineStack gap="200" wrap blockAlign="center">
          {ad.startDate && <Text as="span" variant="bodySm" tone="subdued">Started {shortDate(ad.startDate)}</Text>}
          <Text as="span" variant="bodySm" tone="subdued">· Captured {relativeTime(ad.capturedAt)}</Text>
          {ad.adSnapshotUrl && (
            <Link url={ad.adSnapshotUrl} target="_blank">View on Meta</Link>
          )}
        </InlineStack>

        {/* Steal This Ad */}
        {(ad.adCopy || ad.headline) && (
          <BlockStack gap="200">
            {!stolen && (
              <Button
                variant="plain"
                size="slim"
                loading={stealing}
                onClick={() => void handleSteal()}
              >
                Steal This Ad
              </Button>
            )}

            {stealError && (
              <Banner tone="warning" onDismiss={() => setStealError(null)}>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm">{stealError}</Text>
                  <Button variant="plain" size="slim" onClick={() => void handleSteal()}>Try again</Button>
                </InlineStack>
              </Banner>
            )}

            {stolen && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h4">Rewritten for Agriko</Text>
                    <Button variant="plain" size="slim" onClick={() => { setStolen(null); setSentToCP(false); }}>Dismiss</Button>
                  </InlineStack>
                  <Text variant="headingSm" as="p">{stolen.headline}</Text>
                  <Text as="p" tone="subdued">{stolen.adCopy}</Text>
                  {sentToCP ? (
                    <Text as="p" tone="success" variant="bodySm">Sent to Content Pilot ✓</Text>
                  ) : (
                    <InlineStack gap="200">
                      <Button size="slim" onClick={handleCopy}>Copy to clipboard</Button>
                      <Button size="slim" tone="success" loading={sendingToCP} onClick={() => void handleSendToCP()}>
                        Send to Content Pilot
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Competitive Brief ────────────────────────────────────────────────────────

interface BriefSections {
  adsActivity: string;
  pricingMovements: string;
  opportunities: string;
  recommendedActions: Array<{
    priority: "high" | "medium" | "low";
    action: string;
    reason: string;
  }>;
  generatedAt: string;
}

interface BriefResponse {
  brief?: BriefSections;
  cached?: boolean;
  generatedAt?: string;
  error?: string;
}

const PRIORITY_TONE: Record<string, "critical" | "attention" | "info"> = {
  high: "critical",
  medium: "attention",
  low: "info",
};

export function CompetitiveBrief() {
  const [brief, setBrief] = useState<BriefSections | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const hasFetched = useRef(false);
  const authFetch = useAuthFetch();

  const fetchBrief = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const url = forceRefresh ? "/api/market-intelligence/brief/refresh" : "/api/market-intelligence/brief";
      const res = await authFetch(url, { method: forceRefresh ? "POST" : "GET" });
      const data = await res.json() as BriefResponse;
      if (data.error) { setError(data.error); return; }
      if (data.brief) {
        setBrief(data.brief);
        setGeneratedAt(data.generatedAt ?? null);
      }
    } catch {
      setError("Failed to load brief. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void fetchBrief(false);
  }, [fetchBrief]);

  const age = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 3_600_000)
    : null;
  const ageLabel = age === null ? "" : age < 1 ? "just now" : `${age}h ago`;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">Competitive Brief</Text>
          <InlineStack gap="200" blockAlign="center">
            {ageLabel && <Text as="span" variant="bodySm" tone="subdued">Generated {ageLabel}</Text>}
            <Button
              variant="plain"
              size="slim"
              icon={RefreshIcon}
              loading={refreshing}
              disabled={loading}
              onClick={() => void fetchBrief(true)}
            >
              Refresh
            </Button>
          </InlineStack>
        </InlineStack>

        {loading && (
          <BlockStack gap="400">
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={2} />
          </BlockStack>
        )}

        {error && !loading && (
          <Banner tone="warning" onDismiss={() => setError(null)}>
            <BlockStack gap="200">
              <Text as="p">{error}</Text>
              <Button variant="plain" onClick={() => void fetchBrief(false)}>Try again</Button>
            </BlockStack>
          </Banner>
        )}

        {brief && !loading && (
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Ads Activity</Text>
              <Text as="p" tone="subdued">{brief.adsActivity}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Pricing Movements</Text>
              <Text as="p" tone="subdued">{brief.pricingMovements}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="100">
              <Text variant="headingSm" as="h3">Opportunities</Text>
              <Text as="p" tone="subdued">{brief.opportunities}</Text>
            </BlockStack>
            {brief.recommendedActions.length > 0 && (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3">Recommended Actions</Text>
                  <BlockStack gap="150">
                    {brief.recommendedActions.map((item, i) => (
                      <InlineStack key={i} gap="200" blockAlign="start" wrap={false}>
                        <Box minWidth="60px">
                          <Badge tone={PRIORITY_TONE[item.priority] ?? "info"}>{item.priority.toUpperCase()}</Badge>
                        </Box>
                        <BlockStack gap="0">
                          <Text as="p" fontWeight="semibold">{item.action}</Text>
                          <Text as="p" tone="subdued" variant="bodySm">{item.reason}</Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
