import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canEditContentProposal,
  canGenerateContentProposal,
  canRejectContentProposal,
  isContentProposalStatusPublishable,
  reopenedContentProposalState,
} from "@/lib/content-pilot/proposal-state";

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

describe("publishable Content Proposal states", () => {
  it.each(["approved", "override_approved"])("accepts %s", (status) => {
    expect(isContentProposalStatusPublishable(status)).toBe(true);
    expect(canGenerateContentProposal({ status })).toBe(true);
    expect(canEditContentProposal({ status, draftStatus: "ready" })).toBe(true);
  });

  it.each(["pending", "rejected", "published", null, undefined])("rejects %s", (status) => {
    expect(isContentProposalStatusPublishable(status)).toBe(false);
    expect(canGenerateContentProposal({ status })).toBe(false);
    expect(canEditContentProposal({ status, draftStatus: "ready" })).toBe(false);
  });

  it("requires a ready draft before editing", () => {
    expect(canEditContentProposal({ status: "approved", draftStatus: "generating" })).toBe(false);
  });
});

describe("reopenedContentProposalState", () => {
  it("returns a coherent pending state when reopening", () => {
    expect(reopenedContentProposalState()).toEqual({
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      draftStatus: null,
      draftContent: Prisma.JsonNull,
      draftError: null,
      draftGeneratedAt: null,
      citations: Prisma.JsonNull,
      scheduledPublishAt: null,
      draftGenerationToken: null,
      draftGenerationStartedAt: null,
      publishOperationId: null,
      publishStartedAt: null,
      publishFinalizedAt: null,
      publishWarning: null,
    });
  });
});
