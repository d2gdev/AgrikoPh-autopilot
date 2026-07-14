/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContentProposalOnce, withContentProposalDedupeKey, type ContentProposalCreateData } from "./create-proposal";
import { markContentProposalOpportunitiesTerminal } from "@/lib/opportunities/content-proposal-outcomes";
import { opportunityFromProposal, upsertOpportunities } from "@/lib/opportunities/generate";
import { createGovernedContentProposalInTransaction } from "@/lib/topical-map/compliance-store";
import type { StrategyProposalCandidate } from "@/lib/topical-map/proposal-context";

type Client = any;

function strategyCandidate(input: ContentProposalCreateData): StrategyProposalCandidate | null {
  const source = input.sourceData;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const candidate = (source as Record<string, unknown>).strategyCandidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  if (value.type === "content" && (value.action === "create" || value.action === "update") && typeof value.targetUrl === "string") return { type: "content", action: value.action, targetUrl: value.targetUrl };
  if (value.type === "internal_link" && typeof value.fromUrl === "string" && typeof value.toUrl === "string") return { type: "internal_link", fromUrl: value.fromUrl, toUrl: value.toUrl };
  if (value.type === "seo_metadata" && typeof value.targetUrl === "string") return { type: "seo_metadata", targetUrl: value.targetUrl };
  return null;
}

/** Replace the pending proposal set as one atomic unit, including its routed opportunities. */
export async function replacePendingContentProposals(client: Client, inputs: ContentProposalCreateData[], duplicateIds: string[] = [], options: { governed?: boolean } = {}) {
  const deduped = [...new Map(inputs.map((input) => {
    const keyed = withContentProposalDedupeKey(input);
    return [keyed.dedupeKey, keyed];
  })).values()];
  return client.$transaction(async (tx: Client) => {
    const pending = await tx.contentProposal.findMany({ where: { status: "pending" }, select: { id: true, status: true, draftStatus: true, sourceData: true } });
    const terminal = await markContentProposalOpportunitiesTerminal(tx, pending);
    if (duplicateIds.length > 0) {
      const duplicates = await tx.contentProposal.findMany({ where: { id: { in: duplicateIds } }, select: { id: true, status: true, draftStatus: true, sourceData: true } });
      await markContentProposalOpportunitiesTerminal(tx, duplicates);
      await tx.contentProposal.deleteMany({ where: { id: { in: duplicateIds } } });
    }
    const removed = await tx.contentProposal.deleteMany({ where: { status: "pending" } });
    const proposals: any[] = [];
    let created = 0;
    for (const input of deduped) {
      if (options.governed) {
        const candidate = strategyCandidate(input);
        if (!candidate) continue;
        const result = await createGovernedContentProposalInTransaction(tx, { data: input, candidate });
        if (result.proposal) proposals.push(result.proposal);
        if (result.created) created++;
      } else {
        const result = await createContentProposalOnce(tx, input);
        proposals.push(result.proposal);
        if (result.created) created++;
      }
    }
    const opportunities = await upsertOpportunities(tx, proposals.map((p) => opportunityFromProposal(p)));
    return { proposals, created, existing: proposals.length - created, opportunities: opportunities.upserted, removed: removed.count, ...terminal };
  });
}
