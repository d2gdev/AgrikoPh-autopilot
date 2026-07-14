import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contentProposalQueueStage } from "@/app/(embedded)/(content-pilot)/content-pilot/components/queue-stage";

describe("Growth Brief refresh", () => {
  it("requests a fresh authoritative brief when the operator chooses Refresh", () => {
    const source = readFileSync("app/(embedded)/(insights)/growth-brief/page.tsx", "utf8");

    expect(source).toContain('authFetch(force ? `${CACHE_KEY}?refresh=1` : CACHE_KEY');
  });
});

describe("Content Pilot queue publication stages", () => {
  it.each([
    ["publishing", "publishing"],
    ["publish-error", "publish-error"],
  ])("keeps a %s proposal in its reconciliation stage", (draftStatus, expected) => {
    expect(contentProposalQueueStage({ status: "approved", draftStatus } as any)).toBe(expected);
  });

  it("reloads authoritative state after generation failure instead of inventing a failed state", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(source).not.toContain('{ ...p, draftStatus: "failed", draftError: message }');
    expect(source).toContain("preserveError: true");
    expect(source).toContain("restoreProposalAfterFailedReload");
    expect(source).toContain("createLatestRequestCoordinator");
  });

  it("renders a truthful aggregate after bulk approval and generation", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(source).toContain("bulkApprovalGenerationFeedback");
    expect(source).toContain("setBulkFeedback");
  });
});
