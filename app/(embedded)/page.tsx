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

// ── Types ─────────────────────────────────────────────────────────────────────

interface PerJobHealth {
  jobName: string;
  label?: string;
  manualTriggerEnabled?: boolean;
  manualTriggerDisabledReason?: string | null;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  queuedCount?: number;
  oldestQueuedAt?: string | null;
  errorExcerpt: string | null;
}

interface GscMover {
  query: string;
  clicks: number;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number;
  direction: "up" | "down";
}

interface DashboardData {
  pendingCount: number;
  hardBlockedCount: number;
  executedThisMonth: number;
  failedCount: number;
  overrideCount: number;
  lastJobRun: { jobName: string; status: string; startedAt: string; summary: Record<string, unknown> | null } | null;
  perJobHealth: PerJobHealth[];
  contentPilotStats: { pending: number; drafting: number; publishedThisMonth: number };
  adSpendSummary: { current: number; previous: number; delta: number; deltaPct: number | null };
  recsByActionType: Array<{ actionType: string; count: number }>;
  estimatedValueExecuted: number | null;
  latestInsights?: Array<{ insightType: string; skillId: string; createdAt: string; items: unknown[] }>;
  openOpportunities?: { high: number; medium: number; low: number };
  openMarketInsights?: { critical: number; warning: number; info: number };
  pendingStoreTasks?: number;
  topPendingRecs?: Array<{
    id: string;
    actionType: string;
    targetEntityName: string;
    rationale: string;
    estimatedImpact: string | null;
    guardStatus: string;
  }>;
  recsPendingOver7Days?: number;
  contentLift?: { count: number; avgLiftPts: number } | null;
  dbLatencyMs?: number;
}

interface FatigueItem {
  adId: string;
  adName: string;
  adSetName: string;
  status: "urgent" | "warning" | "healthy" | "dead";
  frequency: number;
  ctrChange7d: number;
  daysRunning: number;
  estimatedDaysLeft: number | null;
  rationale: string;
}

interface SearchTermItem {
  searchTerm: string;
  theme: string;
  impressions: number;
  clicks: number;
  conversions: number;
  currentCpaPHP: number | null;
  recommendedMatchType: string;
  recommendedBidPHP: number | null;
  suggestedAdGroup: string | null;
  isNegativeKeyword: boolean;
}

interface CompetitorItem {
  competitor: string;
  activeAdCount: number;
  dominantFormat: string;
  messagingThemes: string[];
  primaryCta: string;
  recentLaunches7d: number;
  gaps: string[];
  recommendedTests: string[];
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  after: Record<string, unknown> | null;
}

interface AuditLogResponse {
  items?: AuditEntry[];
  logs?: AuditEntry[];
}

type JobRunEntry = { status: string; startedAt: string };
type JobHistoryMap = Record<string, JobRunEntry[]>;
type SparklineDay = { date: string; count: number };
type GscMoversPayload = { risers: GscMover[]; fallers: GscMover[]; fetchedAt: string | null };
type ActivityPayload = { days: SparklineDay[]; timezone?: string; generatedAt?: string };
type AdTrendPoint = { date: string; spend: number; roas: number };
type AdTrendPayload = { trend: AdTrendPoint[] };
type PanelKey = "status" | "audit" | "jobHistory" | "gscMovers" | "activity" | "adTrend";

interface JobRunStatus {
  id: string;
  jobName: string;
  status: string;
  completedAt: string | null;
  errorLog: string | null;
  label?: string;
}

