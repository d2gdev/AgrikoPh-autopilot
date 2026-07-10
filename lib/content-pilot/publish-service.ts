import { randomUUID } from "crypto";
import { publishDraft, resolveArticleHandle } from "@/lib/content-pilot/publish-draft";
import { contentProposalPublishRecoveryStatus } from "@/lib/content-pilot/publish-recovery";
import { CONTENT_PROPOSAL_PUBLISHABLE_STATUSES } from "@/lib/content-pilot/proposal-state";
import { markContentProposalOpportunityResolved } from "@/lib/opportunities/content-proposal-outcomes";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";

type Client = any;
export type PublishResult =
  | { kind: "published"; shopifyId: string; handle: string | null }
  | { kind: "published_with_warnings"; shopifyId: string; handle: string | null; warning: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed_before_external_write"; message: string }
  | { kind: "reconciliation_required"; message: string };

export async function finalizePublishedProposal(client: Client, operationId: string) {
  return client.$transaction(async (tx: Client) => {
    const claimed = await tx.contentProposal.updateMany({
      where: { publishOperationId: operationId, draftStatus: "published", publishFinalizedAt: null },
      data: { publishFinalizedAt: new Date(), publishWarning: null },
    });
    if (!claimed.count) return { finalized: false };
    const proposal = await tx.contentProposal.findUnique({ where: { publishOperationId: operationId } });
    if (!proposal) throw new Error("Published proposal disappeared during finalization");
    await markContentProposalOpportunityResolved(tx, { proposalId: proposal.id, sourceData: proposal.sourceData });
    await tx.auditLog.create({
      data: {
        entityType: "ContentProposal", entityId: proposal.id,
        action: proposal.publishTrigger === "scheduled" ? "published_scheduled" : proposal.proposalType === "seo-fix" ? "seo_meta_applied" : "published",
        actor: proposal.publishActor ?? "system", before: { draftStatus: "ready" },
        after: { draftStatus: "published", publishOperationId: operationId },
        meta: { trigger: proposal.publishTrigger ?? "maintenance", operationId },
      },
    });
    return { finalized: true };
  });
}

export async function retryIncompletePublishFinalizations(client: Client, limit = 50) {
  const pending = await client.contentProposal.findMany({
    where: { draftStatus: "published", publishOperationId: { not: null }, publishFinalizedAt: null },
    select: { publishOperationId: true }, take: limit,
  });
  let finalized = 0;
  for (const row of pending) {
    if (!row.publishOperationId) continue;
    try { if ((await finalizePublishedProposal(client, row.publishOperationId)).finalized) finalized++; }
    catch (error) {
      await client.contentProposal.updateMany({ where: { publishOperationId: row.publishOperationId, draftStatus: "published" }, data: { publishWarning: `Post-publish bookkeeping failed: ${String(error).slice(0, 1800)}` } }).catch(() => {});
    }
  }
  return { attempted: pending.length, finalized };
}

export async function publishContentProposal(input: { prismaClient: Client; proposalId: string; actor: string; trigger: "manual" | "scheduled" | "maintenance"; dueBefore?: Date; reindex?: boolean }) : Promise<PublishResult> {
  const { prismaClient: client, proposalId, actor, trigger, dueBefore, reindex = true } = input;
  const operationId = randomUUID();
  const claimWhere: any = { id: proposalId, status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] }, draftStatus: "ready" };
  if (dueBefore) claimWhere.scheduledPublishAt = { lte: dueBefore };
  const claimed = await client.contentProposal.updateMany({
    where: claimWhere,
    data: { draftStatus: "publishing", publishOperationId: operationId, publishStartedAt: new Date(), publishWarning: null, publishActor: actor, publishTrigger: trigger },
  });
  if (!claimed.count) return { kind: "conflict", message: "Proposal is no longer ready and publishable" };
  const fresh = await client.contentProposal.findUnique({ where: { id: proposalId, publishOperationId: operationId } });
  if (!fresh) return { kind: "conflict", message: "Publish ownership was lost" };

  let external: { shopifyId: string; handle: string | null };
  try { external = await publishDraft(fresh); }
  catch (error) {
    const message = String(error);
    await client.contentProposal.updateMany({ where: { id: proposalId, publishOperationId: operationId, draftStatus: "publishing" }, data: { draftStatus: contentProposalPublishRecoveryStatus(fresh.proposalType, message), draftError: message.slice(0, 2000), publishOperationId: null } }).catch(() => {});
    return { kind: "failed_before_external_write", message };
  }

  let seoData: { score?: number; blogHandle?: string } | null = null;
  let contextWarning: string | null = null;
  try {
    const articleHandle = resolveArticleHandle(fresh);
    const indexed = articleHandle ? await client.articleRecord.findFirst({ where: { handle: articleHandle }, select: { seoData: true }, orderBy: { indexedAt: "desc" } }) : null;
    seoData = indexed?.seoData as { score?: number; blogHandle?: string } | null;
  } catch (error) {
    contextWarning = `Post-publish local context failed: ${String(error)}`;
  }
  const proposedState = seoData?.blogHandle ? { ...(fresh.proposedState as Record<string, unknown>), blogHandle: seoData.blogHandle } : fresh.proposedState;
  try {
    const receipt = await client.contentProposal.updateMany({
      where: { id: proposalId, publishOperationId: operationId, draftStatus: "publishing" },
      data: { draftStatus: "published", publishedAt: new Date(), shopifyArticleId: external.shopifyId, publishedHandle: external.handle, scheduledPublishAt: null, proposedState, ...(seoData?.score != null ? { baselineSeoScore: seoData.score } : {}) },
    });
    if (!receipt.count) return { kind: "reconciliation_required", message: "Shopify confirmed publication but its receipt could not be recorded. Reconcile before retrying." };
  } catch (error) {
    return { kind: "reconciliation_required", message: `Shopify confirmed publication but receipt storage failed: ${String(error)}` };
  }
  try {
    await finalizePublishedProposal(client, operationId);
    if (contextWarning) {
      await client.contentProposal.updateMany({ where: { id: proposalId, publishOperationId: operationId, draftStatus: "published" }, data: { publishWarning: contextWarning } }).catch(() => {});
      return { kind: "published_with_warnings", ...external, warning: contextWarning };
    }
    if (reindex) {
      try { await fetchBlogContentHandler(); }
      catch (error) { throw new Error(`Post-publish re-index failed: ${String(error)}`); }
    }
    return { kind: "published", ...external };
  } catch (error) {
    const warning = String(error).slice(0, 2000);
    await client.contentProposal.updateMany({ where: { id: proposalId, publishOperationId: operationId, draftStatus: "published" }, data: { publishWarning: warning } }).catch(() => {});
    return { kind: "published_with_warnings", ...external, warning };
  }
}
