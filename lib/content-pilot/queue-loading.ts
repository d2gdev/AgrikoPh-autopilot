export interface ProposalPage<TProposal> {
  proposals?: TProposal[];
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

  while (true) {
    const page = await fetchPage(cursor);
    proposals.push(...(page.proposals ?? []));
    if (!page.hasMore) return proposals;
    if (!page.nextCursor) throw new Error("Proposal pagination ended without a cursor");
    if (seenCursors.has(page.nextCursor)) throw new Error("Proposal pagination returned a repeated cursor");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
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
