// Ad Approval state machine — the single chokepoint for every status change.
// Enforces the allowed-transition table AND optimistic locking (version CAS)
// in one atomic updateMany, mirroring the recommendations approve/reject
// pattern (app/api/recommendations/[id]/approve/route.ts). Every successful
// transition writes an append-only AuditLog row (entityType "ad_approval").

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTransitionAllowed } from "./constants";

type Client = typeof prisma | Prisma.TransactionClient;

export interface TransitionInput {
  approvalId: string;
  /** Expected current status (compare-and-swap guard). */
  from: string;
  /** Target status. */
  to: string;
  /** Expected current version (optimistic lock). */
  version: number;
  /** Actor for the audit log ("system", "AI-<agent>", or a Shopify user id). */
  actor: string;
  /** Audit action verb, e.g. "STATUS_CHANGED", "SUBMITTED", "APPROVED". */
  action: string;
  comment?: string | null;
  details?: Record<string, unknown>;
  /** Extra columns to set alongside the status change (e.g. assigned reviewer, approvedAt). */
  data?: Prisma.AdApprovalUpdateManyMutationInput;
  /** Optional transaction client; defaults to the shared prisma singleton. */
  client?: Client;
}

export type TransitionResult =
  | { ok: true; version: number }
  | { ok: false; reason: "invalid_transition" | "lost_race" };

/**
 * Attempt an atomic, audited state transition. Returns { ok: false } instead of
 * throwing so callers can map the reason to the right response (HTTP 409 for a
 * lost race, 400/blocked for an invalid edge).
 */
export async function transition(input: TransitionInput): Promise<TransitionResult> {
  const { approvalId, from, to, version, actor, action, comment, details, data, client } = input;
  const db = client ?? prisma;

  if (!isTransitionAllowed(from, to)) {
    return { ok: false, reason: "invalid_transition" };
  }

  const nextVersion = version + 1;
  const locked = await db.adApproval.updateMany({
    where: { id: approvalId, status: from, version },
    data: {
      ...data,
      status: to,
      version: nextVersion,
      updatedAt: new Date(),
    },
  });

  if (locked.count === 0) {
    return { ok: false, reason: "lost_race" };
  }

  await db.auditLog.create({
    data: {
      actor,
      action,
      entityType: "ad_approval",
      entityId: approvalId,
      before: { status: from },
      after: { status: to },
      meta: {
        ...(details ?? {}),
        ...(comment ? { comment } : {}),
      },
    },
  });

  return { ok: true, version: nextVersion };
}

/**
 * Flag an approval as requiring manual intervention (spec §Failure Handling,
 * §Role Requirement Enforcement). Does not change status. Idempotent-ish:
 * overwrites the flags blob. Writes an audit row.
 */
export async function flagForManualIntervention(input: {
  approvalId: string;
  reason: string;
  actor?: string;
  severity?: string;
  client?: Client;
}): Promise<void> {
  const db = input.client ?? prisma;
  await db.adApproval.update({
    where: { id: input.approvalId },
    data: { flags: { requires_manual_intervention: true, reason: input.reason } },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor ?? "system",
      action: "REQUIRES_MANUAL_INTERVENTION",
      entityType: "ad_approval",
      entityId: input.approvalId,
      after: { requires_manual_intervention: true },
      meta: { reason: input.reason, severity: input.severity ?? "critical" },
    },
  });
}
