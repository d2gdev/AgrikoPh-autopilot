import type { ContentProposal } from "./types";

export type ContentProposalQueueStage =
  | "pending"
  | "approved"
  | "generating"
  | "ready"
  | "scheduled"
  | "publishing"
  | "publish-error"
  | "published"
  | "failed"
  | "rejected";

export function contentProposalQueueStage(p: Pick<ContentProposal, "status" | "draftStatus" | "scheduledPublishAt">): ContentProposalQueueStage {
  if (p.status === "rejected") return "rejected";
  if (p.status === "pending") return "pending";
  if (p.draftStatus === "publishing") return "publishing";
  if (p.draftStatus === "publish-error") return "publish-error";
  if (p.draftStatus === "published") return "published";
  if (p.draftStatus === "ready" && p.scheduledPublishAt) return "scheduled";
  if (p.draftStatus === "ready") return "ready";
  if (p.draftStatus === "generating") return "generating";
  if (p.draftStatus === "failed") return "failed";
  return "approved";
}
