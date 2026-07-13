import { describe, expect, it } from "vitest";
import { toStoreTaskDetailDto, toStoreTaskListDto } from "@/lib/store-tasks/dto";

const base = { id: "task-1", createdAt: new Date(), taskType: "topical_map", targetType: "product", targetId: null, targetUrl: "/products/rice", title: "Review", description: "Review", priority: "high", status: "pending", completedAt: null, completionNote: null, sourceData: { source: "topical-map", executable: true, strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], observedAt: new Date().toISOString(), recommendationId: "rec-1", secretNested: { arbitrary: { bytes: "x".repeat(100_000) } } }, proposedState: { action: "content_update", before: { bodyHtml: "b".repeat(50_000) }, after: { bodyHtml: "a".repeat(50_000) } } };

describe("Store Task DTOs", () => {
  it("projects an explicit small source allowlist and bounded list previews", () => {
    const dto = toStoreTaskListDto(base);
    expect(dto.sourceData).not.toHaveProperty("secretNested");
    expect(dto.proposedState.before?.bodyHtml).toHaveLength(401);
    expect(JSON.stringify(dto).length).toBeLessThan(12_000);
  });
  it("allows schema-capped exact detail but rejects aggregate overflow", () => {
    expect(() => toStoreTaskDetailDto(base)).not.toThrow();
    expect(() => toStoreTaskDetailDto({ ...base, proposedState: { ...base.proposedState, after: { bodyHtml: "x".repeat(50_001) } } })).toThrow();
  });
  it("rejects excessive source array counts", () => {
    expect(() => toStoreTaskDetailDto({ ...base, sourceData: { ...base.sourceData, ruleIds: Array.from({ length: 26 }, (_, index) => `r-${index}`) } })).toThrow();
  });
});
