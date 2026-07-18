export const CONTENT_PROPOSAL_ACTIVE_STATUSES = [
  "pending",
  "approved",
  "override_approved",
  "published",
];

export const CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES = [
  "approved",
  "override_approved",
  "published",
  "rejected",
];

export const CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES = [
  ...CONTENT_PROPOSAL_ACTIVE_STATUSES,
  "rejected",
];

export type ContentProposalDedupeInput = {
  articleHandle?: string | null;
  proposalType: string;
  title: string;
  proposedState?: unknown;
};

type ContentProposalDedupeClient = {
  contentProposal: {
    findMany(args: {
      where: { status: { in: string[] } };
      select: {
        articleHandle: true;
        proposalType: true;
        title: true;
        proposedState: true;
      };
    }): Promise<ContentProposalDedupeInput[]>;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function exactBlogPath(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const match = /^\/blogs\/([^/?#]+)\/([^/?#]+)\/?$/.exec(candidate);
  return match ? `/blogs/${normalizeKeyPart(match[1]!)}/${normalizeKeyPart(match[2]!)}` : null;
}

function handlelessDiscriminator(input: ContentProposalDedupeInput): string {
  const proposedState = asRecord(input.proposedState);
  const exactTarget = exactBlogPath(proposedState.targetUrl);
  if (exactTarget) return exactTarget;
  return normalizeKeyPart(
    text(proposedState.targetKeyword) ??
      text(proposedState.targetQuery) ??
      text(proposedState.suggestedTitle) ??
      text(proposedState.title) ??
      input.title,
  );
}

export function contentProposalDedupeKey(input: ContentProposalDedupeInput): string {
  const proposalType = normalizeKeyPart(input.proposalType);
  const articleHandle = text(input.articleHandle);
  if (articleHandle) {
    const proposedState = asRecord(input.proposedState);
    const exactSource = exactBlogPath(proposedState.fromUrl) ?? exactBlogPath(proposedState.targetUrl);
    const base = exactSource ? `${proposalType}:article-url:${exactSource}` : `${proposalType}:article:${normalizeKeyPart(articleHandle)}`;

    if (proposalType === "internal-link") {
      const destination =
        exactBlogPath(proposedState.toUrl) ??
        text(proposedState.toArticle) ??
        text(proposedState.targetArticle) ??
        text(proposedState.suggestedAnchorText) ??
        input.title;
      const observationStateHash = text(proposedState.observationStateHash);
      const observation = observationStateHash
        ? `:observed:${normalizeKeyPart(observationStateHash)}`
        : "";
      return `${base}:to:${normalizeKeyPart(destination)}${observation}`;
    }

    return base;
  }

  return `${proposalType}:handleless:${handlelessDiscriminator(input)}`;
}

export function uniqueContentProposalInputs<T extends ContentProposalDedupeInput>(
  inputs: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const input of inputs) {
    const key = contentProposalDedupeKey(input);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(input);
  }

  return result;
}

export async function getExistingContentProposalDedupeKeys(
  prismaClient: ContentProposalDedupeClient,
  statuses: string[] = CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
): Promise<Set<string>> {
  const existing = await prismaClient.contentProposal.findMany({
    where: { status: { in: statuses } },
    select: {
      articleHandle: true,
      proposalType: true,
      title: true,
      proposedState: true,
    },
  });

  return new Set(existing.map(contentProposalDedupeKey));
}

export async function filterBlockedContentProposalInputs<T extends ContentProposalDedupeInput>(
  prismaClient: ContentProposalDedupeClient,
  inputs: T[],
  statuses: string[] = CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES,
): Promise<T[]> {
  if (inputs.length === 0) return [];

  const blockedKeys = await getExistingContentProposalDedupeKeys(prismaClient, statuses);
  const seenFresh = new Set<string>();
  const fresh: T[] = [];

  for (const input of inputs) {
    const key = contentProposalDedupeKey(input);
    if (blockedKeys.has(key) || seenFresh.has(key)) continue;
    seenFresh.add(key);
    fresh.push(input);
  }

  return fresh;
}