interface ActiveRunState {
  runId: string;
  label: string;
  status: string;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_STATUS_CACHE_KEY = "/api/jobs/status";
const AUDIT_LOG_CACHE_KEY = "/api/audit-log?limit=10";
const JOB_HISTORY_CACHE_KEY = "/api/dashboard/job-history";
const GSC_MOVERS_CACHE_KEY = "/api/dashboard/gsc-movers";
const ACTIVITY_SPARKLINE_CACHE_KEY = "/api/dashboard/activity-sparkline";
const AD_REPORT_CACHE_KEY = "/api/ad-pilot/report";
const ALL_PANEL_KEYS: PanelKey[] = ["status", "audit", "jobHistory", "gscMovers", "activity", "adTrend"];
const TERMINAL_RUN_STATUSES = new Set(["success", "partial", "failed", "cancelled", "canceled"]);

const STATUS_DOT_COLOR: Record<string, string> = {
  success: "#008060",
  partial: "#ffc453",
  failed: "#d72c0d",
  queued: "#2c6ecb",
  running: "#2c6ecb",
};

const STALENESS_ORDER: Record<"critical" | "warning" | "success", number> = {
  critical: 0,
  warning: 1,
  success: 2,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "unknown time";
  const diff = Date.now() - time;
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const suffix = diff < 0 ? " from now" : " ago";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m${suffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${suffix}`;
  return `${Math.floor(hrs / 24)}d${suffix}`;
}

function stalenessTone(lastSuccessAt: string | null): "success" | "warning" | "critical" {
  if (!lastSuccessAt) return "critical";
  const hrs = (Date.now() - new Date(lastSuccessAt).getTime()) / 3600000;
  if (hrs < 26) return "success";
  if (hrs < 50) return "warning";
  return "critical";
}

function stalenessStyle(tone: "success" | "warning" | "critical"): React.CSSProperties {
  if (tone === "success") return { backgroundColor: "#f1f8f5", borderRadius: 8 };
  if (tone === "warning") return { backgroundColor: "#fff5ea", borderRadius: 8 };
  return { backgroundColor: "#fff4f4", borderRadius: 8 };
}

function actionLabel(s: string) {
  return s.replace(/_/g, " ");
}

function formatPhp(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError";
}

async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({})) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

function formatLoadedAt(iso: string | null) {
  if (!iso) return "not loaded";
  return new Date(iso).toLocaleString();
}

function domId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function hasGscMoverData(data: GscMoversPayload) {
  return data.risers.length > 0 || data.fallers.length > 0;
}

function hasActivityData(data: ActivityPayload) {
  return data.days.some((day) => day.count > 0);
}

function hasAdTrendData(data: AdTrendPayload) {
  return data.trend.length > 0;
}

function PanelNotice<T>({
  panel,
  label,
  staleLabel,
  onRetry,
}: {
  panel: PanelState<T>;
  label: string;
  staleLabel?: string;
  onRetry: () => void;
}) {
  if (panel.status !== "error" && !(panel.status === "stale" && panel.error)) return null;

  return (
    <Banner tone={panel.status === "error" ? "critical" : "warning"}>
      <BlockStack gap="200">
        <Text as="p">
          {panel.status === "error"
            ? `${label} could not load: ${panel.error ?? "Unknown error"}`
            : `${staleLabel ?? label} is stale. Refresh failed: ${panel.error ?? "Unknown error"}`}
        </Text>
        <InlineStack>
          <Button size="slim" onClick={onRetry}>Retry</Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Sparkline({ data, color = "#2c6ecb", label }: { data: number[]; color?: string; label: string }) {
  const max = Math.max(...data, 1);
  const total = data.reduce((sum, value) => sum + value, 0);
  return (
    <div
      role="img"
      aria-label={`${label}. ${data.length} points, total ${total}, high ${max}.`}
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40, minWidth: 160 }}
    >
      {data.map((v, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            flex: 1,
            height: `${Math.round((v / max) * 40)}px`,
            backgroundColor: v === 0 ? "#e4e5e7" : color,
            borderRadius: 2,
            minHeight: v > 0 ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}

function TrendDots({ runs }: { runs: JobRunEntry[] }) {
  if (runs.length === 0) return <Text as="span" tone="subdued">no history</Text>;
  const ordered = [...runs].reverse();
  const summary = `Last ${ordered.length} runs: ${ordered.map((run) => `${run.status} ${timeAgo(run.startedAt)}`).join(", ")}`;
  return (
    <InlineStack gap="050" blockAlign="center">
      <span role="img" aria-label={summary} style={{ display: "inline-flex", gap: 4 }}>
      {ordered.map((run, i) => (
        <span
          key={i}
          title={`${run.status} — ${timeAgo(run.startedAt)}`}
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: STATUS_DOT_COLOR[run.status] ?? "#8c9196",
            flexShrink: 0,
          }}
        />
      ))}
      </span>
    </InlineStack>
  );
}

function JobRow({
  job,
  history,
  onTrigger,
  onToast,
}: {
  job: PerJobHealth;
  history: JobRunEntry[];
  onTrigger: (jobName: string) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = stalenessTone(job.lastSuccessAt);
  const panelId = `job-${domId(job.jobName)}`;

  const statusTone =
    job.lastStatus === "success" ? "success"
    : job.lastStatus === "partial" ? "warning"
    : job.lastStatus === "failed" ? "critical"
    : job.lastStatus === "queued" || (job.queuedCount ?? 0) > 0 ? "info"
    : "new";

  return (
    <div style={{ ...stalenessStyle(tone), padding: "12px 16px" }}>
      <BlockStack gap="200">
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Collapse" : "Expand"} details for ${job.label ?? job.jobName}`}
        >
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="300" blockAlign="center">
              <Text as="p" fontWeight="semibold">{job.label ?? job.jobName}</Text>
              <Badge tone={statusTone as "success" | "warning" | "critical" | "new" | "info"}>
                {job.lastStatus ?? "never run"}
              </Badge>
              <TrendDots runs={history} />
            </InlineStack>
            <InlineStack gap="300" blockAlign="center">
              {(job.queuedCount ?? 0) > 0 && (
                <Text as="p" tone="subdued">Queued: {job.queuedCount}</Text>
              )}
              <Text as="p" tone="subdued">
                {job.lastStartedAt ? timeAgo(job.lastStartedAt) : "never run"}
              </Text>
              <Text as="p" tone="subdued">{open ? "▲" : "▼"}</Text>
            </InlineStack>
          </InlineStack>
        </button>

        <Collapsible id={panelId} open={open}>
          <BlockStack gap="200">
            <InlineStack gap="400" align="space-between" blockAlign="center">
              <InlineStack gap="400">
                <Text as="p" tone="subdued">
                  Last success: {job.lastSuccessAt ? timeAgo(job.lastSuccessAt) : "never"}
                </Text>
                {job.lastStartedAt && (
                  <Text as="p" tone="subdued">
                    Last run: {new Date(job.lastStartedAt).toLocaleString()}
                  </Text>
                )}
              </InlineStack>
              <Button
                size="slim"
                disabled={job.manualTriggerEnabled === false}
                onClick={() => onTrigger(job.jobName)}
              >
                Run now
              </Button>
            </InlineStack>
            {job.manualTriggerEnabled === false && (
              <Text as="p" tone="subdued">
                {job.manualTriggerDisabledReason ?? "Manual trigger is unavailable for this job."}
              </Text>
            )}
            {job.errorExcerpt && (
              <BlockStack gap="100">
                <pre
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    background: "#fff4f4",
                    padding: "8px 12px",
                    borderRadius: 4,
                    margin: 0,
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                >
                  {job.errorExcerpt}
                </pre>
                <Button
                  size="slim"
                  onClick={() => {
                    void navigator.clipboard.writeText(job.errorExcerpt!)
                      .then(() => {
                        setCopied(true);
                        onToast("Error copied to clipboard");
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch((err) => {
                        onToast(`Copy failed: ${errorMessage(err)}`);
                      });
                  }}
                >
                  {copied ? "Copied!" : "Copy error"}
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </div>
  );
}

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

function JobHealthSkeleton() {
  return (
    <BlockStack gap="200">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ padding: "12px 16px", backgroundColor: "#f6f6f7", borderRadius: 8 }}>
          <SkeletonBodyText lines={1} />
        </div>
      ))}
    </BlockStack>
  );
}

