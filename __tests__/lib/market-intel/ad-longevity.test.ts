import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAdCapture: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { computeAdLongevity } from "@/lib/market-intel/ad-longevity";

const mockFindMany = prisma.competitorAdCapture.findMany as unknown as ReturnType<typeof vi.fn>;

function capture(overrides: Partial<{
  adArchiveId: string;
  competitorId: string | null;
  competitor: { name: string | null } | null;
  headline: string | null;
  headlineEn: string | null;
  adCopy: string | null;
  adCopyEn: string | null;
  activeStatus: string | null;
  capturedAt: Date;
}>) {
  return {
    adArchiveId: "arch-1",
    competitorId: "comp-1",
    competitor: { name: "Acme" },
    headline: "Buy now",
    headlineEn: null,
    adCopy: "Great deal on organic rice",
    adCopyEn: null,
    activeStatus: "ACTIVE",
    capturedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
});

describe("computeAdLongevity", () => {
  it("computes days between first and last ACTIVE capture", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ capturedAt: new Date("2026-06-01T00:00:00Z") }),
      capture({ capturedAt: new Date("2026-06-10T00:00:00Z") }),
    ]);

    const result = await computeAdLongevity();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      adArchiveId: "arch-1",
      competitor: "Acme",
      headline: "Buy now",
      daysActive: 9,
      stillActive: true,
    });
  });

  it("floors daysActive at 1 for a single capture", async () => {
    mockFindMany.mockResolvedValueOnce([capture({ capturedAt: new Date("2026-06-01T00:00:00Z") })]);

    const result = await computeAdLongevity();
    expect(result[0]!.daysActive).toBe(1);
  });

  it("flags stillActive false when the most recent capture is not ACTIVE, even with an earlier active span", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ capturedAt: new Date("2026-06-01T00:00:00Z"), activeStatus: "ACTIVE" }),
      capture({ capturedAt: new Date("2026-06-10T00:00:00Z"), activeStatus: "ACTIVE" }),
      capture({ capturedAt: new Date("2026-06-20T00:00:00Z"), activeStatus: "INACTIVE" }),
    ]);

    const result = await computeAdLongevity();
    expect(result[0]!.stillActive).toBe(false);
    // daysActive still measured against the last ACTIVE capture (Jun 10), not the later inactive one
    expect(result[0]!.daysActive).toBe(9);
  });

  it("excludes ads that were never observed ACTIVE", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ activeStatus: "INACTIVE" }),
      capture({ activeStatus: "PAUSED", capturedAt: new Date("2026-06-05") }),
    ]);

    const result = await computeAdLongevity();
    expect(result).toHaveLength(0);
  });

  it("handles gaps in captures — daysActive spans first capture to last active capture regardless of gaps", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ capturedAt: new Date("2026-05-01T00:00:00Z") }),
      // gap of many days with no capture in between
      capture({ capturedAt: new Date("2026-06-15T00:00:00Z") }),
    ]);

    const result = await computeAdLongevity();
    expect(result[0]!.daysActive).toBe(45);
  });

  it("groups by competitor + adArchiveId so a shared adArchiveId across competitors is tracked separately", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ competitorId: "comp-1", competitor: { name: "Acme" }, capturedAt: new Date("2026-06-01T00:00:00Z") }),
      capture({ competitorId: "comp-1", competitor: { name: "Acme" }, capturedAt: new Date("2026-06-11T00:00:00Z") }),
      capture({ competitorId: "comp-2", competitor: { name: "Beta" }, capturedAt: new Date("2026-06-01T00:00:00Z") }),
      capture({ competitorId: "comp-2", competitor: { name: "Beta" }, capturedAt: new Date("2026-06-03T00:00:00Z") }),
    ]);

    const result = await computeAdLongevity();
    expect(result).toHaveLength(2);
    const acme = result.find((r) => r.competitor === "Acme");
    const beta = result.find((r) => r.competitor === "Beta");
    expect(acme!.daysActive).toBe(10);
    expect(beta!.daysActive).toBe(2);
  });

  it("orders results by daysActive descending (top-N ordering)", async () => {
    mockFindMany.mockResolvedValueOnce([
      capture({ adArchiveId: "short", competitorId: "c1", competitor: { name: "Short Co" }, capturedAt: new Date("2026-06-01T00:00:00Z") }),
      capture({ adArchiveId: "short", competitorId: "c1", competitor: { name: "Short Co" }, capturedAt: new Date("2026-06-03T00:00:00Z") }),
      capture({ adArchiveId: "long", competitorId: "c2", competitor: { name: "Long Co" }, capturedAt: new Date("2026-05-01T00:00:00Z") }),
      capture({ adArchiveId: "long", competitorId: "c2", competitor: { name: "Long Co" }, capturedAt: new Date("2026-06-20T00:00:00Z") }),
    ]);

    const result = await computeAdLongevity();
    expect(result.map((r) => r.competitor)).toEqual(["Long Co", "Short Co"]);
  });

  it("caps results at 30 rows", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [
      capture({
        adArchiveId: `arch-${i}`,
        competitorId: `comp-${i}`,
        competitor: { name: `Comp ${i}` },
        capturedAt: new Date(Date.UTC(2026, 5, 1)),
      }),
      capture({
        adArchiveId: `arch-${i}`,
        competitorId: `comp-${i}`,
        competitor: { name: `Comp ${i}` },
        capturedAt: new Date(Date.UTC(2026, 5, 1 + i)),
      }),
    ]).flat();
    mockFindMany.mockResolvedValueOnce(rows);

    const result = await computeAdLongevity();
    expect(result).toHaveLength(30);
    expect(result[0]!.daysActive).toBeGreaterThanOrEqual(result[29]!.daysActive);
  });

  it("passes competitorId through to the where clause when provided", async () => {
    await computeAdLongevity("comp-42");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ competitorId: "comp-42" }) })
    );
  });

  it("returns an empty array when no captures exist", async () => {
    const result = await computeAdLongevity();
    expect(result).toEqual([]);
  });
});
