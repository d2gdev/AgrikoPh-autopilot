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

  it("opens on pending work instead of flooding the operator with history", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(source).toContain('>("pending")');
  });

  it("requests one filtered server page and exposes explicit pagination", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(source).not.toContain("loadAllProposalPages");
    expect(source).toContain('params.set("stage", stageFilter)');
    expect(source).toContain("stageCounts");
    expect(source).toContain("Load more");
  });

  it("does not expose proposal cloning", () => {
    const queue = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");
    const row = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/queue/ProposalRow.tsx", "utf8");

    expect(queue).not.toContain("/clone");
    expect(row).not.toContain("Duplicate this proposal?");
  });
});

describe("Content Pilot navigation and semantics", () => {
  it("persists tab selection in the URL so iframe remounts restore it", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/page.tsx", "utf8");

    expect(source).toContain("window.history.replaceState");
    expect(source).toContain("handleSelectTab");
    expect(source).toContain('as="p" tone="subdued"');
  });

  it("gives repeated row controls proposal-specific accessible names", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/queue/ProposalRow.tsx", "utf8");

    expect(source).toContain('label={`Select ${p.title}`}');
    expect(source).toContain('accessibilityLabel={`Preview ${p.title}`}');
    expect(source).toContain('accessibilityLabel={`View or edit ${p.title}`}');
  });

  it("enforces mobile touch target sizing for the Content Pilot surface", () => {
    const source = readFileSync("app/(embedded)/(content-pilot)/content-pilot/content-pilot.module.css", "utf8");

    expect(source).toContain("min-block-size: 44px");
  });
});

describe("Unified Report pilot scope", () => {
  it("does not probe the intentionally unbuilt Social Pilot", () => {
    const source = readFileSync("app/(embedded)/(insights)/insights/page.tsx", "utf8");

    expect(source).not.toContain('authFetch("/api/social-pilot")');
    expect(source).toContain('status: "planned"');
  });
});

describe("SEO comparison-state copy", () => {
  it("distinguishes a missing comparable period from the available snapshot trend", () => {
    const source = readFileSync("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx", "utf8");

    expect(source).toContain("no non-overlapping comparison period yet");
    expect(source).toContain("Trend history is still shown above");
  });
});
