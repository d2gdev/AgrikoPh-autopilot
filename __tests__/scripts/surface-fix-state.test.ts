import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadState, saveState, transition } from "../../scripts/surface-fix-state.mjs";

describe("surface fix state", () => {
  it("persists and resumes a redacted deployment phase", () => {
    const root = mkdtempSync(`${tmpdir()}/surface-fix-state-`);
    try {
      const initial = { runId: "seo-pilot", phase: "deploying", evidence: { expectedCommit: "abc" } };
      saveState(root, initial.runId, initial);
      const resumed = transition(loadState(root, initial.runId), "verifying", { healthStatus: "ok" });
      saveState(root, initial.runId, resumed);
      expect(loadState(root, initial.runId)).toMatchObject({ phase: "verifying", evidence: { expectedCommit: "abc", healthStatus: "ok" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
