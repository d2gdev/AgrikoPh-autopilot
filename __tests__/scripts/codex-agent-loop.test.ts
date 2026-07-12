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

function resume(runId: string, config: object, paths: ReturnType<typeof fixture>) {
  const configPath = resolve(paths.root, "resume-config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [
    controllerPath, "resume", runId, "--config", configPath, "--run-root", paths.root,
    "--codex", resolve(paths.root, "fake-codex"),
  ], { encoding: "utf8" });
  return { ...result, parsed: JSON.parse(result.stdout.trim()) };
}

function installFakeCodex(
  paths: ReturnType<typeof fixture>,
  plannerDecision: object | object[],
  executorReport: object | object[] = {
    status: "complete", outcome: "task complete", approval_required: false, approval_question: null,
    blockers: [], recommended_next_step: "review",
    runtime_impact: { production_accessed: false, deployed: false, live_changes_made: false },
  },
) {
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
  const plannerDecisions = ${JSON.stringify(Array.isArray(plannerDecision) ? plannerDecision : [plannerDecision])};
  const executorReports = ${JSON.stringify(Array.isArray(executorReport) ? executorReport : [executorReport])};
  const plannerCallsPath = ${JSON.stringify(resolve(paths.root, "planner-calls"))};
  const executorCallsPath = ${JSON.stringify(resolve(paths.root, "executor-calls"))};
  let plannerCall = 0;
  if (fs.existsSync(plannerCallsPath)) plannerCall = Number(fs.readFileSync(plannerCallsPath, "utf8"));
  let executorCall = 0;
  if (fs.existsSync(executorCallsPath)) executorCall = Number(fs.readFileSync(executorCallsPath, "utf8"));
  const isExecutor = schema.includes("execution-report");
  const response = isExecutor
    ? executorReports[Math.min(executorCall, executorReports.length - 1)]
    : plannerDecisions[Math.min(plannerCall, plannerDecisions.length - 1)];
  if (isExecutor) fs.writeFileSync(executorCallsPath, String(executorCall + 1));
  if (!schema.includes("execution-report")) fs.writeFileSync(plannerCallsPath, String(plannerCall + 1));
  fs.writeFileSync(output, JSON.stringify(response));
});
`);
  chmodSync(executable, 0o755);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("codex agent loop plan configuration", () => {
  test("does not contain a dangerous Codex bypass flag", () => {
    const source = readFileSync(controllerPath, "utf8");

    expect(source).not.toMatch(/dangerously-bypass-approvals-and-sandbox|dangerously-bypass/);
  });

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
  test("completes a two-task plan with bounded prompts and public progress evidence", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    writeFileSync(planPath, "# Plan\n\n### Task 1: First\n\n### Task 2: Second\n");
    installFakeCodex(paths, [
      {
        action: "run", reason: "task 1 complete", requires_approval: false, approval_scope: [],
        next_prompt: "Implement only Task 2.", question: null, current_task_id: "2", completed_task_ids: ["1"],
      },
      {
        action: "done", reason: "plan complete", requires_approval: false, approval_scope: [],
        next_prompt: null, question: null, current_task_id: null, completed_task_ids: ["1", "2"],
      },
    ], [
      {
        status: "complete", outcome: "Task 1 complete", approval_required: false, approval_question: null,
        blockers: [], recommended_next_step: "Task 2",
        runtime_impact: { production_accessed: false, deployed: false, live_changes_made: false },
      },
      {
        status: "complete", outcome: "Task 2 complete", approval_required: false, approval_question: null,
        blockers: [], recommended_next_step: "Review", evidence: { commit },
        runtime_impact: { production_accessed: false, deployed: false, live_changes_made: false },
      },
    ]);

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxIterations: 2, maxAutomaticWindows: 2 }, paths);
    const prompts = readFileSync(resolve(paths.root, "prompts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const executorPrompts = prompts.filter(entry => entry.schema.includes("execution-report")).map(entry => entry.prompt);
    const events = readFileSync(resolve(result.parsed.evidenceDirectory, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));

    expect(executorPrompts).toHaveLength(2);
    expect(executorPrompts[1]).toContain("Task 2");
    expect(executorPrompts[1]).not.toContain("Task 1");
    expect(result.parsed).toMatchObject({
      status: "completed", planPath, completedTaskIds: ["1", "2"],
      cumulativeIterations: 2, windows: 1, finalCommit: commit,
    });
    expect(events.filter(event => event.type === "plan_task_selected").map(event => event.details.taskId)).toEqual(["2"]);
    expect(events.filter(event => event.type === "plan_task_completed").map(event => event.details.taskId)).toEqual(["1", "2"]);
    expect(events.filter(event => event.type === "plan_completed")).toHaveLength(1);
  });

  test("still pauses when an approved plan mentions a protected deployment step", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task 1: Implement\n\n### Task 2: Deploy to production\n");
    installFakeCodex(paths, {
      action: "ask_user", reason: "deployment needs authority", requires_approval: true,
      approval_scope: ["deployment"], next_prompt: null, question: "Authorize deployment?",
      current_task_id: "2", completed_task_ids: ["1"],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 2 }, paths);

    expect(result.parsed.status).toBe("awaiting_user");
    expect(result.parsed.approvalScope).toEqual(["deployment"]);
  });

  test.each([
    ["malformed", "# Plan\n\n### Task 1 First\n"],
    ["duplicate", "# Plan\n\n### Task 1: First\n\n### Task 1: Again\n"],
  ])("interrupts safely for %s task headings", (_label, plan) => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, plan);
    installFakeCodex(paths, {
      action: "done", reason: "finished", requires_approval: false, approval_scope: [],
      next_prompt: null, question: null, current_task_id: null, completed_task_ids: [],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 2 }, paths);

    expect(result.parsed.status).toBe("interrupted");
    expect(result.parsed.reason).toContain("plan task headings");
  });

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

  test.each([
    ["unknown current task", "rogue", [], "rogue"],
    ["skipped next task", "beta", [], "beta"],
    ["unknown completed task", "alpha", ["rogue"], "rogue"],
  ])("rejects run progress with %s", (_label, currentTaskId, completedTaskIds, expected) => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task alpha: First\n\n### Task beta: Second\n");
    installFakeCodex(paths, {
      action: "run", reason: "continue", requires_approval: false, approval_scope: [],
      next_prompt: "unsafe next prompt", question: null,
      current_task_id: currentTaskId, completed_task_ids: completedTaskIds,
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 10 }, paths);

    expect(result.parsed.status).toBe("interrupted");
    expect(result.parsed.reason).toContain("invalid planner decision");
    expect(result.parsed.reason).toContain(expected);
  });

  test("resume uses the persisted plan and config instead of caller replacements", () => {
    const paths = fixture();
    const originalPlan = resolve(paths.workspace, "original-plan.md");
    const replacementPlan = resolve(paths.workspace, "replacement-plan.md");
    writeFileSync(originalPlan, "# Plan\n\n### Task alpha: First\n");
    writeFileSync(replacementPlan, "# Plan\n\n### Task replacement: Different\n");
    installFakeCodex(paths, {
      action: "done", reason: "bad", requires_approval: false, approval_scope: [],
      next_prompt: null, question: null, current_task_id: null, completed_task_ids: [],
    });
    const originalConfig = { ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath: originalPlan, maxIterations: 2, maxAutomaticWindows: 10 };
    const started = run(originalConfig, paths);
    installFakeCodex(paths, {
      action: "ask_user", reason: "pause", requires_approval: true, approval_scope: ["persisted"],
      next_prompt: null, question: "Persisted?", current_task_id: null, completed_task_ids: [],
    });

    const resumed = resume(started.parsed.runId, { ...originalConfig, planPath: replacementPlan, protectedApprovalScopes: ["replacement"] }, paths);
    const prompts = readFileSync(resolve(paths.root, "prompts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const lastPlannerPrompt = prompts.filter(entry => entry.schema.includes("planner-decision")).at(-1).prompt;

    expect(resumed.parsed.status).toBe("awaiting_user");
    expect(lastPlannerPrompt).toContain(originalPlan);
    expect(lastPlannerPrompt).not.toContain(replacementPlan);
    expect(lastPlannerPrompt).not.toContain("replacement");
  });

  test("non-plan runs accept null and empty planner progress", () => {
    const paths = fixture();
    installFakeCodex(paths, {
      action: "run", reason: "continue objective", requires_approval: false, approval_scope: [],
      next_prompt: "Continue objective", question: null, current_task_id: null, completed_task_ids: [],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: false, maxAutomaticWindows: 10 }, paths);

    expect(result.parsed.status).toBe("awaiting_user");
    expect(result.parsed.approvalScope).toEqual(["iteration_limit"]);
  });

  test("automatically advances to a second finite iteration window", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task alpha: First\n");
    installFakeCodex(paths, [
      {
        action: "run", reason: "continue", requires_approval: false, approval_scope: [],
        next_prompt: "Continue alpha", question: null, current_task_id: "alpha", completed_task_ids: [],
      },
      {
        action: "ask_user", reason: "pause", requires_approval: true, approval_scope: ["operator_choice"],
        next_prompt: null, question: "Choose?", current_task_id: "alpha", completed_task_ids: [],
      },
    ]);

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 2 }, paths);
    const state = JSON.parse(readFileSync(resolve(result.parsed.evidenceDirectory, "state.json"), "utf8"));
    const events = readFileSync(resolve(result.parsed.evidenceDirectory, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));

    expect(result.parsed.status).toBe("awaiting_user");
    expect(result.parsed.approvalScope).toEqual(["operator_choice"]);
    expect(state.windowNumber).toBe(2);
    expect(state.cumulativeIterations).toBe(2);
    expect(events.some((event) => event.type === "window_advanced")).toBe(true);
  });

  test("pauses at the finite automatic window ceiling", () => {
    const paths = fixture();
    const planPath = resolve(paths.workspace, "approved-plan.md");
    writeFileSync(planPath, "# Plan\n\n### Task alpha: First\n");
    const runDecision = {
      action: "run", reason: "continue", requires_approval: false, approval_scope: [],
      next_prompt: "Continue alpha", question: null, current_task_id: "alpha", completed_task_ids: [],
    };
    installFakeCodex(paths, [runDecision, runDecision]);

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: true, planPath, maxAutomaticWindows: 2 }, paths);

    expect(result.parsed.status).toBe("awaiting_user");
    expect(result.parsed.approvalScope).toEqual(["automatic_window_limit"]);
    expect(result.parsed.question).toContain("2 automatic windows");
  });

  test("retains the iteration limit pause when automatic continuation is disabled", () => {
    const paths = fixture();
    installFakeCodex(paths, {
      action: "run", reason: "continue", requires_approval: false, approval_scope: [],
      next_prompt: "Continue", question: null, current_task_id: null, completed_task_ids: [],
    });

    const result = run({ ...baseConfig(paths.workspace, paths.additional), autoContinuePlan: false, maxAutomaticWindows: 2 }, paths);

    expect(result.parsed.status).toBe("awaiting_user");
    expect(result.parsed.approvalScope).toEqual(["iteration_limit"]);
  });
});
