import { describe, expect, it } from "vitest";
import {
  bulkApprovalGenerationFeedback,
  contentIndexFeedback,
  overviewLoadWarning,
} from "@/lib/content-pilot/operator-feedback";

describe("Content Pilot operator feedback", () => {
  it("labels a partial index as a warning instead of a clean success", () => {
    expect(contentIndexFeedback({ status: "partial", indexed: 8, skipped: 40, errors: ["one", "two"] })).toEqual({
      tone: "warning",
      message: "Indexing completed with 2 errors: indexed 8 articles and skipped 40 unchanged. Retry after checking the job error details.",
    });
  });

  it("names overview sections that failed instead of rendering false empty states", () => {
    expect(overviewLoadWarning({ clustersLoaded: false, linkGraphLoaded: true })).toBe(
      "Some overview sections failed to load: topic clusters. Refresh before treating an empty section as current.",
    );
  });

  it("reports each stage of bulk approval and generation truthfully", () => {
    expect(bulkApprovalGenerationFeedback({ approved: 3, generated: 2, failed: 2 })).toEqual({
      tone: "warning",
      message: "Bulk review finished: 3 approved, 2 drafts generated, 2 failed. Failed rows retain their error details.",
    });
  });
});
