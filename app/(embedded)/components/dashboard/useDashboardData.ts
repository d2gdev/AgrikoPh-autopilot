import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getStaleCache, setCache } from "@/lib/client-cache";
import {
  errorPanel,
  loadingPanel,
  panelFromCache,
  readyPanel,
  type PanelState,
} from "@/lib/dashboard/client-state";
import type {
  DashboardData,
  AuditEntry,
  AuditLogResponse,
  JobHistoryMap,
  GscMoversPayload,
  ActivityPayload,
  AdTrendPoint,
  AdTrendPayload,
  PanelKey,
  JobRunStatus,
  ActiveRunState,
} from "./types";
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
  hasGscMoverData,
  hasActivityData,
  hasAdTrendData,
} from "./helpers";

// ── Dashboard data-loading hook ─────────────────────────────────────────────
// Verbatim body relocated from app/(embedded)/page.tsx (Phase 8b, Task 5).

export function useDashboardData() {
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

  return {
    statusPanel,
    auditPanel,
    jobHistoryPanel,
    gscMoversPanel,
    activityPanel,
    adTrendPanel,
    recAction,
    triggering,
    toast,
    setToast,
    mutationError,
    setMutationError,
    activeRun,
    load,
    triggerAll,
    triggerJob,
    approveRec,
    rejectRec,
    retryPanel,
    data,
    logs,
    jobHistory,
    gscMovers,
    activityDays,
    adTrend,
    loading,
    loadError,
    spend,
    spendSign,
    contentLiftValue,
    contentLiftSign,
    totalActionsThisMonth,
    sortedJobs,
    criticalJobs,
  };
}
