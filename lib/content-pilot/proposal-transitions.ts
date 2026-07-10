import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  canEditContentProposal,
  canRejectContentProposal,
  CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES,
  CONTENT_PROPOSAL_PUBLISHABLE_STATUSES,
  reopenedContentProposalState,
} from "@/lib/content-pilot/proposal-state";
import {
  markContentProposalOpportunityDismissed,
  markContentProposalOpportunityRouted,
} from "@/lib/opportunities/content-proposal-outcomes";

type ContentProposalTransitionClient = {
  contentProposal: Pick<PrismaClient["contentProposal"], "findUnique" | "updateMany">;
  auditLog: Pick<PrismaClient["auditLog"], "create">;
  opportunity: Pick<PrismaClient["opportunity"], "updateMany">;
  contentProposalDraftHistory: Pick<PrismaClient["contentProposalDraftHistory"], "create">;
};

type ProposalTransitionProposal = NonNullable<
  Awaited<ReturnType<ContentProposalTransitionClient["contentProposal"]["findUnique"]>>
>;

type ProposalTransitionResult = {
  proposal: ProposalTransitionProposal;
};

export class ContentProposalConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ContentProposalConflictError";
  }
}

function throwNotFound(id: string): never {
  throw new Error(`Proposal not found: ${id}`);
}

function assertOptimisticTransition(updated: { count: number }, action: string) {
  if (updated.count === 0) {
    throw new ContentProposalConflictError(
      `Proposal was modified by another request while attempting to ${action}`,
    );
  }
}

type ProposalTransitionUpdateJsonValue = Prisma.InputJsonValue | Prisma.JsonNullValueInput;
type ProposalTransitionAuditJsonValue = Prisma.InputJsonValue | null;

function asUpdateJsonValue(value: unknown): ProposalTransitionUpdateJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function asAuditJsonValue(value: unknown): ProposalTransitionAuditJsonValue {
  if (value === undefined || value === null) {
    return null;
  }
  return value as Prisma.InputJsonValue;
}

export async function approveProposal(
  prismaClient: ContentProposalTransitionClient,
  input: {
    id: string;
    reviewedBy: string;
    reviewNote: string | null;
  },
): Promise<ProposalTransitionResult> {
  const existing = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!existing) throwNotFound(input.id);

  const updatedCount = await prismaClient.contentProposal.updateMany({
    where: { id: input.id, status: "pending" },
    data: {
      status: "approved",
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote,
    },
  });
  assertOptimisticTransition(updatedCount, "approve");

  const proposal = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposal) throwNotFound(input.id);

  await prismaClient.auditLog.create({
    data: {
      entityType: "ContentProposal",
      entityId: input.id,
      action: "approved",
      actor: input.reviewedBy,
      before: { status: existing.status },
      after: { status: "approved", reviewedBy: input.reviewedBy, reviewNote: input.reviewNote },
    },
  });

  return { proposal };
}

export async function rejectProposal(
  prismaClient: ContentProposalTransitionClient,
  input: {
    id: string;
    reviewedBy: string;
    reviewNote: string | null;
  },
): Promise<ProposalTransitionResult> {
  const proposal = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposal) throwNotFound(input.id);

  if (!canRejectContentProposal(proposal)) {
    throw new Error(
      `Cannot reject a proposal with status "${proposal.status}" and draft status "${proposal.draftStatus ?? "none"}"`,
    );
  }

  const updatedCount = await prismaClient.contentProposal.updateMany({
    where: {
      id: input.id,
      status: { not: "rejected" },
      OR: [
        { draftStatus: null },
        { draftStatus: { notIn: [...CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES] } },
      ],
    },
    data: {
      status: "rejected",
      draftStatus: "rejected",
      draftGenerationToken: null,
      draftGenerationStartedAt: null,
      publishOperationId: null,
      publishStartedAt: null,
      publishFinalizedAt: null,
      publishWarning: null,
      draftContent: Prisma.JsonNull,
      draftGeneratedAt: null,
      draftError: null,
      citations: Prisma.JsonNull,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote,
      scheduledPublishAt: null,
    },
  });
  assertOptimisticTransition(updatedCount, "reject");

  await markContentProposalOpportunityDismissed(
    { opportunity: (prismaClient as unknown as { opportunity: PrismaClient["opportunity"] }).opportunity },
    {
      proposalId: input.id,
      sourceData: proposal.sourceData,
    },
  );

  const updated = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!updated) throwNotFound(input.id);

  await prismaClient.auditLog.create({
    data: {
      entityType: "ContentProposal",
      entityId: input.id,
      action: "rejected",
      actor: input.reviewedBy,
      before: {
        status: proposal.status,
        draftStatus: proposal.draftStatus,
      },
      after: {
        status: "rejected",
        draftStatus: "rejected",
        reviewNote: input.reviewNote,
        scheduledPublishAt: null,
      },
    },
  });

  return { proposal: updated };
}

