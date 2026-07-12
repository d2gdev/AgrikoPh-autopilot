import { chmodSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { rmSync } from "node:fs";

const controllerPath = resolve(process.cwd(), "scripts/codex-agent-loop.mjs");
const temporaryRoots: string[] = [];

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "codex-agent-loop-test-"));
  temporaryRoots.push(root);
  const workspace = resolve(root, "workspace");
  const additional = resolve(root, "additional");
  mkdirSync(workspace);
  mkdirSync(additional);
  const promptPath = resolve(root, "prompt.md");
  writeFileSync(promptPath, "Test objective\n");
  return { root, workspace, additional, promptPath };
}

function baseConfig(workspace: string, additional: string) {
  return {
    executor: { model: "test-executor", reasoning: "medium", sandbox: "workspace-write" },
    planner: { model: "test-planner", reasoning: "high", sandbox: "read-only" },
    workingDirectory: workspace,
    additionalDirectories: [additional],
    maxIterations: 1,
    timeoutMinutes: 1,
    protectedApprovalScopes: [],
  };
}

function run(config: object, paths: ReturnType<typeof fixture>) {
  const configPath = resolve(paths.root, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [
    controllerPath,
    "start",
    "--config", configPath,
    "--prompt-file", paths.promptPath,
    "--run-root", paths.root,
    "--codex", resolve(paths.root, "fake-codex"),
  ], { encoding: "utf8" });
  return { ...result, parsed: JSON.parse(result.stdout.trim()) };
}

function installFakeCodex(paths: ReturnType<typeof fixture>, plannerDecision: object) {
  const executable = resolve(paths.root, "fake-codex");
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args[args.indexOf("-o") + 1];
const schema = args[args.indexOf("--output-schema") + 1];
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => prompt += chunk);
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(resolve(paths.root, "prompts.jsonl"))}, JSON.stringify({ schema, prompt }) + "\\n");
  const response = schema.includes("execution-report")
    ? { status: "complete", outcome: "task complete", approval_required: false, approval_question: null, blockers: [], recommended_next_step: "review", runtime_impact: { production_accessed: false, deployed: false, live_changes_made: false } }
    : ${JSON.stringify(plannerDecision)};
  fs.writeFileSync(output, JSON.stringify(response));
});
`);
  chmodSync(executable, 0o755);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("codex agent loop plan configuration", () => {
  test("requires a plan path when automatic plan continuation is enabled", () => {
    const paths = fixture();
    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, maxAutomaticWindows: 10 }, paths);

    expect(result.status).toBe(1);
    expect(result.parsed.outcome).toContain("planPath is required when autoContinuePlan is true");
  });

  test("rejects plan paths outside configured workspaces", () => {
    const paths = fixture();
    const planPath = resolve(paths.root, "outside.md");
    writeFileSync(planPath, "# Outside\n");
    const outside = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 10 }, paths);

    expect(outside.parsed.outcome).toContain("Plan path must be inside a configured workspace");
  });

  test("rejects plan paths whose real path escapes configured workspaces", () => {
    const paths = fixture();
    const outsidePath = resolve(paths.root, "outside.md");
    const linkedPath = resolve(paths.workspace, "linked-plan.md");
    writeFileSync(outsidePath, "# Outside\n");
    symlinkSync(outsidePath, linkedPath);
    const outside = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath: "linked-plan.md", maxAutomaticWindows: 10 }, paths);

    expect(outside.parsed.outcome).toContain("Plan path must be inside a configured workspace");
  });

  test("rejects a missing plan file", () => {
    const paths = fixture();
    const missing = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath: "missing.md", maxAutomaticWindows: 10 }, paths);

    expect(missing.parsed.outcome).toContain("Plan file does not exist");
  });

  test("requires a positive integer automatic window ceiling", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "plan.md");
    writeFileSync(planPath, "# Plan\n");
    const badCeiling = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 0 }, paths);

    expect(badCeiling.parsed.outcome).toContain("maxAutomaticWindows must be positive");
  });

  test("allows automatic plan continuation to be disabled without a plan path", () => {
    const paths = fixture();
    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: false, maxAutomaticWindows: 10 }, paths);

    expect(result.status).toBe(0);
    expect(result.parsed.question).toContain("fake-codex");
    expect(result.parsed.question).not.toContain("planPath");
  });
});

describe("codex agent loop plan progress", () => {
  test("initializes progress and gives Sol the approved-plan contract", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task alpha: First\n");
    installFakeCodex(paths, {
      action: "ask_user", reason: "need authority", requires_approval: true, approval_scope: ["scope"],
      next_prompt: null, question: "Authorize?", current_task_id: null, completed_task_ids: [],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath: "approved-plan.md", maxAutomaticWindows: 10 }, paths);
    const state = JSON.parse(readFileSync(resolve(result.parsed.evidenceDirectory, "state.json"), "utf8"));
    const prompts = readFileSync(resolve(paths.root, "prompts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const planner = prompts.find(entry => entry.schema.includes("planner-decision")).prompt;

    expect(state.planPath).toBe(planPath);
    expect(state.currentTaskId).toBeNull();
    expect(state.completedTaskIds).toEqual([]);
    expect(state.cumulativeIterations).toBe(1);
    expect(state.windowNumber).toBe(1);
    expect(planner).toContain(planPath);
    expect(planner).toContain("Select only the next incomplete task in plan order");
    expect(planner).toContain("Protected approval scopes:");
    expect(planner).toContain("Do not return done while any approved plan task remains incomplete");
  });

  test("rejects done when completed task identifiers omit an approved plan task", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task alpha: First\n\n### Task beta: Second\n");
    installFakeCodex(paths, {
      action: "done", reason: "finished", requires_approval: false, approval_scope: [],
      next_prompt: null, question: null, current_task_id: null, completed_task_ids: ["alpha"],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 10 }, paths);

    expect(result.parsed.status).toBe("interrupted");
    expect(result.parsed.reason).toContain("invalid planner decision");
    expect(result.parsed.reason).toContain("beta");
  });
});
