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
    create(args: { data: ContentProposalCreateData }): Promise<TProposal>;
    findUnique(args: { where: { dedupeKey: string } }): Promise<TProposal | null>;
  };
}

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: string }).code === "P2002";
}

export async function createContentProposalOnce<TProposal>(
  client: ContentProposalCreateClient<TProposal>,
  data: ContentProposalCreateData,
): Promise<{ proposal: TProposal; created: boolean }> {
  const keyed = withContentProposalDedupeKey(data);
  try {
    return {
      proposal: await client.contentProposal.create({ data: keyed }),
      created: true,
    };
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const existing = await client.contentProposal.findUnique({
      where: { dedupeKey: keyed.dedupeKey },
    });
    if (!existing) throw error;
    return { proposal: existing, created: false };
  }
}
