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
      links: Array.from({ length: 25 }, (_, index) => ({ toUrl: `/blogs/recipes/red-rice-${index}`, anchor: `Red rice recipe ${index}`, linkPurpose: "Recipe discovery", requiredAction: "Add exact link", verification: "Exact href present", priority: "P1", resolutionStatus: "resolved" })),
    } });
    expect(grouped.sourceData.ruleIds).toHaveLength(26);
    expect(grouped.sourceData.links).toHaveLength(25);
    expect(grouped.sourceData.links?.[0]).toMatchObject({ linkPurpose: "Recipe discovery", requiredAction: "Add exact link", verification: "Exact href present", priority: "P1", resolutionStatus: "resolved" });
    expect(() => toStoreTaskDetailDto({ ...base, sourceData: { ...base.sourceData, ruleIds: Array.from({ length: 101 }, (_, index) => `r-${index}`) } })).toThrow();
  });
  it("keeps a 51-rule grouped task listable through a bounded rule preview", () => {
    const dto = toStoreTaskListDto({
      ...base,
      sourceData: { ...base.sourceData, ruleIds: Array.from({ length: 51 }, (_, index) => `r-${index}`) },
    });
    expect(dto.sourceData.ruleIds).toHaveLength(25);
    expect(dto.sourceData.ruleCount).toBe(51);
  });
  it("projects bounded topical-map advisory instructions", () => {
    const sourceData = { ...base.sourceData, executable: false, advisoryReason: "canonicalization_execution_prohibited", mapPriority: "P0", proposedCanonicalUrl: "/products/rice", mapDecision: "Use the product canonical", mapEvidence: "The product owns commercial intent", mapPublishingState: "published" };
    expect(toStoreTaskDetailDto({ ...base, priority: "P0", sourceData }).sourceData).toMatchObject({ mapPriority: "P0", proposedCanonicalUrl: "/products/rice", mapDecision: "Use the product canonical", mapEvidence: "The product owns commercial intent", mapPublishingState: "published" });
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
  it("projects bounded redirect repairs and keeps replacement bodies detail-only", () => {
    const update = {
      ...base,
      targetType: "redirect",
      sourceData: { ...base.sourceData, action: "redirect_update", redirectId: "redirect-1", observedRedirectTarget: "/middle", redirectTarget: "/final" },
      proposedState: { action: "redirect_update", before: { id: "redirect-1", target: "/middle" }, after: { target: "/final" } },
    };
    expect(toStoreTaskListDto(update).proposedState).toEqual(update.proposedState);
    expect(toStoreTaskDetailDto(update).sourceData).toMatchObject({ redirectId: "redirect-1", redirectTarget: "/final" });

    const replacement = {
      ...base,
      targetType: "article",
      sourceData: { ...base.sourceData, action: "internal_link_replace", replacements: [{ fromUrl: "/products/old", toUrl: "/products/new" }] },
      proposedState: { action: "internal_link_replace", before: { bodyHtml: "<a href=\"/products/old\">Rice</a>" }, after: { bodyHtml: "<a href=\"/products/new\">Rice</a>" } },
    };
    expect(toStoreTaskListDto(replacement).sourceData).not.toHaveProperty("replacements");
    expect(toStoreTaskListDto(replacement).proposedState).toEqual({ action: "internal_link_replace" });
    expect(toStoreTaskDetailDto(replacement).sourceData).toMatchObject({ replacements: [{ fromUrl: "/products/old", toUrl: "/products/new" }] });
  });
  it("projects bounded redirect-conflict observation evidence", () => {
    const sourceData = { ...base.sourceData, executable: false, advisoryReason: "redirect_conflict", resolutionStatus: "resolved", mapProposedRedirectTarget: "/products/rice", observedRedirectTarget: "/pages/wrong", observedRedirectId: "redirect-7", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "b".repeat(64) };
    const expected = { advisoryReason: "redirect_conflict", resolutionStatus: "resolved", mapProposedRedirectTarget: "/products/rice", observedRedirectTarget: "/pages/wrong", observedRedirectId: "redirect-7", observedAt: "2026-07-14T00:00:00.000Z", observedStateHash: "b".repeat(64) };
    expect(toStoreTaskListDto({ ...base, targetUrl: "/old-rice", sourceData }).sourceData).toMatchObject(expected);
    expect(toStoreTaskDetailDto({ ...base, targetUrl: "/old-rice", sourceData }).sourceData).toMatchObject(expected);
  });
});
