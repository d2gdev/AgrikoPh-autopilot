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
