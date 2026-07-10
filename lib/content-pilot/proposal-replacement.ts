/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContentProposalOnce, withContentProposalDedupeKey, type ContentProposalCreateData } from "./create-proposal";
import { markContentProposalOpportunitiesTerminal } from "@/lib/opportunities/content-proposal-outcomes";
import { opportunityFromProposal, upsertOpportunities } from "@/lib/opportunities/generate";

type Client = any;

/** Replace the pending proposal set as one atomic unit, including its routed opportunities. */
export async function replacePendingContentProposals(client: Client, inputs: ContentProposalCreateData[], duplicateIds: string[] = []) {
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
      const result = await createContentProposalOnce(tx, input);
      proposals.push(result.proposal);
      if (result.created) created++;
    }
    const opportunities = await upsertOpportunities(tx, proposals.map((p) => opportunityFromProposal(p)));
    return { proposals, created, existing: proposals.length - created, opportunities: opportunities.upserted, removed: removed.count, ...terminal };
  });
}
