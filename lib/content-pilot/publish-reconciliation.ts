import { finalizePublishedProposal } from "@/lib/content-pilot/publish-service";
import { inspectPublishOutcome } from "@/lib/content-pilot/shopify-publish-inspection";

/**
 * Reconciliation is deliberately conservative: a durable Shopify receipt is
 * sufficient evidence of an applied write; an unknown publishing operation is
 * never retried automatically. The inspector performs proposal-type-specific,
 * read-only Shopify checks before allowing a ready-state reset.
 */
export async function reconcilePublishOperation(input: { prismaClient: any; proposalId: string }) {
  const proposal = await input.prismaClient.contentProposal.findUnique({ where: { id: input.proposalId } });
  if (!proposal) return { kind: "not_found" as const };
  if (proposal.draftStatus === "published" && proposal.publishOperationId) {
    await finalizePublishedProposal(input.prismaClient, proposal.publishOperationId);
    return { kind: "applied" as const };
  }
  if (proposal.draftStatus !== "publishing" && proposal.draftStatus !== "publish-error") return { kind: "conflict" as const };
  let inspection: Awaited<ReturnType<typeof inspectPublishOutcome>>;
  try {
    inspection = await inspectPublishOutcome(proposal);
  } catch (error) {
    await input.prismaClient.contentProposal.updateMany({
      where: { id: proposal.id, draftStatus: { in: ["publishing", "publish-error"] } },
      data: { draftStatus: "publish-error", publishWarning: `Could not inspect Shopify publication: ${String(error).slice(0, 1800)}` },
    });
    return { kind: "ambiguous" as const };
  }
  if (inspection.kind === "applied") {
    const receipt = await input.prismaClient.contentProposal.updateMany({
      where: { id: proposal.id, draftStatus: { in: ["publishing", "publish-error"] } },
      data: {
        draftStatus: "published", publishedAt: new Date(), shopifyArticleId: inspection.shopifyId,
        publishedHandle: inspection.handle, scheduledPublishAt: null, publishWarning: null,
      },
    });
    if (!receipt.count) return { kind: "conflict" as const };
    if (proposal.publishOperationId) {
      try { await finalizePublishedProposal(input.prismaClient, proposal.publishOperationId); }
      catch (error) {
        await input.prismaClient.contentProposal.updateMany({
          where: { id: proposal.id, draftStatus: "published" },
          data: { publishWarning: `Post-publish bookkeeping failed: ${String(error).slice(0, 1800)}` },
        });
      }
    }
    return { kind: "applied" as const };
  }
  if (inspection.kind === "not_applied") {
    const reset = await input.prismaClient.contentProposal.updateMany({
      where: { id: proposal.id, draftStatus: { in: ["publishing", "publish-error"] } },
      data: { draftStatus: "ready", publishOperationId: null, publishStartedAt: null, publishWarning: null },
    });
    return reset.count ? { kind: "not_applied" as const } : { kind: "conflict" as const };
  }
  // A missing local receipt is exactly why this path exists; it is never proof
  // that Shopify did not apply the operation. Keep the operation blocked until
  // a proposal-type-specific Shopify inspector can establish not-applied.
  await input.prismaClient.contentProposal.updateMany({ where: { id: proposal.id, draftStatus: { in: ["publishing", "publish-error"] } }, data: { draftStatus: "publish-error", publishWarning: "Publication outcome is ambiguous. Inspect Shopify before retrying." } });
  return { kind: "ambiguous" as const };
}
