import { describe, expect, it } from "vitest";
import { contentProposalQueueStage } from "@/app/(embedded)/(content-pilot)/content-pilot/components/queue-stage";

describe("Content Pilot queue publication stages", () => {
  it.each([
    ["publishing", "publishing"],
    ["publish-error", "publish-error"],
  ])("keeps a %s proposal in its reconciliation stage", (draftStatus, expected) => {
    expect(contentProposalQueueStage({ status: "approved", draftStatus } as any)).toBe(expected);
  });
});
