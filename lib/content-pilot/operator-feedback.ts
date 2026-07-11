export function contentIndexFeedback(result: {
  status?: string;
  indexed?: number;
  skipped?: number;
  errors?: unknown[];
}): { tone: "success" | "warning"; message: string } {
  const indexed = result.indexed ?? 0;
  const skipped = result.skipped ?? 0;
  const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
  if (result.status === "partial" || errorCount > 0) {
    return {
      tone: "warning",
      message: `Indexing completed with ${errorCount} error${errorCount === 1 ? "" : "s"}: indexed ${indexed} articles and skipped ${skipped} unchanged. Retry after checking the job error details.`,
    };
  }
  return {
    tone: "success",
    message: `Indexed ${indexed} articles, skipped ${skipped} unchanged.`,
  };
}

export function overviewLoadWarning(input: {
  clustersLoaded: boolean;
  linkGraphLoaded: boolean;
}): string | null {
  const failed = [
    !input.clustersLoaded ? "topic clusters" : null,
    !input.linkGraphLoaded ? "link graph" : null,
  ].filter((value): value is string => value != null);
  return failed.length
    ? `Some overview sections failed to load: ${failed.join(", ")}. Refresh before treating an empty section as current.`
    : null;
}

export function bulkApprovalGenerationFeedback(input: {
  approved: number;
  generated: number;
  failed: number;
}): { tone: "success" | "warning"; message: string } {
  return {
    tone: input.failed > 0 ? "warning" : "success",
    message: `Bulk review finished: ${input.approved} approved, ${input.generated} drafts generated, ${input.failed} failed.${input.failed > 0 ? " Failed rows retain their error details." : ""}`,
  };
}
