import type { BadgeProps } from "@shopify/polaris";
import { normalizeTopicalMapPriority } from "@/lib/topical-map/priority";

export type Tone = BadgeProps["tone"];

// Meta/Google campaign delivery status. PAUSED is warning app-wide.
export function campaignStatusTone(s: string): Tone {
  if (s === "ENABLED" || s === "ACTIVE") return "success";
  if (s === "PAUSED") return "warning";
  if (s === "REMOVED") return "critical";
  return "info";
}

// Ad Approval workflow status (state machine).
export function adApprovalStatusTone(status: string): Tone {
  if (status === "approved_to_make_kwarta") return "success";
  if (status === "rejected" || status === "cancelled") return "critical";
  if (status === "needs_revision") return "warning";
  if (status === "draft") return undefined;
  return "info";
}

// Recommendation lifecycle status. rejected→warning is deliberate here (operator
// decision, not a failure) — distinct from ad-approval rejected→critical (terminal).
export function recommendationStatusTone(s: string): Tone {
  if (s === "executed") return "success";
  if (s === "failed") return "critical";
  if (s === "rejected") return "warning";
  if (s === "override_approved") return "attention";
  if (s === "executing") return "info";
  return undefined;
}

// P0–P3 priority.
export function priorityTone(p: string): Tone {
  const priority = normalizeTopicalMapPriority(p);
  if (priority === "high") return "critical";
  if (priority === "medium") return "attention";
  return "info";
}

export function severityTone(severity: string): Tone {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

// Outcome verdicts from check-outcomes (Verdict union in lib/recommendations/outcome-metrics.ts).
export function outcomeTone(verdict: string): Tone {
  if (verdict === "improved") return "success";
  if (verdict === "worsened") return "critical";
  if (verdict === "neutral") return "info";
  return "attention"; // insufficient_data / unknown
}
