import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(embedded)/(store-pilot)/store-pilot/page.tsx", "utf8");
const modal = () => readFileSync("app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx", "utf8");

describe("Store Pilot topical-map workflow source", () => {
  it("syncs the topical map and reloads all task buckets", () => {
    expect(page).toContain("Sync topical map");
    expect(page).toContain('authFetch("/api/store-tasks/topical-map/sync"');
    expect(page).toMatch(/syncTopicalMap[\s\S]*await loadTasks\(\)/);
  });

  it("keeps map actions distinct from ordinary completion", () => {
    expect(page).toContain("Apply");
    expect(page).toContain("Dismiss");
    expect(page).toMatch(/isTopicalMapTask[\s\S]*executable/);
    expect(page).toContain("Complete");
  });

  it("only the modal confirmation invokes the apply endpoint and reloads on success", () => {
    expect(page).toContain('`/api/store-tasks/${selectedMapTask.id}/apply`');
    expect(page).toMatch(/applySelectedMapTask[\s\S]*await loadTasks\(\)/);
    expect(modal()).toContain("onConfirm");
    expect(modal()).not.toContain("/api/store-tasks/");
  });

  it("retains actionable API errors and success feedback", () => {
    expect(page).toContain("Toast");
    expect(page).toContain("Banner");
    expect(page).toContain("json.error");
    expect(page).toContain("topical-map change was applied");
  });
});
