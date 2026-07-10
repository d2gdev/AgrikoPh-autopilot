import { Prisma } from "@prisma/client";

export const CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES = ["publishing", "published"] as const;
export const CONTENT_PROPOSAL_PUBLISHABLE_STATUSES = ["approved", "override_approved"] as const;

export function isContentProposalStatusPublishable(status: string | null | undefined): boolean {
  return CONTENT_PROPOSAL_PUBLISHABLE_STATUSES.includes(
    status as (typeof CONTENT_PROPOSAL_PUBLISHABLE_STATUSES)[number],
  );
}

export function canGenerateContentProposal(proposal: { status?: string | null }): boolean {
  return isContentProposalStatusPublishable(proposal.status);
}

export function canEditContentProposal(proposal: {
  status?: string | null;
  draftStatus?: string | null;
}): boolean {
  return isContentProposalStatusPublishable(proposal.status) && proposal.draftStatus === "ready";
}

export function reopenedContentProposalState() {
  return {
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    draftStatus: null,
    draftContent: Prisma.JsonNull,
    draftError: null,
    draftGeneratedAt: null,
    citations: Prisma.JsonNull,
    scheduledPublishAt: null,
    // These operation fields are persisted after Task 3 adds their nullable
    // schema columns. Keeping the pure reset complete prevents a reopened
    // proposal from carrying stale lifecycle state once that migration lands.
    draftGenerationToken: null,
    draftGenerationStartedAt: null,
    publishOperationId: null,
    publishStartedAt: null,
    publishFinalizedAt: null,
    publishWarning: null,
  } as const;
}

export function canRejectContentProposal(proposal: {
  status?: string | null;
  draftStatus?: string | null;
}): boolean {
  if (proposal.status === "rejected") return false;
  return !CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES.includes(
    proposal.draftStatus as (typeof CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES)[number]
  );
}
