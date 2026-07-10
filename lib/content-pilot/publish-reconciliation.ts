import { finalizePublishedProposal } from "@/lib/content-pilot/publish-service";

/**
 * Reconciliation is deliberately conservative: a durable Shopify receipt is
 * sufficient evidence of an applied write; an unknown publishing operation is
 * never retried automatically. Shopify inspection can be added per proposal
 * adapter without weakening this safe default.
 */
export async function reconcilePublishOperation(input: { prismaClient: any; proposalId: string }) {
  const proposal = await input.prismaClient.contentProposal.findUnique({ where: { id: input.proposalId } });
  if (!proposal) return { kind: "not_found" as const };
  if (proposal.draftStatus === "published" && proposal.publishOperationId) {
    await finalizePublishedProposal(input.prismaClient, proposal.publishOperationId);
    return { kind: "applied" as const };
  }
  if (proposal.draftStatus !== "publishing" && proposal.draftStatus !== "publish-error") return { kind: "conflict" as const };
  if (!proposal.shopifyArticleId) {
    await input.prismaClient.contentProposal.updateMany({ where: { id: proposal.id, draftStatus: { in: ["publishing", "publish-error"] } }, data: { draftStatus: "ready", publishOperationId: null, publishStartedAt: null, publishWarning: null } });
    return { kind: "not_applied" as const };
  }
  await input.prismaClient.contentProposal.updateMany({ where: { id: proposal.id }, data: { draftStatus: "publish-error", publishWarning: "Publication outcome is ambiguous. Inspect Shopify before retrying." } });
  return { kind: "ambiguous" as const };
}
