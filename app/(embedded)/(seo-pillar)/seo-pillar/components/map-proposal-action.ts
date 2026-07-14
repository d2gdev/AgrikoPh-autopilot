import type { MapAwareSeoGap } from "@/lib/seo/analysis";

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SelectedProposalResult = { candidateId: string; status: "created" | "already_existing" | "stale_or_blocked" | "failed"; proposalId?: string };
export type SelectedProposalResponse = { results: SelectedProposalResult[]; counts: Record<SelectedProposalResult["status"], number> };

export async function submitSelectedMapProposals(authFetch: AuthFetch, identity: { strategyVersionId: string; packageSha256: string; analysisGeneratedAt: string }, candidateIds: string[]): Promise<SelectedProposalResponse> {
  const response = await authFetch("/api/seo/gaps/promote-selected", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...identity, candidateIds }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Could not create governed proposals.");
  return result as SelectedProposalResponse;
}

export function selectVisibleCandidateIds(current: Set<string>, visibleIds: string[], select: boolean): Set<string> {
  const next = new Set(current);
  for (const id of visibleIds) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function applySelectedProposalResults(selected: Set<string>, done: Set<string>, results: SelectedProposalResult[]) {
  const nextSelected = new Set(selected), nextDone = new Set(done);
  for (const result of results) {
    if (result.status === "created" || result.status === "already_existing") {
      nextSelected.delete(result.candidateId);
      nextDone.add(result.candidateId);
    }
  }
  return { selected: nextSelected, done: nextDone };
}

export async function submitMapProposal(authFetch: AuthFetch, gap: MapAwareSeoGap): Promise<{ resolved: boolean; message: string }> {
  const response = await authFetch("/api/seo/gaps/promote", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategyVersionId: gap.strategyVersionId, packageSha256: gap.packageSha256, gaps: [gap] }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok && result.created > 0) return { resolved: true, message: "Created governed proposal in Content Pilot." };
  if (response.ok && result.skipped > 0) return { resolved: true, message: "This governed proposal is already handled." };
  return { resolved: false, message: result.error ?? "Could not create governed proposal." };
}
