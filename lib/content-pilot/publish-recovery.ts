export function contentProposalPublishRecoveryStatus(
  proposalType: string,
  errorMessage: string
): "failed" | "publish-error" | "ready" {
  const nonIdempotent =
    proposalType === "new-content" ||
    proposalType === "internal-link";
  const missingArticle =
    errorMessage.includes("requires an articleHandle") ||
    errorMessage.includes("no longer exists in Shopify");

  if (missingArticle) return "failed";
  return nonIdempotent ? "publish-error" : "ready";
}
