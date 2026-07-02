// Shared helpers for the Ad Approval HTTP routes: auth/actor resolution,
// admin checks, approval loading, and audit-logged permission denials.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth, getSessionUser, authorizePermission, PERMISSIONS } from "@/lib/auth";
import type { AdApproval } from "@prisma/client";

export interface ActorContext {
  actor: string;
}

/** Verify session + resolve the actor. Returns a 401 NextResponse on failure. */
export async function resolveActor(req: Request): Promise<ActorContext | NextResponse> {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const actor = await getSessionUser(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { actor };
}

/** True if the actor holds the ad-approval admin permission. */
export async function isAdmin(req: Request): Promise<boolean> {
  const decision = await authorizePermission(req, PERMISSIONS.AD_APPROVAL_ADMIN);
  return decision.allowed;
}

export async function loadApproval(id: string): Promise<AdApproval | null> {
  return prisma.adApproval.findUnique({ where: { id } });
}

/** Write an append-only audit row for a denied action. */
export async function auditDenied(actor: string, action: string, id: string, reason: string): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        actor,
        action: "permission_denied",
        entityType: "ad_approval",
        entityId: id,
        after: { attemptedAction: action, reason },
      },
    })
    .catch((err) => console.error("[ad-approval] denied audit failed:", err));
}

/** Best-effort display name for a reviewer (falls back to the user id). */
export async function getDisplayName(actor: string): Promise<string> {
  const user = await prisma.appUser.findUnique({ where: { shopifyUserId: actor } });
  return user?.displayName?.trim() || actor;
}

/** Record an immutable human review row. */
export async function recordHumanReview(input: {
  approvalId: string;
  revisionNumber: number;
  stage: string;
  reviewerId: string;
  reviewerName: string;
  decision: string;
  score?: number | null;
  comments?: string | null;
  jsonMetadata?: object | null;
}): Promise<void> {
  await prisma.adReview.create({
    data: {
      approvalId: input.approvalId,
      revisionNumber: input.revisionNumber,
      stage: input.stage,
      reviewerType: "HUMAN",
      reviewerId: input.reviewerId,
      reviewerName: input.reviewerName,
      decision: input.decision,
      score: input.score ?? null,
      comments: input.comments ?? null,
      jsonMetadata: (input.jsonMetadata ?? undefined) as object | undefined,
    },
  });
}

export const forbidden = (permission?: string) =>
  NextResponse.json({ error: "Forbidden", ...(permission ? { permission } : {}) }, { status: 403 });

export const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export const conflict = (error: string) => NextResponse.json({ error }, { status: 409 });

export const badRequest = (error: string, details?: unknown) =>
  NextResponse.json({ error, ...(details ? { details } : {}) }, { status: 400 });
