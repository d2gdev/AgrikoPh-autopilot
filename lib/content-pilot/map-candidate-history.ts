import {
  CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES,
  contentProposalDedupeKey,
} from "@/lib/content-pilot/proposal-dedupe";
import type { MapAwareSeoGap } from "@/lib/seo/analysis";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

type ProposalHistoryClient = {
  contentProposal: {
    findMany(args: {
      where: {
        status: { in: string[] };
        dedupeKey: { in: string[] };
      };
      select: { id: true; dedupeKey: true };
    }): Promise<Array<{ id: string; dedupeKey: string }>>;
  };
};

function candidateKeys(gap: MapAwareSeoGap): string[] {
  if (gap.kind !== "content" || !gap.page) return [];
  const targetUrl = normalizeGovernedUrl(gap.page);
  const match = /^\/blogs\/[^/]+\/([^/]+)$/.exec(targetUrl);
  if (!match) return [];

  const proposalType = gap.action === "create" ? "new-content" : "content-refresh";
  const input = {
    articleHandle: match[1]!,
    proposalType,
    title: gap.suggestedTitle,
  };
  return [
    contentProposalDedupeKey({
      ...input,
      proposedState: { targetUrl },
    }),
    contentProposalDedupeKey(input),
  ];
}

export async function getBlockingMapContentProposals(
  client: ProposalHistoryClient,
  gaps: MapAwareSeoGap[],
): Promise<Map<string, string>> {
  const candidateIdsByKey = new Map<string, string[]>();
  for (const gap of gaps) {
    for (const key of candidateKeys(gap)) {
      candidateIdsByKey.set(key, [
        ...(candidateIdsByKey.get(key) ?? []),
        gap.candidateId,
      ]);
    }
  }
  const keys = [...candidateIdsByKey.keys()];
  if (keys.length === 0) return new Map();

  const proposals = await client.contentProposal.findMany({
    where: {
      status: { in: CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES },
      dedupeKey: { in: keys },
    },
    select: { id: true, dedupeKey: true },
  });
  const blocked = new Map<string, string>();
  for (const proposal of proposals) {
    for (const candidateId of candidateIdsByKey.get(proposal.dedupeKey) ?? []) {
      blocked.set(candidateId, proposal.id);
    }
  }
  return blocked;
}
