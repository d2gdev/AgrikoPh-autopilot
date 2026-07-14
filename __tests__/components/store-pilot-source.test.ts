import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Store Pilot static safety policy", () => {
  it("keeps the modal free of endpoint and proposed-state construction", () => {
    const source = readFileSync("app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx", "utf8");
    expect(source).not.toContain("/api/store-tasks/");
    expect(source).not.toContain("proposedState:");
  });
  it("lists applying/reconciliation/failed work and retries only through re-sync", () => {
    const source = readFileSync("app/(embedded)/(store-pilot)/store-pilot/page.tsx", "utf8");
    expect(source).toContain('{ label: "Applying", value: "applying" }');
    expect(source).toContain('{ label: "Reconciliation needed", value: "reconciliation_needed" }');
    expect(source).toContain('Re-sync/retry');
    expect(source).toContain('onClick={syncTopicalMap}');
    expect(source).not.toContain('retryTopicalMapStoreTask');
  });
  it("loads one selected page instead of preloading all six statuses", () => {
    const source = readFileSync("app/(embedded)/(store-pilot)/store-pilot/page.tsx", "utf8");
    expect(source).not.toContain("TASK_TABS.map(async");
    expect(source).not.toContain("taskBuckets");
    expect(source).toContain("summaryQueries.map");
    expect(source).toContain("pageSize");
  });
});