export async function reopenProposal(
  prismaClient: ContentProposalTransitionClient,
  input: {
    id: string;
    actor: string;
  },
): Promise<ProposalTransitionResult> {
  const proposal = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposal) throwNotFound(input.id);

  if (proposal.status !== "rejected") {
    throw new Error("Only rejected proposals can be re-opened");
  }

  const resetState = reopenedContentProposalState();

  const updatedCount = await prismaClient.contentProposal.updateMany({
    where: { id: input.id, status: "rejected" },
    data: {
      ...resetState,
      draftContent: asUpdateJsonValue(resetState.draftContent),
      citations: asUpdateJsonValue(resetState.citations),
    },
  });
  assertOptimisticTransition(updatedCount, "reopen");

  await markContentProposalOpportunityRouted(
    { opportunity: (prismaClient as unknown as { opportunity: PrismaClient["opportunity"] }).opportunity },
    {
      proposalId: input.id,
      sourceData: proposal.sourceData,
    },
  );

  const updated = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!updated) throwNotFound(input.id);

  await prismaClient.auditLog.create({
    data: {
      entityType: "ContentProposal",
      entityId: input.id,
      action: "proposal_reopened",
      actor: input.actor,
      before: { status: "rejected" },
      after: { status: "pending" },
    },
  });

  return { proposal: updated };
}

export async function editProposalDraft(
  prismaClient: ContentProposalTransitionClient,
  input: {
    id: string;
    actor: string;
    draftContent: unknown;
  },
): Promise<ProposalTransitionResult> {
  const proposal = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposal) throwNotFound(input.id);

  if (!canEditContentProposal(proposal)) {
    throw new Error(
      `Cannot edit proposal with status "${proposal.status}" and draft status "${proposal.draftStatus ?? "none"}"`,
    );
  }

  const updatedCount = await prismaClient.contentProposal.updateMany({
    where: {
      id: input.id,
      status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
      draftStatus: "ready",
    },
    data: {
      draftContent: asUpdateJsonValue(input.draftContent),
    },
  });
  assertOptimisticTransition(updatedCount, "edit draft");

  const proposalAfter = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposalAfter) throwNotFound(input.id);

  await prismaClient.contentProposalDraftHistory.create({
    data: {
      proposalId: input.id,
      savedBy: input.actor,
      draftContent: asUpdateJsonValue(input.draftContent),
      reason: "edited",
    },
  });

  await prismaClient.auditLog.create({
    data: {
      entityType: "ContentProposal",
      entityId: input.id,
      action: "draft_edited",
      actor: input.actor,
      before: { draftContent: asAuditJsonValue(proposal.draftContent) },
      after: { draftContent: asAuditJsonValue(input.draftContent) },
    },
  });

  return { proposal: proposalAfter };
}

export async function scheduleProposal(
  prismaClient: ContentProposalTransitionClient,
  input: {
    id: string;
    actor: string;
    scheduledPublishAt: Date | null;
  },
): Promise<ProposalTransitionResult> {
  const proposal = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!proposal) throwNotFound(input.id);

  const updatedCount = await prismaClient.contentProposal.updateMany({
    where: {
      id: input.id,
      status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
      draftStatus: "ready",
    },
    data: {
      scheduledPublishAt: input.scheduledPublishAt,
    },
  });
  assertOptimisticTransition(updatedCount, "schedule");

  const updated = await prismaClient.contentProposal.findUnique({ where: { id: input.id } });
  if (!updated) throwNotFound(input.id);

  await prismaClient.auditLog.create({
    data: {
      entityType: "ContentProposal",
      entityId: input.id,
      action: "scheduled",
      actor: input.actor,
      before: {
        scheduledPublishAt: proposal.scheduledPublishAt ? proposal.scheduledPublishAt.toISOString() : null,
      },
      after: {
        scheduledPublishAt: input.scheduledPublishAt ? input.scheduledPublishAt.toISOString() : null,
      },
    },
  });

  return { proposal: updated };
}
