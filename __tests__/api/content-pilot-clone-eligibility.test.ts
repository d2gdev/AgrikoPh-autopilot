import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ app: vi.fn(), permission: vi.fn() }));
const db = vi.hoisted(() => ({ contentProposal: { findUnique: vi.fn(), create: vi.fn() } }));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: auth.app,
  requirePermission: auth.permission,
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.app.mockResolvedValue(null);
  auth.permission.mockResolvedValue(null);
});

describe("Content Pilot clone eligibility", () => {
  it("refuses to duplicate an invalid historical search-query proposal", async () => {
    db.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      proposalType: "new-content",
      title: "rice -filetype:pdf -site:example.com",
      proposedState: { targetKeyword: "rice -filetype:pdf -site:example.com" },
      sourceData: { impressions: 100 },
    });
    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/clone/route");
    const response = await POST(new Request("http://test.local/clone", { method: "POST" }), { params: Promise.resolve({ id: "proposal-1" }) });

    expect(response.status).toBe(409);
    expect(db.contentProposal.create).not.toHaveBeenCalled();
  });

  it("does not create a second proposal that bypasses canonical history", async () => {
    db.contentProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      proposalType: "content-refresh",
      title: "Refresh mapped rice guide",
      proposedState: { targetUrl: "/blogs/news/rice-guide" },
      sourceData: {},
    });
    const { POST } = await import("@/app/api/content-pilot/proposals/[id]/clone/route");
    const response = await POST(new Request("http://test.local/clone", { method: "POST" }), {
      params: Promise.resolve({ id: "proposal-1" }),
    });

    expect(response.status).toBe(409);
    expect(db.contentProposal.create).not.toHaveBeenCalled();
  });
});
