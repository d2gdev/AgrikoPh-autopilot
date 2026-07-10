import type { Prisma } from "@prisma/client";
import {
  contentProposalDedupeKey,
  type ContentProposalDedupeInput,
} from "@/lib/content-pilot/proposal-dedupe";

export function withContentProposalDedupeKey<T extends ContentProposalDedupeInput>(
  input: T,
): T & { dedupeKey: string } {
  return { ...input, dedupeKey: contentProposalDedupeKey(input) };
}

export type ContentProposalCreateData =
  Prisma.ContentProposalUncheckedCreateInput & ContentProposalDedupeInput;

export interface ContentProposalCreateClient<TProposal> {
  contentProposal: {
    createMany(args: { data: ContentProposalCreateData[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    findUnique(args: { where: { dedupeKey: string } }): Promise<TProposal | null>;
  };
}

export class ContentProposalConcurrencyError extends Error {
  constructor(public readonly dedupeKey: string) {
    super(`Content proposal winner missing for ${dedupeKey}`);
    this.name = "ContentProposalConcurrencyError";
  }
}

export async function createContentProposalOnce<TProposal>(
  client: ContentProposalCreateClient<TProposal>,
  data: ContentProposalCreateData,
): Promise<{ proposal: TProposal; created: boolean }> {
  const keyed = withContentProposalDedupeKey(data);
  const insert = await client.contentProposal.createMany({ data: [keyed], skipDuplicates: true });
  let proposal = await client.contentProposal.findUnique({ where: { dedupeKey: keyed.dedupeKey } });
  if (!proposal && insert.count === 0) {
    proposal = await client.contentProposal.findUnique({ where: { dedupeKey: keyed.dedupeKey } });
  }
  if (!proposal) throw new ContentProposalConcurrencyError(keyed.dedupeKey);
  return { proposal, created: insert.count === 1 };
}
