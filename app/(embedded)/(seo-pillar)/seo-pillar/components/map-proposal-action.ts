import type { MapAwareSeoGap } from "@/lib/seo/analysis";

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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
