import { createHash } from "node:crypto";
import type {
  SeoTaskBucket,
  SeoTaskEvidenceStatus,
  SeoTaskSourceType,
  SeoTaskStatus,
  SeoTaskType,
} from "./contracts";

export type SeoTaskState = {
  status: SeoTaskStatus;
  earliestReviewAt: Date;
  requiresEvidence: boolean;
  evidenceStatus: SeoTaskEvidenceStatus;
  evidenceSnapshot: unknown | null;
  dueAt: Date | null;
};

export function deriveSeoTaskBucket(
  task: Pick<SeoTaskState, "status" | "earliestReviewAt" | "requiresEvidence" | "evidenceStatus" | "evidenceSnapshot">,
  now: Date,
): SeoTaskBucket {
  if (task.status === "completed" || task.status === "cancelled") return "closed";
  if (task.earliestReviewAt.getTime() > now.getTime()) return "scheduled";
  if (task.requiresEvidence
    && task.evidenceStatus === "sufficient"
    && task.evidenceSnapshot !== null) return "ready";
  if (!task.requiresEvidence && task.evidenceStatus === "not_required") return "ready";
  return "waiting";
}

export function isSeoTaskOverdue(
  task: Pick<SeoTaskState, "status" | "dueAt">,
  now: Date,
): boolean {
  return task.status === "open"
    && task.dueAt !== null
    && task.dueAt.getTime() < now.getTime();
}

export type SeoTaskDedupeInput = {
  taskType: SeoTaskType;
  sourceType: SeoTaskSourceType;
  sourceKey: string;
};

function canonical(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildSeoTaskDedupeKey(input: SeoTaskDedupeInput): string {
  const semanticKey = [
    input.taskType,
    input.sourceType,
    canonical(input.sourceKey),
  ].join("\u001f");
  return `seo-follow-up:${createHash("sha256").update(semanticKey).digest("hex")}`;
}
