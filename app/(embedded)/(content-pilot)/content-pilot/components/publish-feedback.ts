export function publishFeedback(
  title: string,
  result: { kind?: string; publishWarning?: string },
): { tone: "success" | "warning"; message: string } {
  if (result.kind === "published_with_warnings") {
    return {
      tone: "warning",
      message: `Published with warning: "${title}" was published to Shopify.${result.publishWarning ? ` ${result.publishWarning}` : ""}`,
    };
  }
  return { tone: "success", message: `"${title}" published to Shopify.` };
}

export function publishReconciliationMessage(result: {
  reconciliationRequired?: unknown;
  kind?: unknown;
  error?: unknown;
}): string | null {
  if (result.reconciliationRequired !== true && result.kind !== "reconciliation_required") return null;
  return typeof result.error === "string" && result.error
    ? result.error
    : "Publication outcome requires reconciliation. Inspect Shopify before retrying.";
}
