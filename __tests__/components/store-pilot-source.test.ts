import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Store Pilot static safety policy", () => {
  it("keeps the modal free of endpoint and proposed-state construction", () => {
    const source = readFileSync("app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx", "utf8");
    expect(source).not.toContain("/api/store-tasks/");
    expect(source).not.toContain("proposedState:");
  });
});
