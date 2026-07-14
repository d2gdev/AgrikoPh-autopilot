import { describe, expect, it } from "vitest";
import { toStoreTaskDetailDto, toStoreTaskListDto } from "@/lib/store-tasks/dto";

const base = { id: "task-1", createdAt: new Date(), taskType: "topical_map", targetType: "product", targetId: null, targetUrl: "/products/rice", title: "Review", description: "Review", priority: "high", status: "pending", completedAt: null, completionNote: null, sourceData: { source: "topical-map", executable: true, strategyVersionId: "v1", packageSha256: "a".repeat(64), ruleIds: ["rule-1"], observedAt: new Date().toISOString(), recommendationId: "rec-1", secretNested: { arbitrary: { bytes: "x".repeat(100_000) } } }, proposedState: { action: "content_update", before: { bodyHtml: "b".repeat(50_000) }, after: { bodyHtml: "a".repeat(50_000) } } };

describe("Store Task DTOs", () => {
  it("projects an explicit small source allowlist and bounded list previews", () => {
    const dto = toStoreTaskListDto(base);
    expect(dto.sourceData).not.toHaveProperty("secretNested");
    expect(dto.proposedState).toMatchObject({ before: { bodyHtml: expect.stringMatching(/^b{400}…$/) } });
    expect(JSON.stringify(dto).length).toBeLessThan(12_000);
  });
  it("allows schema-capped exact detail but rejects aggregate overflow", () => {
    expect(() => toStoreTaskDetailDto(base)).not.toThrow();
    expect(() => toStoreTaskDetailDto({ ...base, proposedState: { ...base.proposedState, after: { bodyHtml: "x".repeat(50_001) } } })).toThrow();
  });
  it("allows grouped-link detail while keeping source arrays bounded", () => {
    const grouped = toStoreTaskDetailDto({ ...base, sourceData: {
      ...base.sourceData,
      ruleIds: Array.from({ length: 26 }, (_, index) => `r-${index}`),
      links: Array.from({ length: 25 }, (_, index) => ({ toUrl: `/blogs/recipes/red-rice-${index}`, anchor: `Red rice recipe ${index}` })),
    } });
    expect(grouped.sourceData.ruleIds).toHaveLength(26);
    expect(grouped.sourceData.links).toHaveLength(25);
    expect(() => toStoreTaskDetailDto({ ...base, sourceData: { ...base.sourceData, ruleIds: Array.from({ length: 101 }, (_, index) => `r-${index}`) } })).toThrow();
  });
  it("projects bounded topical-map advisory instructions", () => {
    const sourceData = { ...base.sourceData, executable: false, advisoryReason: "canonicalization_execution_prohibited", mapPriority: "P0", proposedCanonicalUrl: "/products/rice", mapDecision: "Use the product canonical", mapEvidence: "The product owns commercial intent" };
    expect(toStoreTaskDetailDto({ ...base, priority: "P0", sourceData }).sourceData).toMatchObject({ mapPriority: "P0", proposedCanonicalUrl: "/products/rice", mapDecision: "Use the product canonical", mapEvidence: "The product owns commercial intent" });
    expect(toStoreTaskListDto({ ...base, priority: "P0", sourceData }).sourceData).toMatchObject({ mapPriority: "P0", proposedCanonicalUrl: "/products/rice" });
  });
  it("projects persisted create-only redirects in list and detail DTOs", () => {
    const redirect = {
      ...base,
      targetType: "redirect",
      targetUrl: "/old-rice",
      sourceData: { ...base.sourceData, action: "redirect_create", redirectTarget: "/products/rice" },
      proposedState: { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } },
    };
    expect(toStoreTaskListDto(redirect).proposedState).toEqual(redirect.proposedState);
    expect(toStoreTaskDetailDto(redirect).proposedState).toEqual(redirect.proposedState);
    expect(() => toStoreTaskDetailDto({ ...redirect, proposedState: { action: "redirect_create", before: { bodyHtml: "old" }, after: { bodyHtml: "new" } } })).toThrow();
  });
});
