import {
  createContentProposalOnce,
  withContentProposalDedupeKey,
  type ContentProposalCreateData,
} from "./create-proposal";
import { markContentProposalOpportunitiesTerminal } from "@/lib/opportunities/content-proposal-outcomes";
import { opportunityFromProposal, upsertOpportunities } from "@/lib/opportunities/generate";

/** Replace the pending proposal set as one atomic unit, including its routed opportunities. */
export async function replacePendingContentProposals<TClient extends { $transaction: Function }>(
  client: TClient,
  inputs: ContentProposalCreateData[],
) {
  const deduped = [...new Map(inputs.map((input) => {
    const keyed = withContentProposalDedupeKey(input);
    return [keyed.dedupeKey, keyed];
  })).values()];

  return client.$transaction(async (tx: any) => {
    const pending = await tx.contentProposal.findMany({
      where: { status: "pending" },
      select: { id: true, status: true, draftStatus: true, sourceData: true },
    });
    const terminal = await markContentProposalOpportunitiesTerminal(tx, pending);
    const removed = await tx.contentProposal.deleteMany({ where: { status: "pending" } });
    const proposals: any[] = [];
    let created = 0;
    for (const input of deduped) {
      const result = await createContentProposalOnce(tx, input);
      proposals.push(result.proposal);
      if (result.created) created++;
    }
    const opportunities = await upsertOpportunities(tx, proposals.map(opportunityFromProposal));
    return {
      proposals,
      created,
      existing: proposals.length - created,
      opportunities: opportunities.upserted,
      removed: removed.count,
      ...terminal,
    };
  });
}
