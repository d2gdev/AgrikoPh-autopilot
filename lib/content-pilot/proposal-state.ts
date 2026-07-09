export const CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES = ["publishing", "published"] as const;

export function canRejectContentProposal(proposal: {
  status?: string | null;
  draftStatus?: string | null;
}): boolean {
  if (proposal.status === "rejected") return false;
  return !CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES.includes(
    proposal.draftStatus as (typeof CONTENT_PROPOSAL_NON_REJECTABLE_DRAFT_STATUSES)[number]
  );
}
