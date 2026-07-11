export interface ProposalPage<TProposal> {
  proposals?: TProposal[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export function contentPilotQueueCacheKey(
  contextualize: (href: string) => string,
): string {
  return contextualize("/api/content-pilot/proposals");
}

export async function loadAllProposalPages<TProposal>(
  fetchPage: (cursor: string | null) => Promise<ProposalPage<TProposal>>,
): Promise<TProposal[]> {
  const proposals: TProposal[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageNumber = 0;
  let maxPages = 1;

  while (true) {
    const page = await fetchPage(cursor);
    pageNumber++;
    const pageProposals = page.proposals ?? [];
    if (pageNumber === 1) {
      if (!Number.isInteger(page.total) || (page.total ?? -1) < 0) {
        throw new Error("Proposal pagination returned an invalid total");
      }
      maxPages = Math.max(1, Math.ceil((page.total ?? 0) / Math.max(1, pageProposals.length)));
    }
    proposals.push(...pageProposals);
    if (!page.hasMore) return proposals;
    if (pageNumber >= maxPages) throw new Error("Proposal pagination exceeded its first-page total bound");
    if (!page.nextCursor) throw new Error("Proposal pagination ended without a cursor");
    if (seenCursors.has(page.nextCursor)) throw new Error("Proposal pagination returned a repeated cursor");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function restoreProposalAfterFailedReload<TProposal extends { id: string }>(
  proposals: TProposal[],
  id: string,
  previous: TProposal,
): TProposal[] {
  return proposals.map((proposal) => proposal.id === id ? previous : proposal);
}

export async function loadProposalDraft(
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await authFetch(`/api/content-pilot/proposals/${id}`);
  const body = await response.json().catch(() => ({})) as {
    error?: unknown;
    proposal?: { draftContent?: unknown };
  };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Draft preview failed (HTTP ${response.status})`);
  }
  const draft = body.proposal?.draftContent;
  return draft && typeof draft === "object" && !Array.isArray(draft)
    ? draft as Record<string, unknown>
    : null;
}
