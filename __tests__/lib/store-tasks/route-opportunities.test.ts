import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldRouteOpportunityToStoreTask,
  storeTaskFromOpportunity,
  upsertStoreTasksFromOpportunities,
} from "@/lib/store-tasks/route-opportunities";

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    type: "competitor_price_change",
    targetType: "competitor_product",
    targetId: "store:item",
    targetUrl: null,
    targetName: "Organic rice",
    priority: "P1",
    evidence: { priceDeltaPct: -20 },
    proposedAction: {
      title: "Competitor price changed",
      description: "Review competitor price movement.",
      action: "review_competitor_price",
    },
    status: "open",
    ...overrides,
  };
}

const mockPrisma = {
  storeTask: {
    upsert: vi.fn(),
  },
  opportunity: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.storeTask.upsert.mockResolvedValue({ id: "task-1" });
  mockPrisma.opportunity.update.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
});

describe("shouldRouteOpportunityToStoreTask", () => {
  it("routes market/store opportunities and skips article content opportunities", () => {
    expect(shouldRouteOpportunityToStoreTask({ type: "competitor_price_change", targetType: "competitor_product" })).toBe(true);
    expect(shouldRouteOpportunityToStoreTask({ type: "competitor_ad_change", targetType: "competitor_ad" })).toBe(true);
    expect(shouldRouteOpportunityToStoreTask({ type: "ctr_gap", targetType: "article" })).toBe(false);
    expect(shouldRouteOpportunityToStoreTask({ type: "content_gap", targetType: "keyword" })).toBe(false);
  });
});

describe("storeTaskFromOpportunity", () => {
  it("maps a store opportunity to a manual StoreTask input", () => {
    const task = storeTaskFromOpportunity(opportunity());

    expect(task).toMatchObject({
      taskType: "competitor_price_change",
      targetType: "competitor_product",
      targetId: "store:item",
      title: "Competitor price changed",
      description: "Review competitor price movement.",
      opportunityId: "opp-1",
      dedupeKey: "store-task:opp-1",
    });
  });

  it("groups competitor ad opportunities by page and insight type", () => {
    const task = storeTaskFromOpportunity(opportunity({
      id: "opp-ad-1",
      type: "competitor_ad_change",
      targetType: "competitor_ad",
      targetId: "ad-1",
      targetName: "Healthy Options has an ad running 92 days",
      evidence: {
        insightType: "long_running_competitor_ad",
        evidence: {
          pageName: "Healthy Options",
          adArchiveId: "123",
        },
      },
      proposedAction: {
        title: "Healthy Options has an ad running 92 days",
        description: "Nourish Your Weight Loss Journey",
        action: "review_market_insight",
      },
    }));

    expect(task).toMatchObject({
      taskType: "competitor_ad_change",
      targetType: "competitor_ad_group",
      targetId: "long_running_competitor_ad:Healthy Options",
      title: "Review long-running Meta ads from Healthy Options",
      opportunityId: "opp-ad-1",
      dedupeKey: "store-task:competitor_ad_change:long_running_competitor_ad:Healthy Options",
      proposedState: {
        action: "review_competitor_ads",
        pageName: "Healthy Options",
        insightType: "long_running_competitor_ad",
      },
      sourceData: {
        opportunityType: "competitor_ad_change",
        grouped: true,
      },
    });
  });

  it("returns null for article opportunities", () => {
    expect(storeTaskFromOpportunity(opportunity({ type: "ctr_gap", targetType: "article" }))).toBeNull();
  });
});

describe("upsertStoreTasksFromOpportunities", () => {
  it("upserts tasks and links routed opportunities", async () => {
    const result = await upsertStoreTasksFromOpportunities(mockPrisma as any, [opportunity()]);

    expect(result).toEqual({ routed: 1 });
    expect(mockPrisma.storeTask.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: "store-task:opp-1" },
      create: expect.objectContaining({
        taskType: "competitor_price_change",
        opportunityId: "opp-1",
        dedupeKey: "store-task:opp-1",
      }),
      update: expect.objectContaining({
        taskType: "competitor_price_change",
        opportunityId: "opp-1",
      }),
    });
    expect(mockPrisma.opportunity.update).toHaveBeenLastCalledWith({
      where: { id: "opp-1" },
      data: {
        routedToId: "task-1",
      },
    });
  });
});
