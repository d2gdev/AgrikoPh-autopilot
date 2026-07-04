import { describe, it, expect } from "vitest";
import { buildApprovalTimeline } from "@/lib/ad-approval/timeline";

describe("buildApprovalTimeline", () => {
  it("returns [] for empty input", () => {
    expect(buildApprovalTimeline({ revisions: [], reviews: [], auditRows: [], names: {} })).toEqual([]);
  });

  it("merges revisions, reviews, and audit rows into one ascending-sorted timeline", () => {
    // Constructed out of chronological order on purpose: audit (latest) first,
    // review (middle) second, revision (earliest) last.
    const timeline = buildApprovalTimeline({
      revisions: [
        {
          revisionNumber: 2,
          submittedAt: new Date("2026-07-01T09:00:00Z"),
          statusAtSubmission: "needs_revision",
          submitterLabel: "Jamie Cruz",
        },
      ],
      reviews: [
        {
          stage: "BRAND_REVIEW",
          reviewerName: "Alex Santos",
          decision: "approved",
          score: 92,
          comments: "Looks great, ship it.",
          completedAt: new Date("2026-07-02T10:00:00Z"),
        },
      ],
      auditRows: [
        {
          createdAt: new Date("2026-07-03T11:00:00Z"),
          actor: "gid://shopify/User/123",
          action: "STATUS_CHANGED",
          meta: { reason: "advanced to Final Approver" },
        },
      ],
      names: { "gid://shopify/User/123": "Priya Nair" },
    });

    expect(timeline.map((e) => e.at)).toEqual([
      "2026-07-01T09:00:00.000Z",
      "2026-07-02T10:00:00.000Z",
      "2026-07-03T11:00:00.000Z",
    ]);

    const [revEntry, reviewEntry, auditEntry] = timeline;

    expect(revEntry).toEqual({
      at: "2026-07-01T09:00:00.000Z",
      actor: "Jamie Cruz",
      kind: "revision",
      summary: "Revision 2 submitted (from needs_revision)",
    });

    expect(reviewEntry).toEqual({
      at: "2026-07-02T10:00:00.000Z",
      actor: "Alex Santos",
      kind: "review",
      summary: 'BRAND_REVIEW: approved — score 92 — "Looks great, ship it."',
    });

    expect(auditEntry).toEqual({
      at: "2026-07-03T11:00:00.000Z",
      actor: "Priya Nair",
      kind: "audit",
      summary: "STATUS_CHANGED — advanced to Final Approver",
    });
  });

  it("falls back to the raw actor id when no name mapping exists, and keeps 'system' literal", () => {
    const timeline = buildApprovalTimeline({
      revisions: [],
      reviews: [],
      auditRows: [
        {
          createdAt: new Date("2026-07-01T00:00:00Z"),
          actor: "gid://shopify/User/999",
          action: "SUBMITTED",
          meta: null,
        },
        {
          createdAt: new Date("2026-07-01T01:00:00Z"),
          actor: "system",
          action: "AUTO_ESCALATED",
          meta: undefined,
        },
      ],
      names: {},
    });

    expect(timeline[0]!.actor).toBe("gid://shopify/User/999");
    expect(timeline[0]!.summary).toBe("SUBMITTED");
    expect(timeline[1]!.actor).toBe("system");
    expect(timeline[1]!.summary).toBe("AUTO_ESCALATED");
  });

  it("omits score/comments segments from the review summary when absent", () => {
    const timeline = buildApprovalTimeline({
      revisions: [],
      reviews: [
        {
          stage: "TECHNICAL_REVIEW",
          reviewerName: "AI Reviewer",
          decision: "rejected",
          score: null,
          comments: null,
          completedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      auditRows: [],
      names: {},
    });

    expect(timeline[0]!.summary).toBe("TECHNICAL_REVIEW: rejected");
  });

  it("trims review comments to 140 characters", () => {
    const longComment = "x".repeat(200);
    const timeline = buildApprovalTimeline({
      revisions: [],
      reviews: [
        {
          stage: "FINAL_APPROVAL",
          reviewerName: "Dana Reyes",
          decision: "approved",
          score: null,
          comments: longComment,
          completedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      auditRows: [],
      names: {},
    });

    expect(timeline[0]!.summary).toBe(`FINAL_APPROVAL: approved — "${"x".repeat(140)}"`);
  });

  it("ignores meta.reason unless meta is an object with a string reason property", () => {
    const timeline = buildApprovalTimeline({
      revisions: [],
      reviews: [],
      auditRows: [
        { createdAt: new Date("2026-07-01T00:00:00Z"), actor: "system", action: "A", meta: "not-an-object" },
        { createdAt: new Date("2026-07-01T00:00:01Z"), actor: "system", action: "B", meta: { reason: 42 } },
        { createdAt: new Date("2026-07-01T00:00:02Z"), actor: "system", action: "C", meta: { reason: "ok" } },
      ],
      names: {},
    });

    expect(timeline.map((e) => e.summary)).toEqual(["A", "B", "C — ok"]);
  });
});
