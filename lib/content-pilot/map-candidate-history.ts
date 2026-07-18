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

type MappedTaskClient = {
  seoFollowUpTask: {
    findFirst(args: {
      where: {
        status: "open";
        sourceType: "topical_map";
        sourceKey: string;
        earliestReviewAt: { lte: Date };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

export type MappedContentIdentity = {
  candidateId: string;
  action: "create" | "refresh";
  page: string;
  suggestedTitle: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mappedContentIdentityFromTask(task: {
  sourceKey: string;
  sourceData: unknown;
  targetUrl: string | null;
  title: string;
}): MappedContentIdentity | null {
  if (!task.sourceKey.startsWith("topical-map-content:")
    || !task.targetUrl
    || !isRecord(task.sourceData)
    || typeof task.sourceData.candidateId !== "string"
    || (task.sourceData.action !== "create" && task.sourceData.action !== "refresh")) {
    return null;
  }
  return {
    candidateId: task.sourceData.candidateId,
    action: task.sourceData.action,
    page: task.targetUrl,
    suggestedTitle: typeof task.sourceData.mapTitle === "string"
      ? task.sourceData.mapTitle
      : task.title,
  };
}

function candidateKeys(candidate: MappedContentIdentity): string[] {
  const targetUrl = normalizeGovernedUrl(candidate.page);
  const match = /^\/blogs\/[^/]+\/([^/]+)$/.exec(targetUrl);
  if (!match) return [];

  const proposalType = candidate.action === "create" ? "new-content" : "content-refresh";
  const input = {
    articleHandle: match[1]!,
    proposalType,
    title: candidate.suggestedTitle,
  };
  return [
    contentProposalDedupeKey({
      ...input,
      proposedState: { targetUrl },
    }),
    contentProposalDedupeKey(input),
  ];
}

export async function getBlockingMappedContentProposals(
  client: ProposalHistoryClient,
  candidates: MappedContentIdentity[],
): Promise<Map<string, string>> {
  const candidateIdsByKey = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const key of candidateKeys(candidate)) {
      candidateIdsByKey.set(key, [
        ...(candidateIdsByKey.get(key) ?? []),
        candidate.candidateId,
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

export async function getBlockingMapContentProposals(
  client: ProposalHistoryClient,
  gaps: MapAwareSeoGap[],
): Promise<Map<string, string>> {
  return getBlockingMappedContentProposals(
    client,
    gaps.flatMap((gap) =>
      gap.kind === "content" && gap.page
        ? [{
            candidateId: gap.candidateId,
            action: gap.action === "create" ? "create" as const : "refresh" as const,
            page: gap.page,
            suggestedTitle: gap.suggestedTitle,
          }]
        : []),
  );
}

export async function hasReadyMappedContentTask(
  client: MappedTaskClient,
  input: {
    strategyVersionId: string;
    candidateId: string;
    now?: Date;
  },
): Promise<boolean> {
  const task = await client.seoFollowUpTask.findFirst({
    where: {
      status: "open",
      sourceType: "topical_map",
      sourceKey: `topical-map-content:${input.strategyVersionId}:${input.candidateId}`,
      earliestReviewAt: { lte: input.now ?? new Date() },
    },
    select: { id: true },
  });
  return Boolean(task);
}
