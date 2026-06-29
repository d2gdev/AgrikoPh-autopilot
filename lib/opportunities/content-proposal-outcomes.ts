import type { PrismaClient } from "@prisma/client";

type ContentProposalOpportunityClient = Pick<PrismaClient, "opportunity">;

export type ContentProposalOutcomeInput = {
  id: string;
  status?: string | null;
  draftStatus?: string | null;
  sourceData?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function opportunityWhereForContentProposal(input: {
  proposalId: string;
  sourceData?: unknown;
}) {
  const sourceData = asRecord(input.sourceData);
  const opportunityId = typeof sourceData.opportunityId === "string" && sourceData.opportunityId.trim()
    ? sourceData.opportunityId
    : null;

  return {
    OR: [
      { routedToType: "ContentProposal", routedToId: input.proposalId },
      ...(opportunityId ? [{ id: opportunityId }] : []),
    ],
  };
}

export async function markContentProposalOpportunityDismissed(
  prismaClient: ContentProposalOpportunityClient,
  input: { proposalId: string; sourceData?: unknown },
) {
  return prismaClient.opportunity.updateMany({
    where: opportunityWhereForContentProposal(input),
    data: {
      status: "dismissed",
      resolvedAt: new Date(),
      routedToType: "ContentProposal",
      routedToId: input.proposalId,
    },
  });
}

export async function markContentProposalOpportunityResolved(
  prismaClient: ContentProposalOpportunityClient,
  input: { proposalId: string; sourceData?: unknown },
) {
  return prismaClient.opportunity.updateMany({
    where: opportunityWhereForContentProposal(input),
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      routedToType: "ContentProposal",
      routedToId: input.proposalId,
    },
  });
}

export async function markContentProposalOpportunityRouted(
  prismaClient: ContentProposalOpportunityClient,
  input: { proposalId: string; sourceData?: unknown },
) {
  return prismaClient.opportunity.updateMany({
    where: opportunityWhereForContentProposal(input),
    data: {
      status: "routed",
      resolvedAt: null,
      routedToType: "ContentProposal",
      routedToId: input.proposalId,
    },
  });
}

export function terminalOpportunityStatusForContentProposal(
  proposal: Pick<ContentProposalOutcomeInput, "status" | "draftStatus">
): "resolved" | "dismissed" {
  return proposal.draftStatus === "published" ? "resolved" : "dismissed";
}

export async function markContentProposalOpportunitiesTerminal(
  prismaClient: ContentProposalOpportunityClient,
  proposals: ContentProposalOutcomeInput[],
): Promise<{ resolved: number; dismissed: number }> {
  let resolved = 0;
  let dismissed = 0;

  for (const proposal of proposals) {
    const status = terminalOpportunityStatusForContentProposal(proposal);
    const result = await prismaClient.opportunity.updateMany({
      where: opportunityWhereForContentProposal({
        proposalId: proposal.id,
        sourceData: proposal.sourceData,
      }),
      data: {
        status,
        resolvedAt: new Date(),
        routedToType: "ContentProposal",
        routedToId: proposal.id,
      },
    });
    if (status === "resolved") resolved += result.count;
    else dismissed += result.count;
  }

  return { resolved, dismissed };
}
