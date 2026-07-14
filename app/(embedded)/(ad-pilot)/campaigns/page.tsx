"use client";

import {
  Page, Layout, Card, Text, Badge, Tabs, EmptyState, Button, Banner,
  BlockStack, InlineStack, Spinner, Collapsible, Box, Divider, Toast, Icon,
} from "@shopify/polaris";
import { AlertTriangleIcon, CashDollarIcon, CheckIcon, XIcon } from "@shopify/polaris-icons";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch, withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { ApproveConfirmationModal } from "@/components/ui/approve-confirmation-modal";
import { timeAgo, formatPhp, fmtNum, actionLabel } from "@/lib/format";
import { campaignStatusTone } from "@/lib/ui/tones";
import { ListSkeleton } from "@/components/ui/states";

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  budget: string;
  spend7d: string;
  spendValue: number;
  impressions: number;
  clicks: number;
  ctr: string;
  conversions: number;
  conversionValue: number;
  cpa: string;
  roas: string;
  roasValue: number | null;
  pendingRecs: number;
}

interface Rec {
  id: string;
  skillName: string;
  actionType: string;
  targetEntityName: string;
  targetEntityType: string;
  currentValue: string | null;
  proposedValue: string | null;
  changePercent: number | null;
  rationale: string;
  estimatedImpact: string | null;
  guardStatus: string;
  guardReason: string | null;
  confidenceScore: number | null;
}

const PLATFORM_TABS = [{ id: "meta", content: "Meta Ads" }];
const ROAS_THRESHOLD = 0.7;

// ── Helpers ──────────────────────────────────────────────────────────

function roasTone(v: number | null): "success" | "warning" | "critical" | "info" {
  if (v === null) return "info";
  if (v >= 1.0)  return "success";
  if (v >= ROAS_THRESHOLD) return "warning";
  return "critical";
}

function roasBarColor(v: number | null): string {
  if (v === null) return "var(--p-color-icon-secondary)";
  if (v >= 1.0)  return "var(--p-color-bg-fill-success)";
  if (v >= ROAS_THRESHOLD) return "var(--p-color-bg-fill-warning)";
  return "var(--p-color-bg-fill-critical)";
}

function actionTone(t: string): "critical" | "warning" | "attention" | "info" {
  if (t === "pause_campaign") return "critical";
  if (t === "pause_ad") return "warning";
  if (t === "adjust_budget") return "attention";
  return "info";
}

function sortCampaigns(campaigns: Campaign[]): Campaign[] {
  return [...campaigns].sort((a, b) => {
    // Active campaigns with pending recs and bad ROAS → top
    const aPriority = a.pendingRecs > 0 && a.status !== "PAUSED" ? 0 : 1;
    const bPriority = b.pendingRecs > 0 && b.status !== "PAUSED" ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    // Then worst ROAS first (null = no spend = last)
    if (a.roasValue === null && b.roasValue === null) return 0;
    if (a.roasValue === null) return 1;
    if (b.roasValue === null) return -1;
    return a.roasValue - b.roasValue;
  });
}

// ── Metric tile ───────────────────────────────────────────────────────

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="p" variant="bodyMd" fontWeight="semibold">{value}</Text>
      {sub && <Text as="p" variant="bodySm" tone="subdued">{sub}</Text>}
    </BlockStack>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────

function ConfBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 85 ? "var(--p-color-bg-fill-success)"
    : pct >= 65 ? "var(--p-color-bg-fill-warning)"
    : "var(--p-color-icon-secondary)";
  return (
    <InlineStack gap="150" blockAlign="center">
      <div style={{ width: 48, height: 4, borderRadius: 2, background: "var(--p-color-bg-fill-tertiary)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <Text as="span" variant="bodySm" tone="subdued">{pct}% conf</Text>
    </InlineStack>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const authFetch = useAuthFetch();
  const router = useRouter();

  const [selected, setSelected] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [campaignRecs, setCampaignRecs] = useState<Record<string, Rec[]>>({});
  const [recsLoading, setRecsLoading] = useState<Set<string>>(new Set());
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ rec: Rec; campaignId: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: { rec: Rec; campaignId: string } } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const platform = PLATFORM_TABS[selected]!.id;

  const load = useCallback((bust = false) => {
    const cacheKey = `/api/campaigns?platform=${platform}`;
    if (!bust) {
      const cached = getCache<{ campaigns: Campaign[]; fetchedAt: string }>(cacheKey);
      if (cached) {
        setCampaigns(cached.campaigns ?? []);
        setFetchedAt(cached.fetchedAt ?? null);
        setLoading(false);
        return;
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    authFetch(cacheKey, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json(); })
      .then((d) => { setCache(cacheKey, d); setCampaigns(d.campaigns ?? []); setFetchedAt(d.fetchedAt ?? null); setError(null); })
      .catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { clearTimeout(timeout); setLoading(false); setRefreshing(false); });
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLoading(true); load(); }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  async function toggleRecs(campaignId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
    if (!campaignRecs[campaignId] && !recsLoading.has(campaignId)) {
      setRecsLoading((prev) => new Set(prev).add(campaignId));
      try {
        const res = await authFetch(`/api/recommendations?status=pending&targetEntityId=${campaignId}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setCampaignRecs((prev) => ({ ...prev, [campaignId]: data.recommendations ?? [] }));
        }
      } finally {
        setRecsLoading((prev) => { const n = new Set(prev); n.delete(campaignId); return n; });
      }
    }
  }

  function removeRecFromCampaign(recId: string, campaignId: string) {
    setCampaignRecs((prev) => ({ ...prev, [campaignId]: (prev[campaignId] ?? []).filter((r) => r.id !== recId) }));
    setCampaigns((prev) => prev.map((c) => c.id === campaignId ? { ...c, pendingRecs: Math.max(0, c.pendingRecs - 1) } : c));
  }

  function restoreRecToCampaign(rec: Rec, campaignId: string) {
    setCampaignRecs((prev) => ({ ...prev, [campaignId]: [rec, ...(prev[campaignId] ?? []).filter((r) => r.id !== rec.id)] }));
    setCampaigns((prev) => prev.map((c) => c.id === campaignId ? { ...c, pendingRecs: c.pendingRecs + 1 } : c));
  }

  async function approve(rec: Rec, campaignId: string) {
    setApprovingId(rec.id);
    setActionError(null);
    try {
      const res = await authFetch(`/api/recommendations/${rec.id}/approve`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? `Error ${res.status}`); }
      removeRecFromCampaign(rec.id, campaignId);
      setConfirmTarget(null);
      setToast({ message: "Approved — queued for live execution", undo: { rec, campaignId } });
    } catch (err) {
      setConfirmTarget(null);
      setActionError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function reject(rec: Rec, campaignId: string) {
    setRejectingId(rec.id);
    setActionError(null);
    try {
      const res = await authFetch(`/api/recommendations/${rec.id}/reject`, { method: "POST", body: JSON.stringify({ note: "Rejected from campaigns view" }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? `Error ${res.status}`); }
      removeRecFromCampaign(rec.id, campaignId);
      setToast({ message: "Recommendation rejected", undo: { rec, campaignId } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setRejectingId(null);
    }
  }

  async function undoReview(rec: Rec, campaignId: string) {
    setUndoing(true);
    try {
      const res = await authFetch(`/api/recommendations/${rec.id}/revert`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? `Undo failed (${res.status})`); }
      restoreRecToCampaign(rec, campaignId);
      setToast({ message: "Decision reverted — back in pending" });
    } catch (err) {
      setToast(null);
      setActionError(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const totalSpend = campaigns.reduce((s, c) => s + c.spendValue, 0);
  const totalConversionValue = campaigns.reduce((s, c) => s + (c.conversionValue ?? 0), 0);
  const blendedRoas = totalSpend > 0 ? totalConversionValue / totalSpend : null;
  const activeCount = campaigns.filter((c) => c.status === "ENABLED" || c.status === "ACTIVE").length;
  const pausedCount = campaigns.filter((c) => c.status === "PAUSED").length;
  const belowThreshold = campaigns.filter((c) => c.roasValue !== null && c.roasValue < ROAS_THRESHOLD).length;
  const totalPending = campaigns.reduce((s, c) => s + c.pendingRecs, 0);

  const sorted = sortCampaigns(campaigns);

  return (
    <Page
      title="Campaigns"
      primaryAction={{ content: refreshing ? "Refreshing…" : "Refresh", onAction: handleRefresh, loading: refreshing, disabled: loading }}
    >
      <Layout>
        <Layout.Section>
          <Tabs tabs={PLATFORM_TABS} selected={selected} onSelect={(v) => { setSelected(v); setExpanded(new Set()); }} />
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to load campaigns" onDismiss={() => setError(null)}>
              <Text as="p">{error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {actionError && (
          <Layout.Section>
            <Banner tone="critical" title="Action failed" onDismiss={() => setActionError(null)}>
              <Text as="p">{actionError}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ── Summary bar ─────────────────────────────────────────── */}
        {!loading && campaigns.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm" fontWeight="semibold">Account overview · 7 days</Text>
                  {fetchedAt && <Text as="p" variant="bodySm" tone="subdued">Updated {timeAgo(fetchedAt)}</Text>}
                </InlineStack>
                <Divider />
                <InlineStack gap="800" wrap>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Total spend</Text>
                    <Text as="p" variant="headingMd">{formatPhp(totalSpend)}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Revenue</Text>
                    <Text as="p" variant="headingMd">{formatPhp(totalConversionValue)}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Blended ROAS</Text>
                    <Badge tone={roasTone(blendedRoas)} size="large">
                      {blendedRoas !== null ? blendedRoas.toFixed(2) + "x" : "—"}
                    </Badge>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Campaigns</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="success">{`${activeCount} active`}</Badge>
                      {pausedCount > 0 && <Badge tone="warning">{`${pausedCount} paused`}</Badge>}
                    </InlineStack>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Below {ROAS_THRESHOLD}x ROAS</Text>
                    <Text as="p" variant="headingMd">{belowThreshold} campaign{belowThreshold !== 1 ? "s" : ""}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Pending actions</Text>
                    <Text as="p" variant="headingMd">{totalPending}</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ── Campaign list ────────────────────────────────────────── */}
        <Layout.Section>
          {loading ? (
            <Card><ListSkeleton lines={6} /></Card>
          ) : campaigns.length === 0 ? (
            <EmptyState
              heading="No campaign data yet"
              image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
            >
              <Text as="p">Run the analyzer from the Dashboard to fetch Meta campaign data.</Text>
            </EmptyState>
          ) : (
            <BlockStack gap="400">
              {sorted.map((c) => {
                const isOpen = expanded.has(c.id);
                const recs = campaignRecs[c.id] ?? [];
                const loadingRecs = recsLoading.has(c.id);
                const tone = roasTone(c.roasValue);
                const barColor = roasBarColor(c.roasValue);

                return (
                  <Card key={c.id} padding="0">
                    {/* Colored ROAS bar */}
                    <div style={{ height: 5, background: barColor, borderRadius: "12px 12px 0 0" }} />

                    <Box padding="400">
                      <BlockStack gap="400">

                        {/* ── Header ─────────────────────────────────── */}
                        <InlineStack align="space-between" blockAlign="start" wrap={false}>
                          <BlockStack gap="150">
                            <Text as="h2" variant="headingMd" fontWeight="bold">{c.name}</Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={campaignStatusTone(c.status)}>{c.status}</Badge>
                              {c.objective && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {String(c.objective).replace(/_/g, " ").toLowerCase()}
                                </Text>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <BlockStack gap="200" inlineAlign="end">
                            <Badge tone={tone} size="large">
                              {`ROAS ${c.roas}`}
                            </Badge>
                            {c.pendingRecs > 0 && (
                              <Button
                                size="slim"
                                tone="critical"
                                disclosure={isOpen ? "up" : "down"}
                                onClick={() => toggleRecs(c.id)}
                              >
                                {`${c.pendingRecs} pending action${c.pendingRecs !== 1 ? "s" : ""}`}
                              </Button>
                            )}
                          </BlockStack>
                        </InlineStack>

                        {/* ── Metrics grid ───────────────────────────── */}
                        <Box
                          background="bg-surface-secondary"
                          borderRadius="200"
                          padding="300"
                        >
                          <InlineStack gap="600" wrap>
                            <MetricTile label="Daily budget" value={c.budget} />
                            <MetricTile label="Spend (7d)" value={c.spend7d} />
                            <MetricTile
                              label="Impressions"
                              value={fmtNum(c.impressions)}
                            />
                            <MetricTile label="CTR" value={c.ctr} />
                            <MetricTile label="Conversions" value={String(c.conversions)} />
                            <MetricTile label="CPA" value={c.cpa} />
                          </InlineStack>
                        </Box>

                        {/* ── Inline recommendations ─────────────────── */}
                        {c.pendingRecs > 0 && (
                          <Collapsible
                            open={isOpen || loadingRecs}
                            id={`recs-${c.id}`}
                            transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                          >
                            <BlockStack gap="300">
                              <Divider />
                              <Text as="p" variant="bodyMd" fontWeight="semibold" tone="subdued">
                                Pending recommendations ({c.pendingRecs})
                              </Text>
                              {loadingRecs ? (
                                <InlineStack gap="200" blockAlign="center">
                                  <Spinner size="small" />
                                  <Text as="p" variant="bodySm" tone="subdued">Loading…</Text>
                                </InlineStack>
                              ) : recs.length === 0 ? (
                                <Text as="p" variant="bodySm" tone="subdued">No pending recommendations found.</Text>
                              ) : (
                                <BlockStack gap="300">
                                  {recs.map((rec) => (
                                    <Box
                                      key={rec.id}
                                      background="bg-surface-secondary"
                                      borderRadius="200"
                                      padding="400"
                                      borderWidth="025"
                                      borderColor="border"
                                    >
                                      <BlockStack gap="300">
                                        {/* Rec header */}
                                        <InlineStack align="space-between" blockAlign="start" wrap={false}>
                                          <BlockStack gap="150">
                                            <InlineStack gap="200" blockAlign="center" wrap>
                                              <Badge tone={actionTone(rec.actionType)}>
                                                {actionLabel(rec.actionType)}
                                              </Badge>
                                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                                {rec.targetEntityName}
                                              </Text>
                                            </InlineStack>
                                            <Text as="span" variant="bodySm" tone="subdued">
                                              via {rec.skillName}
                                            </Text>
                                          </BlockStack>
                                          <BlockStack gap="100" inlineAlign="end">
                                            <ConfBar score={rec.confidenceScore} />
                                            {rec.guardStatus === "hard_block" && (
                                              <Badge tone="critical">Hard Block</Badge>
                                            )}
                                            {rec.guardStatus === "soft_flag" && (
                                              <Badge tone="warning">Soft Flag</Badge>
                                            )}
                                          </BlockStack>
                                        </InlineStack>

                                        {/* Rationale */}
                                        <Box
                                          background="bg-surface"
                                          borderRadius="100"
                                          padding="300"
                                          borderWidth="025"
                                          borderColor="border-secondary"
                                        >
                                          <Text as="p" variant="bodySm">{rec.rationale}</Text>
                                        </Box>

                                        {/* Impact */}
                                        {rec.estimatedImpact && (
                                          <InlineStack gap="150" blockAlign="center">
                                            <Icon source={CashDollarIcon} tone="subdued" />
                                            <Text as="span" variant="bodySm" fontWeight="semibold">
                                              {rec.estimatedImpact}
                                            </Text>
                                          </InlineStack>
                                        )}

                                        {/* Guard warning */}
                                        {rec.guardStatus === "soft_flag" && rec.guardReason && (
                                          <Box
                                            background="bg-surface-caution"
                                            borderRadius="100"
                                            padding="200"
                                          >
                                            <InlineStack gap="100" blockAlign="start" wrap={false}>
                                              <Icon source={AlertTriangleIcon} tone="caution" />
                                              <Text as="p" variant="bodySm">{rec.guardReason}</Text>
                                            </InlineStack>
                                          </Box>
                                        )}

                                        {/* Actions */}
                                        <InlineStack gap="200">
                                          {rec.guardStatus === "hard_block" ? (
                                            <Button
                                              size="slim"
                                              onClick={() => router.push(withShopifyContextUrl("/recommendations"))}
                                            >
                                              Override on Recommendations tab →
                                            </Button>
                                          ) : (
                                            <>
                                              <Button
                                                size="slim"
                                                variant="primary"
                                                icon={CheckIcon}
                                                loading={approvingId === rec.id}
                                                disabled={rejectingId !== null}
                                                onClick={() => setConfirmTarget({ rec, campaignId: c.id })}
                                              >
                                                Approve
                                              </Button>
                                              <Button
                                                size="slim"
                                                icon={XIcon}
                                                loading={rejectingId === rec.id}
                                                disabled={approvingId !== null}
                                                onClick={() => reject(rec, c.id)}
                                              >
                                                Reject
                                              </Button>
                                            </>
                                          )}
                                        </InlineStack>
                                      </BlockStack>
                                    </Box>
                                  ))}
                                </BlockStack>
                              )}
                            </BlockStack>
                          </Collapsible>
                        )}
                      </BlockStack>
                    </Box>
                  </Card>
                );
              })}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>

      <ApproveConfirmationModal
        rec={confirmTarget?.rec ?? null}
        open={confirmTarget !== null}
        loading={approvingId !== null}
        onConfirm={() => { if (confirmTarget) approve(confirmTarget.rec, confirmTarget.campaignId); }}
        onCancel={() => { if (approvingId === null) setConfirmTarget(null); }}
      />

      {toast && (
        <Toast
          content={toast.message}
          duration={8000}
          onDismiss={() => setToast(null)}
          action={toast.undo ? {
            content: undoing ? "Undoing…" : "Undo",
            onAction: () => { if (!undoing && toast.undo) undoReview(toast.undo.rec, toast.undo.campaignId); },
          } : undefined}
        />
      )}
    </Page>
  );
}
