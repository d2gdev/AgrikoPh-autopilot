"use client";

import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Badge,
  Banner,
  InlineStack,
  BlockStack,
  Divider,
  Toast,
  SkeletonDisplayText,
  SkeletonBodyText,
  Collapsible,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getStaleCache, setCache } from "@/lib/client-cache";
import {
  errorPanel,
  loadingPanel,
  panelFromCache,
  readyPanel,
  type PanelState,
} from "@/lib/dashboard/client-state";
import { StatGrid } from "@/components/ui/stat-grid";
import { timeAgo, actionLabel, formatPhp } from "@/lib/format";
import type {
  GscMover,
  DashboardData,
  FatigueItem,
  SearchTermItem,
  CompetitorItem,
  AuditEntry,
  AuditLogResponse,
  JobHistoryMap,
  SparklineDay,
  GscMoversPayload,
  ActivityPayload,
  AdTrendPoint,
  AdTrendPayload,
  PanelKey,
  JobRunStatus,
  ActiveRunState,
} from "./components/dashboard/types";
import {
  JOB_STATUS_CACHE_KEY,
  AUDIT_LOG_CACHE_KEY,
  JOB_HISTORY_CACHE_KEY,
  GSC_MOVERS_CACHE_KEY,
  ACTIVITY_SPARKLINE_CACHE_KEY,
  AD_REPORT_CACHE_KEY,
  ALL_PANEL_KEYS,
  TERMINAL_RUN_STATUSES,
  STALENESS_ORDER,
  stalenessTone,
  errorMessage,
  isAbortError,
  responseError,
  formatLoadedAt,
  hasGscMoverData,
  hasActivityData,
  hasAdTrendData,
  PanelNotice,
} from "./components/dashboard/helpers";
import { Sparkline } from "./components/dashboard/Sparkline";
import { TrendDots, JobRow, JobHealthSkeleton } from "./components/dashboard/JobHealth";
import { FatigueCard, SearchTermCard, CompetitorCard } from "./components/dashboard/InsightCards";

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <Card>
      <BlockStack gap="300">
        <SkeletonDisplayText size="small" />
        <SkeletonDisplayText size="large" />
      </BlockStack>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const authFetch = useAuthFetch();
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [statusPanel, setStatusPanel] = useState<PanelState<DashboardData>>(
    () => panelFromCache(getStaleCache<DashboardData>(JOB_STATUS_CACHE_KEY)),
  );
  const [auditPanel, setAuditPanel] = useState<PanelState<AuditEntry[]>>(
    () => panelFromCache(getStaleCache<AuditEntry[]>(AUDIT_LOG_CACHE_KEY), { isEmpty: (items) => items.length === 0 }),
  );
  const [jobHistoryPanel, setJobHistoryPanel] = useState<PanelState<JobHistoryMap>>(
    () => panelFromCache(getStaleCache<JobHistoryMap>(JOB_HISTORY_CACHE_KEY), { isEmpty: (history) => Object.keys(history).length === 0 }),
  );
  const [gscMoversPanel, setGscMoversPanel] = useState<PanelState<GscMoversPayload>>(
    () => panelFromCache(getStaleCache<GscMoversPayload>(GSC_MOVERS_CACHE_KEY), { isEmpty: (payload) => !hasGscMoverData(payload) }),
  );
  const [activityPanel, setActivityPanel] = useState<PanelState<ActivityPayload>>(
    () => panelFromCache(getStaleCache<ActivityPayload>(ACTIVITY_SPARKLINE_CACHE_KEY), { isEmpty: (payload) => !hasActivityData(payload) }),
  );
  const [adTrendPanel, setAdTrendPanel] = useState<PanelState<AdTrendPayload>>(
    () => panelFromCache(getStaleCache<AdTrendPayload>(AD_REPORT_CACHE_KEY), { isEmpty: (payload) => !hasAdTrendData(payload) }),
  );
  const [recAction, setRecAction] = useState<Record<string, "approving" | "rejecting" | "done">>({});
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);

  const load = useCallback(async (keys: PanelKey[] = ALL_PANEL_KEYS) => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMutationError(null);

    const isCurrent = () => requestSeqRef.current === requestSeq && !controller.signal.aborted;

    if (keys.includes("status")) setStatusPanel((previous) => loadingPanel(previous));
    if (keys.includes("audit")) setAuditPanel((previous) => loadingPanel(previous));
    if (keys.includes("jobHistory")) setJobHistoryPanel((previous) => loadingPanel(previous));
    if (keys.includes("gscMovers")) setGscMoversPanel((previous) => loadingPanel(previous));
    if (keys.includes("activity")) setActivityPanel((previous) => loadingPanel(previous));
    if (keys.includes("adTrend")) setAdTrendPanel((previous) => loadingPanel(previous));

    async function fetchJson<T>(url: string, fallback: string): Promise<T> {
      const res = await authFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(await responseError(res, fallback));
      return await res.json() as T;
    }

    const requests = keys.map(async (key) => {
      try {
        if (key === "status") {
          const next = await fetchJson<DashboardData>(JOB_STATUS_CACHE_KEY, "Status request failed");
          if (!isCurrent()) return;
          setCache(JOB_STATUS_CACHE_KEY, next);
          setStatusPanel(readyPanel(next));
          return;
        }

        if (key === "audit") {
          const result = await fetchJson<AuditLogResponse>(AUDIT_LOG_CACHE_KEY, "Audit log request failed");
          const next = result.items ?? result.logs ?? [];
          if (!isCurrent()) return;
          setCache(AUDIT_LOG_CACHE_KEY, next);
          setAuditPanel(readyPanel(next, { isEmpty: (items) => items.length === 0 }));
          return;
        }

        if (key === "jobHistory") {
          const result = await fetchJson<{ history: JobHistoryMap }>(JOB_HISTORY_CACHE_KEY, "Job history request failed");
          if (!isCurrent()) return;
          setCache(JOB_HISTORY_CACHE_KEY, result.history);
          setJobHistoryPanel(readyPanel(result.history, { isEmpty: (history) => Object.keys(history).length === 0 }));
          return;
        }

        if (key === "gscMovers") {
          const result = await fetchJson<GscMoversPayload>(GSC_MOVERS_CACHE_KEY, "GSC movers request failed");
          if (!isCurrent()) return;
          setCache(GSC_MOVERS_CACHE_KEY, result);
          setGscMoversPanel(readyPanel(result, { isEmpty: (payload) => !hasGscMoverData(payload) }));
          return;
        }

        if (key === "activity") {
          const result = await fetchJson<ActivityPayload>(ACTIVITY_SPARKLINE_CACHE_KEY, "Activity sparkline request failed");
          if (!isCurrent()) return;
          setCache(ACTIVITY_SPARKLINE_CACHE_KEY, result);
          setActivityPanel(readyPanel(result, { isEmpty: (payload) => !hasActivityData(payload) }));
          return;
        }

        const result = await fetchJson<{ trend?: AdTrendPoint[] }>(AD_REPORT_CACHE_KEY, "Ad trend request failed");
        const next = { trend: result.trend ?? [] };
        if (!isCurrent()) return;
        setCache(AD_REPORT_CACHE_KEY, next);
        setAdTrendPanel(readyPanel(next, { isEmpty: (payload) => !hasAdTrendData(payload) }));
      } catch (err) {
        if (isAbortError(err) || !isCurrent()) return;
        const message = errorMessage(err);
        console.error(`[dashboard] ${key} failed:`, err);
        if (key === "status") setStatusPanel((previous) => errorPanel(message, previous));
        if (key === "audit") setAuditPanel((previous) => errorPanel(message, previous));
        if (key === "jobHistory") setJobHistoryPanel((previous) => errorPanel(message, previous));
        if (key === "gscMovers") setGscMoversPanel((previous) => errorPanel(message, previous));
        if (key === "activity") setActivityPanel((previous) => errorPanel(message, previous));
        if (key === "adTrend") setAdTrendPanel((previous) => errorPanel(message, previous));
      }
    });

    await Promise.allSettled(requests);
  }, [authFetch]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!activeRun || TERMINAL_RUN_STATUSES.has(activeRun.status)) return;

    const controller = new AbortController();
    const id = setInterval(() => {
      void (async () => {
        try {
          const res = await authFetch(`/api/jobs/status?runId=${encodeURIComponent(activeRun.runId)}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(await responseError(res, "Run status request failed"));
          const next = await res.json() as JobRunStatus;
          setActiveRun({
            runId: next.id,
            label: next.label ?? next.jobName,
            status: next.status,
            error: next.errorLog,
          });
          if (TERMINAL_RUN_STATUSES.has(next.status)) {
            setToast(next.status === "failed"
              ? `${next.label ?? next.jobName} failed`
              : `${next.label ?? next.jobName} finished with ${next.status}`);
            void load();
          }
        } catch (err) {
          if (isAbortError(err)) return;
          setActiveRun((current) => current
            ? { ...current, error: errorMessage(err) }
            : current);
        }
      })();
    }, 3000);

    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [activeRun?.runId, activeRun?.status, authFetch, load]);

  async function triggerAll() {
    setTriggering(true);
    try {
      const res = await authFetch("/api/jobs/trigger", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setMutationError(d.error ?? `Trigger failed (${res.status})`);
        return;
      }
      const d = await res.json() as { queued?: boolean; newRecs?: number; runId?: string; status?: string; label?: string; jobName?: string };
      void load();
      if (d.runId) {
        setActiveRun({
          runId: d.runId,
          label: d.label ?? d.jobName ?? "Dashboard refresh",
          status: d.status ?? "queued",
          error: null,
        });
      }
      setToast(d.queued
        ? "Dashboard refresh queued"
        : (d.newRecs ?? 0) > 0
          ? `${d.newRecs!} new recommendation${d.newRecs !== 1 ? "s" : ""} generated`
          : "Analysis complete — no new recommendations");
    } finally {
      setTriggering(false);
    }
  }

  async function triggerJob(jobName: string) {
    try {
      const res = await authFetch("/api/jobs/trigger-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobName }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setToast(`Failed to trigger ${jobName}: ${d.error ?? res.status}`);
        return;
      }
      const d = await res.json().catch(() => ({})) as { runId?: string; status?: string; label?: string };
      if (d.runId) {
        setActiveRun({
          runId: d.runId,
          label: d.label ?? jobName,
          status: d.status ?? "queued",
          error: null,
        });
      }
      setToast(`${d.label ?? jobName} triggered`);
      setTimeout(() => { void load(); }, 3000);
    } catch (err) {
      setToast(`Error: ${errorMessage(err)}`);
    }
  }

  async function approveRec(id: string) {
    setRecAction((s) => ({ ...s, [id]: "approving" }));
    try {
      const res = await authFetch(`/api/recommendations/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(await responseError(res, res.status === 409 ? "Approve conflict" : "Approve failed"));
      setRecAction((s) => ({ ...s, [id]: "done" }));
      void load();
    } catch (err) {
      setToast(`Approve failed: ${errorMessage(err)}`);
      setRecAction((s) => { const n = { ...s }; delete n[id]; return n; });
    }
  }

  async function rejectRec(id: string) {
    setRecAction((s) => ({ ...s, [id]: "rejecting" }));
    try {
      const res = await authFetch(`/api/recommendations/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error(await responseError(res, res.status === 409 ? "Reject conflict" : "Reject failed"));
      setRecAction((s) => ({ ...s, [id]: "done" }));
      void load();
    } catch (err) {
      setToast(`Reject failed: ${errorMessage(err)}`);
      setRecAction((s) => { const n = { ...s }; delete n[id]; return n; });
    }
  }

  const retryPanel = useCallback((key: PanelKey) => { void load([key]); }, [load]);
  const data = statusPanel.data;
  const logs = auditPanel.data ?? [];
  const jobHistory = jobHistoryPanel.data ?? {};
  const gscMovers = gscMoversPanel.data;
  const activityDays = activityPanel.data?.days ?? [];
  const adTrend = adTrendPanel.data?.trend ?? [];
  const loading = statusPanel.status === "loading" && !data;
  const loadError = statusPanel.status === "error" ? statusPanel.error : null;
  const spend = data?.adSpendSummary;
  const spendSign = (spend?.delta ?? 0) >= 0 ? "+" : "";
  const contentLiftValue = data?.contentLift?.avgLiftPts ?? 0;
  const contentLiftSign = contentLiftValue > 0 ? "+" : "";
  const totalActionsThisMonth = data?.recsByActionType?.reduce((s, r) => s + r.count, 0) ?? 0;

  // Sorted job health — critical first
  const sortedJobs = [...(data?.perJobHealth ?? [])].sort(
    (a, b) => STALENESS_ORDER[stalenessTone(a.lastSuccessAt)] - STALENESS_ORDER[stalenessTone(b.lastSuccessAt)],
  );

  const criticalJobs = sortedJobs.filter((j) => stalenessTone(j.lastSuccessAt) === "critical");

  return (
    <>
      <Page
        title="Autopilot Dashboard"
        primaryAction={
          <Button onClick={triggerAll} loading={triggering} variant="primary">
            Run Now
          </Button>
        }
      >
        <Layout>
          {loadError && (
            <Layout.Section>
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p">Failed to load dashboard data: {loadError}</Text>
                  <InlineStack>
                    <Button size="slim" onClick={() => void load(["status"])}>Retry status</Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {statusPanel.status === "stale" && data && (
            <Layout.Section>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p">
                    Showing stale dashboard status from {formatLoadedAt(statusPanel.loadedAt)}.
                    {statusPanel.error ? ` Refresh failed: ${statusPanel.error}` : ""}
                  </Text>
                  <InlineStack>
                    <Button size="slim" onClick={() => void load(["status"])}>Retry status</Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {mutationError && (
            <Layout.Section>
              <Banner tone="critical" onDismiss={() => setMutationError(null)}>
                {mutationError}
              </Banner>
            </Layout.Section>
          )}

          {activeRun && !TERMINAL_RUN_STATUSES.has(activeRun.status) && (
            <Layout.Section>
              <Banner tone={activeRun.error ? "warning" : "info"}>
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    {activeRun.label} is {activeRun.status}
                  </Text>
                  <Text as="p" tone="subdued">
                    Polling run status from /api/jobs/status.
                    {activeRun.error ? ` Last poll error: ${activeRun.error}` : ""}
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {/* ── Stale job alert banner ── */}
          {data && criticalJobs.length > 0 && (
            <Layout.Section>
              <Banner tone="critical">
                <Text as="p" fontWeight="semibold">
                  {`${criticalJobs.length} job${criticalJobs.length !== 1 ? "s" : ""} missed 2+ cycles: ${criticalJobs.map((j) => j.label ?? j.jobName).join(", ")}`}
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {/* ── Pending rec inbox ── */}
          {(data?.topPendingRecs?.length ?? 0) > 0 && (
            <>
              <Layout.Section>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">
                      Pending Review ({data!.pendingCount})
                    </Text>
                    <BlockStack gap="300">
                      {data!.topPendingRecs!.map((rec) => {
                        const state = recAction[rec.id];
                        const busy = state === "approving" || state === "rejecting";
                        if (state === "done") return null;
                        return (
                          <BlockStack key={rec.id} gap="150">
                            <InlineStack align="space-between" blockAlign="start">
                              <BlockStack gap="100">
                                <InlineStack gap="200">
                                  <Text as="p" fontWeight="semibold">{actionLabel(rec.actionType)}</Text>
                                  <Text as="p" tone="subdued">—</Text>
                                  <Text as="p">{rec.targetEntityName}</Text>
                                  {rec.guardStatus !== "clear" && (
                                    <Badge tone={rec.guardStatus === "hard_block" ? "critical" : "warning"}>
                                      {rec.guardStatus.replace(/_/g, " ")}
                                    </Badge>
                                  )}
                                </InlineStack>
                                <Text as="p" tone="subdued">{rec.rationale}</Text>
                                {rec.estimatedImpact && (
                                  <Text as="p" tone="subdued">{rec.estimatedImpact}</Text>
                                )}
                              </BlockStack>
                              <InlineStack gap="200">
                                <Button
                                  size="slim"
                                  variant="primary"
                                  loading={state === "approving"}
                                  disabled={busy || rec.guardStatus === "hard_block"}
                                  onClick={() => approveRec(rec.id)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="slim"
                                  loading={state === "rejecting"}
                                  disabled={busy}
                                  onClick={() => rejectRec(rec.id)}
                                >
                                  Reject
                                </Button>
                              </InlineStack>
                            </InlineStack>
                            <Divider />
                          </BlockStack>
                        );
                      })}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section><Divider /></Layout.Section>
            </>
          )}

          {/* ── Operations row ── */}
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Operations</Text>
              <StatGrid>
                {loading ? (
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
                ) : (
                  <>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Pending</Text>
                        <Link href="/recommendations" style={{ textDecoration: "none", color: "inherit" }}>
                          <Text variant="heading2xl" as="p">{data?.pendingCount ?? "—"}</Text>
                        </Link>
                        {(data?.hardBlockedCount ?? 0) > 0 && (
                          <Badge tone="critical">{`${data!.hardBlockedCount} hard blocked`}</Badge>
                        )}
                        {(data?.recsPendingOver7Days ?? 0) > 0 && (
                          <Badge tone="warning">{`${data!.recsPendingOver7Days} stale >7d`}</Badge>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Executed This Month</Text>
                        <Link href="/ad-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                          <Text variant="heading2xl" as="p">{data?.executedThisMonth ?? "—"}</Text>
                        </Link>
                        {data?.estimatedValueExecuted != null && (
                          <Text as="p" tone="subdued">
                            est. {formatPhp(data.estimatedValueExecuted, 0)} impact
                          </Text>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Failed / Override</Text>
                        <Link href="/recommendations" style={{ textDecoration: "none", color: "inherit" }}>
                          <InlineStack gap="200" blockAlign="end">
                            <Text variant="heading2xl" as="p">{data?.failedCount ?? "—"}</Text>
                            <Text as="p" tone="subdued">/ {data?.overrideCount ?? "—"}</Text>
                          </InlineStack>
                        </Link>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Last Job Run</Text>
                        {data?.lastJobRun ? (
                          <BlockStack gap="100">
                            <Text as="p">{data.lastJobRun.jobName.replace(/-/g, " ")}</Text>
                            <Badge tone={["success", "partial"].includes(data.lastJobRun.status) ? "success" : "critical"}>
                              {data.lastJobRun.status}
                            </Badge>
                            <Text as="p" tone="subdued">{timeAgo(data.lastJobRun.startedAt)}</Text>
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">Never run</Text>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Outcome Win Rate (90d)</Text>
                        {data?.outcomeWinRate ? (
                          <BlockStack gap="100">
                            <Text variant="heading2xl" as="p">
                              {Math.round((data.outcomeWinRate.improved / data.outcomeWinRate.total) * 100)}%
                            </Text>
                            <Text as="p" tone="subdued">
                              {data.outcomeWinRate.improved} improved · {data.outcomeWinRate.worsened} worsened · {Math.max(0, data.outcomeWinRate.total - data.outcomeWinRate.improved - data.outcomeWinRate.worsened)} neutral/insufficient · {data.outcomeWinRate.total} checked
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">No outcomes checked yet</Text>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}
              </StatGrid>
            </BlockStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Performance row ── */}
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Performance</Text>
              <StatGrid>
                {loading ? (
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
                ) : (
                  <>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Ad Spend (Latest)</Text>
                        <Link href="/ad-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                          <Text variant="heading2xl" as="p">
                            {spend && spend.current > 0 ? formatPhp(spend.current, 0) : "—"}
                          </Text>
                        </Link>
                        {spend && spend.previous > 0 && (
                          <Text as="p" tone={spend.delta <= 0 ? "success" : "critical"}>
                            {spendSign}{formatPhp(spend.delta, 0)}
                            {spend.deltaPct != null && ` (${spendSign}${spend.deltaPct.toFixed(1)}%)`}
                            {" vs prior"}
                          </Text>
                        )}
                        {totalActionsThisMonth > 0 && (spend?.delta ?? 0) !== 0 && (
                          <Text as="p" tone="subdued">
                            {`${totalActionsThisMonth} action${totalActionsThisMonth !== 1 ? "s" : ""} taken this month`}
                          </Text>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Revenue vs Meta (period)</Text>
                        {data?.revenueVsMeta ? (
                          <BlockStack gap="100">
                            <Text variant="heading2xl" as="p">{formatPhp(data.revenueVsMeta.shopifyRevenue, 0)}</Text>
                            <Text as="p" tone="subdued">
                              Shopify ({data.revenueVsMeta.daysCovered}d) vs {data.revenueVsMeta.metaConversionValue != null ? formatPhp(data.revenueVsMeta.metaConversionValue, 0) : "—"} Meta-reported
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">No sales data yet — runs after the first fetch-orders cycle</Text>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Content Pilot</Text>
                        <Link href="/content-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                          <InlineStack gap="500">
                            <BlockStack gap="100">
                              <Text variant="headingLg" as="p">{data?.contentPilotStats.pending ?? "—"}</Text>
                              <Text as="p" tone="subdued">pending</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text variant="headingLg" as="p">{data?.contentPilotStats.drafting ?? "—"}</Text>
                              <Text as="p" tone="subdued">drafting</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text variant="headingLg" as="p">{data?.contentPilotStats.publishedThisMonth ?? "—"}</Text>
                              <Text as="p" tone="subdued">published</Text>
                            </BlockStack>
                          </InlineStack>
                        </Link>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Actions This Month</Text>
                        {!data?.recsByActionType?.length ? (
                          <Text as="p" tone="subdued">None yet</Text>
                        ) : (
                          <BlockStack gap="100">
                            {data.recsByActionType.map((r) => (
                              <InlineStack key={r.actionType} align="space-between">
                                <Text as="p">{actionLabel(r.actionType)}</Text>
                                <Badge>{String(r.count)}</Badge>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">GSC Movers</Text>
                        <PanelNotice
                          panel={gscMoversPanel}
                          label="GSC movers"
                          staleLabel="GSC mover data"
                          onRetry={() => retryPanel("gscMovers")}
                        />
                        {gscMoversPanel.status === "loading" && !gscMovers ? (
                          <SkeletonBodyText lines={3} />
                        ) : !gscMovers || (gscMovers.risers.length === 0 && gscMovers.fallers.length === 0) ? (
                          <Text as="p" tone="subdued">No GSC snapshots with movement yet.</Text>
                        ) : (
                          <BlockStack gap="150">
                            {gscMovers.risers.map((m) => (
                              <InlineStack key={`r-${m.query}`} align="space-between">
                                <Text as="p">{m.query}</Text>
                                <Badge tone="success">{`+${m.clicksDelta} clicks`}</Badge>
                              </InlineStack>
                            ))}
                            {gscMovers.fallers.map((m) => (
                              <InlineStack key={`f-${m.query}`} align="space-between">
                                <Text as="p">{m.query}</Text>
                                <Badge tone="critical">{`${m.clicksDelta} clicks`}</Badge>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}
              </StatGrid>
            </BlockStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Intel row ── */}
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Intel</Text>
              <StatGrid>
                {loading ? (
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
                ) : (
                  <>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Opportunities</Text>
                        {(() => {
                          const o = data?.openOpportunities ?? { high: 0, medium: 0, low: 0 };
                          const total = o.high + o.medium + o.low;
                          if (total === 0) return <Text as="p" tone="subdued">None open</Text>;
                          return (
                            <InlineStack gap="300">
                              {o.high > 0 && <Badge tone="critical">{`${o.high} high`}</Badge>}
                              {o.medium > 0 && <Badge tone="warning">{`${o.medium} medium`}</Badge>}
                              {o.low > 0 && <Badge>{`${o.low} low`}</Badge>}
                            </InlineStack>
                          );
                        })()}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Market Insights</Text>
                        {(() => {
                          const mi = data?.openMarketInsights ?? { critical: 0, warning: 0, info: 0 };
                          const total = mi.critical + mi.warning + mi.info;
                          if (total === 0) return <Text as="p" tone="subdued">No open insights</Text>;
                          return (
                            <InlineStack gap="300">
                              {mi.critical > 0 && <Badge tone="critical">{`${mi.critical} critical`}</Badge>}
                              {mi.warning > 0 && <Badge tone="warning">{`${mi.warning} warning`}</Badge>}
                              {mi.info > 0 && <Badge>{`${mi.info} info`}</Badge>}
                            </InlineStack>
                          );
                        })()}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Store Tasks</Text>
                        <Text variant="heading2xl" as="p">{data?.pendingStoreTasks ?? "—"}</Text>
                        <Text as="p" tone="subdued">pending</Text>
                        {data?.dbLatencyMs != null && (
                          <Text
                            as="p"
                            tone={data.dbLatencyMs < 100 ? "success" : data.dbLatencyMs < 500 ? undefined : "critical"}
                          >
                            DB {data.dbLatencyMs}ms
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}
              </StatGrid>
            </BlockStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Skill Insights ── */}
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Skill Insights</Text>
              <StatGrid>
                {loading ? (
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
                ) : (() => {
                  const insights = data?.latestInsights ?? [];
                  const fatigue = insights.find((i) => i.insightType === "fatigue-report");
                  const searchTerms = insights.find((i) => i.insightType === "search-term-opportunities");
                  const competitors = insights.find((i) => i.insightType === "competitor-analysis");
                  return (
                    <>
                      <FatigueCard
                        items={(fatigue?.items ?? []) as FatigueItem[]}
                        updatedAt={fatigue?.createdAt ?? null}
                      />
                      <SearchTermCard
                        items={(searchTerms?.items ?? []) as SearchTermItem[]}
                        updatedAt={searchTerms?.createdAt ?? null}
                      />
                      <CompetitorCard
                        items={(competitors?.items ?? []) as CompetitorItem[]}
                        updatedAt={competitors?.createdAt ?? null}
                      />
                    </>
                  );
                })()}
              </StatGrid>
            </BlockStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Job Health ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Job Health</Text>
                  <Text as="p" tone="subdued">
                    Row colour: green = on track, amber = one cycle missed (&gt;26h), red = two+ cycles missed (&gt;50h). Dots = last 7 runs, newest right.
                  </Text>
                </BlockStack>
                <PanelNotice
                  panel={jobHistoryPanel}
                  label="Job history"
                  staleLabel="Job history"
                  onRetry={() => retryPanel("jobHistory")}
                />
                {loading ? (
                  <JobHealthSkeleton />
                ) : !sortedJobs.length ? (
                  <Text as="p" tone="subdued">No job history yet.</Text>
                ) : (
                  <BlockStack gap="150">
                    {sortedJobs.map((job) => (
                      <JobRow
                        key={job.jobName}
                        job={job}
                        history={jobHistory[job.jobName] ?? []}
                        onTrigger={triggerJob}
                        onToast={setToast}
                      />
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Trends ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Trends</Text>
                <PanelNotice
                  panel={activityPanel}
                  label="Activity trend"
                  staleLabel="Activity trend"
                  onRetry={() => retryPanel("activity")}
                />
                <PanelNotice
                  panel={adTrendPanel}
                  label="Ad spend trend"
                  staleLabel="Ad spend trend"
                  onRetry={() => retryPanel("adTrend")}
                />
                <StatGrid>
                  <BlockStack gap="150">
                    <Text as="p" fontWeight="semibold">Activity (30d)</Text>
                    {activityPanel.status === "loading" && activityDays.length === 0 ? (
                      <SkeletonBodyText lines={2} />
                    ) : activityDays.length > 0 && hasActivityData({ days: activityDays }) ? (
                      <>
                        <Sparkline data={activityDays.map((d) => d.count)} color="#2c6ecb" label="Activity events over the last 30 days" />
                        <Text as="p" tone="subdued">
                          {activityDays.reduce((s, d) => s + d.count, 0)} events
                        </Text>
                      </>
                    ) : (
                      <Text as="p" tone="subdued">No audit events in the activity window.</Text>
                    )}
                  </BlockStack>

                  <BlockStack gap="150">
                    <Text as="p" fontWeight="semibold">Ad Spend trend</Text>
                    {adTrendPanel.status === "loading" && adTrend.length === 0 ? (
                      <SkeletonBodyText lines={2} />
                    ) : adTrend.length > 0 ? (
                      <>
                        <Sparkline data={adTrend.map((t) => t.spend)} color="#008060" label="Ad spend snapshots" />
                        <Text as="p" tone="subdued">
                          {`${adTrend.length} snapshots · latest ROAS ${adTrend[adTrend.length - 1]?.roas?.toFixed(2) ?? "—"}x`}
                        </Text>
                      </>
                    ) : (
                      <Text as="p" tone="subdued">No ad snapshots available yet.</Text>
                    )}
                  </BlockStack>

                  {data?.contentLift && (
                    <BlockStack gap="150">
                      <Text as="p" fontWeight="semibold">Content SEO lift</Text>
                      <Text variant="headingLg" as="p">
                        {`${contentLiftSign}${contentLiftValue.toFixed(1)} pts`}
                      </Text>
                      <Text as="p" tone="subdued">
                        avg across {data.contentLift.count} re-scored article{data.contentLift.count !== 1 ? "s" : ""}
                      </Text>
                    </BlockStack>
                  )}
                </StatGrid>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Recent Activity ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Recent Activity</Text>
                <PanelNotice
                  panel={auditPanel}
                  label="Recent activity"
                  staleLabel="Recent activity"
                  onRetry={() => retryPanel("audit")}
                />
                {auditPanel.status === "loading" && logs.length === 0 ? (
                  <SkeletonBodyText lines={4} />
                ) : logs.length === 0 ? (
                  <Text as="p" tone="subdued">No audit events yet. Run a job or review a recommendation to create activity.</Text>
                ) : (
                  <BlockStack gap="200">
                    {logs.slice(0, 10).map((log) => (
                      <InlineStack key={log.id} align="space-between">
                        <InlineStack gap="200">
                          <Badge tone={log.actor === "user" ? "info" : "new"}>{log.actor}</Badge>
                          <Text as="p">{actionLabel(log.action)}</Text>
                          <Text as="p" tone="subdued">{log.entityType}</Text>
                        </InlineStack>
                        <Text as="p" tone="subdued">{timeAgo(log.createdAt)}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
