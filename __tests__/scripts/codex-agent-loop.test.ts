import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
