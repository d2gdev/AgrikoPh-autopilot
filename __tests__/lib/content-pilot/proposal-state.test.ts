import { describe, expect, it } from "vitest";
import { canRejectContentProposal } from "@/lib/content-pilot/proposal-state";

describe("canRejectContentProposal", () => {
  it.each([
    ["pending proposal", { status: "pending", draftStatus: null }],
    ["approved proposal", { status: "approved", draftStatus: null }],
    ["ready draft", { status: "approved", draftStatus: "ready" }],
    ["scheduled draft", { status: "approved", draftStatus: "ready", scheduledPublishAt: "2026-07-15T00:00:00Z" }],
    ["failed draft", { status: "approved", draftStatus: "failed" }],
    ["publish-error draft", { status: "approved", draftStatus: "publish-error" }],
    ["generating draft", { status: "approved", draftStatus: "generating" }],
  ])("allows rejecting a %s", (_label, proposal) => {
    expect(canRejectContentProposal(proposal)).toBe(true);
  });

  it.each([
    ["rejected proposal", { status: "rejected", draftStatus: null }],
    ["publishing draft", { status: "approved", draftStatus: "publishing" }],
    ["published draft", { status: "approved", draftStatus: "published" }],
  ])("blocks rejecting a %s", (_label, proposal) => {
    expect(canRejectContentProposal(proposal)).toBe(false);
  });
});
