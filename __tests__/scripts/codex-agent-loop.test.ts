import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(__dirname, "../..");
const controller = resolve(projectRoot, "scripts/codex-agent-loop.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function executionReport(clean: boolean) {
  return {
    status: "complete",
    outcome: clean ? "Pass clean." : "Defect repaired.",
    approval_required: false,
    approval_question: null,
    blockers: [],
    recommended_next_step: "Continue the audit loop.",
    audit_pass: {
      clean,
      defects: clean ? [] : ["A persisted field was absent from the operator DTO."],
      fixes: clean ? [] : ["Added the persisted field to the DTO."],
      verification: ["focused tests passed"],
    },
    runtime_impact: {
      production_accessed: false,
      deployed: false,
      live_changes_made: false,
    },
  };
}

function plannerDecision(action: "run" | "done") {
  return {
    action,
    reason: action === "done" ? "The audit requirement is satisfied." : "Run the next audit pass.",
    requires_approval: false,
    approval_scope: [],
    next_prompt: action === "run" ? "Run the next complete audit pass." : null,
    question: null,
  };
}

function runLoop(replies: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), "codex-surface-loop-"));
  temporaryDirectories.push(directory);
  const fakeCodex = join(directory, "fake-codex.mjs");
  const repliesPath = join(directory, "replies.json");
  const cursorPath = join(directory, "cursor.txt");
  const configPath = join(directory, "config.json");
  const promptPath = join(directory, "prompt.md");
  const runRoot = join(directory, "runs");

  writeFileSync(repliesPath, JSON.stringify(replies));
  writeFileSync(cursorPath, "0");
  writeFileSync(configPath, JSON.stringify({
    executor: { model: "fake", reasoning: "low", sandbox: "workspace-write" },
    planner: { model: "fake", reasoning: "low", sandbox: "read-only" },
    workingDirectory: projectRoot,
    maxIterations: 12,
    timeoutMinutes: 1,
    requiredCleanPasses: 5,
    protectedApprovalScopes: [],
  }));
  writeFileSync(promptPath, "Run the audit loop.");
  writeFileSync(fakeCodex, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const replies = JSON.parse(readFileSync(${JSON.stringify(repliesPath)}, "utf8"));
const cursor = Number(readFileSync(${JSON.stringify(cursorPath)}, "utf8"));
const output = process.argv[process.argv.indexOf("-o") + 1];
writeFileSync(output, JSON.stringify(replies[cursor]));
writeFileSync(${JSON.stringify(cursorPath)}, String(cursor + 1));
`);
  chmodSync(fakeCodex, 0o755);

  const result = spawnSync(process.execPath, [
    controller,
    "start",
    "--config", configPath,
    "--run-root", runRoot,
    "--codex", fakeCodex,
    "--prompt-file", promptPath,
  ], { cwd: projectRoot, encoding: "utf8" });

  const output = JSON.parse(result.stdout.trim());
  const statePath = join(runRoot, ".codex-agent-loop", "runs", output.runId, "state.json");
  return { output, state: JSON.parse(readFileSync(statePath, "utf8")) };
}

describe("codex agent loop clean audit passes", () => {
  it("completes only after five consecutive clean audit passes", () => {
    const replies = [
      executionReport(true), plannerDecision("run"),
      executionReport(true), plannerDecision("run"),
      executionReport(true), plannerDecision("run"),
      executionReport(true), plannerDecision("run"),
      executionReport(true), plannerDecision("done"),
    ];

    const { output, state } = runLoop(replies);

    expect(output.status).toBe("completed");
    expect(state.consecutiveCleanPasses).toBe(5);
    expect(state.auditPassLedger).toHaveLength(5);
  });

  it("resets the clean-pass counter when a pass repairs a defect", () => {
    const replies = [
      executionReport(true), plannerDecision("run"),
      executionReport(true), plannerDecision("run"),
      executionReport(false), plannerDecision("run"),
      executionReport(true), plannerDecision("done"),
    ];

    const { output, state } = runLoop(replies);

    expect(output.status).toBe("interrupted");
    expect(output.reason).toContain("5 clean passes");
    expect(state.consecutiveCleanPasses).toBe(1);
    expect(state.auditPassLedger.map((pass: { clean: boolean }) => pass.clean)).toEqual([true, true, false, true]);
  });
});
