import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireAppAuth: vi.fn(), requirePermission: vi.fn(), getSessionUser: vi.fn(), getSessionShop: vi.fn() }));
const db = vi.hoisted(() => ({ contentProposal: { findMany: vi.fn() } }));
const gen = vi.hoisted(() => ({ generateProposalDraft: vi.fn() }));
const pub = vi.hoisted(() => ({ publishContentProposal: vi.fn() }));
vi.mock("@/lib/auth", () => ({ ...auth, PERMISSIONS: { CONTENT_PUBLISH: "content:publish" } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/content-pilot/generation-service", () => gen);
vi.mock("@/lib/content-pilot/publish-service", () => pub);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }));
vi.mock("@/lib/content-pilot/detect-filipino", () => ({ detectFilipino: vi.fn(() => ({ isFilipino: true })), extractDraftText: vi.fn(() => "mga ito ay ang mga") }));
const req = (body: unknown) => new Request("http://localhost/api/content-pilot/regenerate-filipino", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
describe("regenerate Filipino", () => {
  beforeEach(() => { vi.clearAllMocks(); auth.requireAppAuth.mockResolvedValue(null); auth.requirePermission.mockResolvedValue(null); auth.getSessionUser.mockResolvedValue("op"); auth.getSessionShop.mockResolvedValue("shop"); db.contentProposal.findMany.mockResolvedValue([]); });
  it.each([{}, { proposalIds: [] }, { proposalIds: Array.from({ length: 26 }, (_, i) => String(i)), confirmation: "REGENERATE_FILIPINO", republishPublished: false }, { proposalIds: ["a", "a"], confirmation: "REGENERATE_FILIPINO", republishPublished: false }, { proposalIds: ["a"], confirmation: "bad", republishPublished: false }])("rejects invalid body %#", async (body) => { const { POST } = await import("@/app/api/content-pilot/regenerate-filipino/route"); expect((await POST(req(body))).status).toBe(400); expect(gen.generateProposalDraft).not.toHaveBeenCalled(); expect(pub.publishContentProposal).not.toHaveBeenCalled(); });
  it("never widens omitted selection", async () => { const { POST } = await import("@/app/api/content-pilot/regenerate-filipino/route"); expect((await POST(req({ proposalIds: [], confirmation: "REGENERATE_FILIPINO", republishPublished: false }))).status).toBe(400); expect(db.contentProposal.findMany).not.toHaveBeenCalled(); });
  it("returns conflict for unknown IDs", async () => { const { POST } = await import("@/app/api/content-pilot/regenerate-filipino/route"); const r = await POST(req({ proposalIds: ["missing"], confirmation: "REGENERATE_FILIPINO", republishPublished: false })); expect(r.status).toBe(207); expect((await r.json()).counts.conflict).toBe(1); });
});
