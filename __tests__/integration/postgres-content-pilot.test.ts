import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const url = process.env.DATABASE_URL_TEST;
const parsed = url ? new URL(url) : null;
const safe = Boolean(parsed &&
  ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
  /(?:^|[_-])test(?:$|[_-])/i.test(parsed.pathname.slice(1)));

if (url && !safe) {
  throw new Error("DATABASE_URL_TEST must point to a local disposable database whose name contains test");
}

describe.skipIf(!url)("PostgreSQL 16 Content Pilot migrations and races", () => {
  beforeAll(async () => {
    if (!safe) throw new Error("unsafe DATABASE_URL_TEST");
    await prisma.contentProposal.deleteMany({ where: { title: { startsWith: "postgres integration" } } });
    await prisma.marketKeyword.deleteMany({ where: { keyword: { startsWith: "postgres integration" } } });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("enforces canonical ContentProposal uniqueness under concurrent inserts", async () => {
    const data = {
      articleHandle: "postgres-integration",
      dedupeKey: "seo-fix:article:postgres-integration:action:missing-meta",
      proposalType: "seo-fix", changeType: "meta", priority: "P1", impact: "high", effort: "low",
      title: "postgres integration proposal", description: "race", proposedState: { issue: "missing-meta" }, sourceData: {},
    };
    const results = await Promise.allSettled([
      prisma.contentProposal.create({ data }),
      prisma.contentProposal.create({ data }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "P2002")).toHaveLength(1);
    expect(await prisma.contentProposal.count({ where: { dedupeKey: data.dedupeKey } })).toBe(1);
  });

  it("enforces null-safe MarketKeyword identity under concurrent inserts", async () => {
    const data = { keyword: "postgres integration keyword", locationName: null, languageCode: "EN", category: "seo" };
    const results = await Promise.allSettled([
      prisma.marketKeyword.create({ data }),
      prisma.marketKeyword.create({ data }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "P2002")).toHaveLength(1);
    expect(await prisma.marketKeyword.count({ where: { keyword: data.keyword } })).toBe(1);
  });
});