// ── Skill Insight cards ───────────────────────────────────────────────────────

const FATIGUE_TONE: Record<string, "critical" | "warning" | "success" | "subdued"> = {
  urgent: "critical",
  warning: "warning",
  healthy: "success",
  dead: "subdued",
};

function FatigueCard({ items, updatedAt }: { items: FatigueItem[]; updatedAt: string | null }) {
  const counts = { urgent: 0, warning: 0, healthy: 0, dead: 0 };
  for (const item of items) {
    if (item.status in counts) counts[item.status as keyof typeof counts]++;
  }
  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Creative Fatigue</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            {(["urgent", "warning", "healthy", "dead"] as const).map((s) =>
              counts[s] > 0 ? (
                <InlineStack key={s} align="space-between">
                  <Text as="p">{s}</Text>
                  <Badge tone={FATIGUE_TONE[s] as "critical" | "warning" | "success"}>{String(counts[s])}</Badge>
                </InlineStack>
              ) : null
            )}
            <Text as="p" tone="subdued">{items.length} ad{items.length !== 1 ? "s" : ""} analysed</Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function SearchTermCard({ items, updatedAt }: { items: SearchTermItem[]; updatedAt: string | null }) {
  const opportunities = items.filter((i) => !i.isNegativeKeyword);
  const negatives = items.filter((i) => i.isNegativeKeyword);
  const themes = Array.from(
    opportunities.reduce((m, i) => {
      m.set(i.theme, (m.get(i.theme) ?? 0) + 1);
      return m;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Search Opportunities</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            <InlineStack align="space-between">
              <Text as="p">New keywords</Text>
              <Badge tone="success">{String(opportunities.length)}</Badge>
            </InlineStack>
            {negatives.length > 0 && (
              <InlineStack align="space-between">
                <Text as="p">Negatives to add</Text>
                <Badge tone="warning">{String(negatives.length)}</Badge>
              </InlineStack>
            )}
            {themes.slice(0, 3).map(([theme, count]) => (
              <InlineStack key={theme} align="space-between">
                <Text as="p" tone="subdued">{theme}</Text>
                <Text as="p" tone="subdued">{String(count)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function CompetitorCard({ items, updatedAt }: { items: CompetitorItem[]; updatedAt: string | null }) {
  const totalGaps = items.reduce((n, c) => n + (c.gaps?.length ?? 0), 0);
  const recentActivity = items.filter((c) => c.recentLaunches7d > 0);

  return (
    <Card>
      <BlockStack gap="200">
        <BlockStack gap="050">
          <Text variant="headingMd" as="h2">Competitor Pulse</Text>
          {updatedAt && <Text as="p" tone="subdued">{timeAgo(updatedAt)}</Text>}
        </BlockStack>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">No data yet</Text>
        ) : (
          <BlockStack gap="150">
            {items.map((c) => (
              <InlineStack key={c.competitor} align="space-between">
                <Text as="p">{c.competitor}</Text>
                <InlineStack gap="200">
                  <Text as="p" tone="subdued">{c.activeAdCount} ads</Text>
                  {c.recentLaunches7d > 0 && (
                    <Badge tone="warning">{`+${c.recentLaunches7d} this week`}</Badge>
                  )}
                </InlineStack>
              </InlineStack>
            ))}
            {totalGaps > 0 && (
              <Text as="p" tone="subdued">{totalGaps} whitespace gap{totalGaps !== 1 ? "s" : ""} identified</Text>
            )}
            {recentActivity.length === 0 && (
              <Text as="p" tone="subdued">No competitor activity this week</Text>
            )}
          </BlockStack>
        )}
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

          {/* ── Operations row ── */}
          <Layout.Section>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Operations</Text>
              <StatGrid>
                {loading ? (
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
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
                            est. {formatPhp(data.estimatedValueExecuted)} impact
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
                  <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
                ) : (
                  <>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h2">Ad Spend (Latest)</Text>
                        <Link href="/ad-pilot" style={{ textDecoration: "none", color: "inherit" }}>
                          <Text variant="heading2xl" as="p">
                            {spend && spend.current > 0 ? formatPhp(spend.current) : "—"}
                          </Text>
                        </Link>
                        {spend && spend.previous > 0 && (
                          <Text as="p" tone={spend.delta <= 0 ? "success" : "critical"}>
                            {spendSign}{formatPhp(spend.delta)}
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

          {/* ── Pending rec inbox ── */}
          {(data?.topPendingRecs?.length ?? 0) > 0 && (
            <>
              <Layout.Section><Divider /></Layout.Section>
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
            </>
          )}

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
