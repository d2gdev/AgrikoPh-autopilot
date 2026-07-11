import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockNotifyJobFailure = vi.hoisted(() => vi.fn());
const mockFetchMarketIntelHandler = vi.hoisted(() => vi.fn());
const mockFetchKeywordResearchHandler = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PERMISSIONS: { CONTENT_REVIEW: "content:review" },
  requireAppAuth: mockAuth.requireAppAuth,
  requirePermission: mockAuth.requirePermission,
  requireCronAuth: vi.fn(() => null),
}));

vi.mock("@/lib/jobs/orchestrator", () => ({
  enqueueJob: (...args: Parameters<typeof mockEnqueueJob>) => mockEnqueueJob(...args),
}));

vi.mock("@/lib/alerts", () => ({
  notifyJobFailure: (...args: Parameters<typeof mockNotifyJobFailure>) => mockNotifyJobFailure(...args),
}));

vi.mock("@/jobs/fetch-market-intel", () => ({
  fetchMarketIntelHandler: (...args: Parameters<typeof mockFetchMarketIntelHandler>) =>
    mockFetchMarketIntelHandler(...args),
}));

vi.mock("@/jobs/fetch-keyword-research", () => ({
  fetchKeywordResearchHandler: (...args: Parameters<typeof mockFetchKeywordResearchHandler>) =>
    mockFetchKeywordResearchHandler(...args),
}));

import { POST as triggerPOST } from "@/app/api/market-intelligence/trigger/route";
import { POST as keywordPOST } from "@/app/api/market-intelligence/keyword-research/route";
import { GET as cronMarketIntelGET } from "@/app/api/cron/fetch-market-intel/route";
import { GET as cronKeywordGET } from "@/app/api/cron/fetch-keyword-research/route";

describe("market intelligence queue routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.requirePermission.mockResolvedValue(null);
    mockEnqueueJob.mockResolvedValue({
      runId: "run-1",
      status: "queued",
      created: true,
    });
    mockNotifyJobFailure.mockReset();
    mockFetchMarketIntelHandler.mockResolvedValue({
      jobName: "fetch-market-intel",
      runId: "run-fallback",
      status: "success",
      summary: {},
      errors: [],
    });
    mockFetchKeywordResearchHandler.mockResolvedValue({
      jobName: "fetch-keyword-research",
      runId: "run-fallback",
      status: "success",
      summary: {},
      errors: [],
    });
  });

  it("queues manual capture runs and does not execute inline", async () => {
    const res = await triggerPOST(
      new Request("http://test.local/api/market-intelligence/trigger", {
        method: "POST",
        body: JSON.stringify({ profile: "shopping" }),
      }),
    );

    expect(res.status).toBe(202);
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      jobName: "fetch-market-intel",
      triggeredBy: "user",
      input: { profile: "shopping" },
    });
    expect(mockFetchMarketIntelHandler).not.toHaveBeenCalled();
  });

  it("queues manual keyword research runs and does not execute inline", async () => {
    const res = await keywordPOST(
      new Request("http://test.local/api/market-intelligence/keyword-research", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(202);
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      jobName: "fetch-keyword-research",
      triggeredBy: "user",
    });
    expect(mockFetchKeywordResearchHandler).not.toHaveBeenCalled();
  });

  it("rejects a forbidden user before manual queue work", async () => {
    mockAuth.requirePermission.mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const triggerResponse = await triggerPOST(
      new Request("http://test.local/api/market-intelligence/trigger", { method: "POST" }),
    );
    const keywordResponse = await keywordPOST(
      new Request("http://test.local/api/market-intelligence/keyword-research", { method: "POST" }),
    );

    expect(triggerResponse.status).toBe(403);
    expect(keywordResponse.status).toBe(403);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(mockAuth.requirePermission).toHaveBeenCalledTimes(2);
    expect(mockAuth.requirePermission).toHaveBeenNthCalledWith(1, expect.any(Request), "content:review");
  });

  it("queues cron capture runs", async () => {
    const res = await cronMarketIntelGET(new Request("http://test.local/api/cron/fetch-market-intel", {
      headers: { authorization: "Bearer secret" },
    }));

    expect(res.status).toBe(202);
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      jobName: "fetch-market-intel",
      triggeredBy: "cron",
      input: { profile: "scheduled" },
    });
    expect(mockFetchMarketIntelHandler).not.toHaveBeenCalled();
  });

  it("queues cron keyword research runs and errors do not invoke handlers", async () => {
    const res = await cronKeywordGET(new Request("http://test.local/api/cron/fetch-keyword-research", {
      headers: { authorization: "Bearer secret" },
    }));

    expect(res.status).toBe(202);
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      jobName: "fetch-keyword-research",
      triggeredBy: "cron",
    });
    expect(mockFetchKeywordResearchHandler).not.toHaveBeenCalled();
  });

  it("returns inline-fallback-free 500 response when enqueue fails for manual capture", async () => {
    mockEnqueueJob.mockRejectedValueOnce(new Error("queue unavailable"));

    const res = await triggerPOST(
      new Request("http://test.local/api/market-intelligence/trigger", {
        method: "POST",
        body: JSON.stringify({ profile: "shopping" }),
      }),
    );

    expect(res.status).toBe(500);
    expect(mockFetchMarketIntelHandler).not.toHaveBeenCalled();
    expect(mockNotifyJobFailure).toHaveBeenCalled();
  });

  it("returns inline-fallback-free 500 response when enqueue fails for manual keyword research", async () => {
    mockEnqueueJob.mockRejectedValueOnce(new Error("queue unavailable"));

    const res = await keywordPOST(
      new Request("http://test.local/api/market-intelligence/keyword-research", { method: "POST" }),
    );

    expect(res.status).toBe(500);
    expect(mockFetchKeywordResearchHandler).not.toHaveBeenCalled();
    expect(mockNotifyJobFailure).toHaveBeenCalled();
  });

  it("returns inline-fallback-free 500 response when enqueue fails for cron routes", async () => {
    mockEnqueueJob.mockRejectedValueOnce(new Error("queue unavailable"));

    const res = await cronMarketIntelGET(
      new Request("http://test.local/api/cron/fetch-market-intel", {
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(res.status).toBe(500);
    expect(mockFetchMarketIntelHandler).not.toHaveBeenCalled();
    expect(mockNotifyJobFailure).toHaveBeenCalled();
  });
});
