import { Banner, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import type { PanelState } from "@/lib/dashboard/client-state";
import type { GscMoversPayload, ActivityPayload, AdTrendPayload, PanelKey } from "./types";

export const JOB_STATUS_CACHE_KEY = "/api/jobs/status";
export const AUDIT_LOG_CACHE_KEY = "/api/audit-log?limit=10";
export const JOB_HISTORY_CACHE_KEY = "/api/dashboard/job-history";
export const GSC_MOVERS_CACHE_KEY = "/api/dashboard/gsc-movers";
export const ACTIVITY_SPARKLINE_CACHE_KEY = "/api/dashboard/activity-sparkline";
export const AD_REPORT_CACHE_KEY = "/api/ad-pilot/report";
export const ALL_PANEL_KEYS: PanelKey[] = ["status", "audit", "jobHistory", "gscMovers", "activity", "adTrend"];
export const TERMINAL_RUN_STATUSES = new Set(["success", "partial", "failed", "cancelled", "canceled"]);

export const STATUS_DOT_COLOR: Record<string, string> = {
  success: "var(--p-color-bg-fill-success)",
  partial: "var(--p-color-bg-fill-warning)",
  failed: "var(--p-color-bg-fill-critical)",
  queued: "var(--p-color-bg-fill-info)",
  running: "var(--p-color-bg-fill-info)",
};

export const STALENESS_ORDER: Record<"critical" | "warning" | "success", number> = {
  critical: 0,
  warning: 1,
  success: 2,
};

export function stalenessTone(lastSuccessAt: string | null): "success" | "warning" | "critical" {
  if (!lastSuccessAt) return "critical";
  const hrs = (Date.now() - new Date(lastSuccessAt).getTime()) / 3600000;
  if (hrs < 26) return "success";
  if (hrs < 50) return "warning";
  return "critical";
}

export function stalenessStyle(tone: "success" | "warning" | "critical"): React.CSSProperties {
  if (tone === "success") return { backgroundColor: "var(--p-color-bg-surface-success)", borderRadius: 8 };
  if (tone === "warning") return { backgroundColor: "var(--p-color-bg-surface-warning)", borderRadius: 8 };
  return { backgroundColor: "var(--p-color-bg-surface-critical)", borderRadius: 8 };
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError";
}

export async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({})) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

export function formatLoadedAt(iso: string | null) {
  if (!iso) return "not loaded";
  return new Date(iso).toLocaleString();
}

export function domId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function hasGscMoverData(data: GscMoversPayload) {
  return data.risers.length > 0 || data.fallers.length > 0;
}

export function hasActivityData(data: ActivityPayload) {
  return data.days.some((day) => day.count > 0);
}

export function hasAdTrendData(data: AdTrendPayload) {
  return data.trend.length > 0;
}

export function PanelNotice<T>({
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
