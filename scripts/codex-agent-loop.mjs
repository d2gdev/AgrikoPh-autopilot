#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  lstatSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:fs";
import { dirname, isAbsolute, relative as relativePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const PROTECTED_SCOPES = ["new_authority", "production_access", "deployment", "live_shopify_or_meta_write", "production_database_change", "credential_or_permission_change", "destructive_or_irreversible_action", "scope_expansion", "strategy_activation"];
const digest = (value) => createHash("sha256").update(value).digest("hex");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfig = resolve(projectRoot, "config/codex-agent-loop.json");
const executionSchema = resolve(projectRoot, "config/codex-agent-loop/execution-report.schema.json");
const decisionSchema = resolve(projectRoot, "config/codex-agent-loop/planner-decision.schema.json");

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!["start", "resume", "status"].includes(command)) {
    throw new Error("Usage: npm run codex:loop -- start --prompt-file <path> | resume <run-id> [--answer-file <path>] | status <run-id>");
  }
  const options = { command, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      options.positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function absolutePath(value, base = process.cwd()) {
  return isAbsolute(value) ? value : resolve(base, value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}: ${error.message}`);
  }
}

function pathWithin(candidate, root) {
  const relative = relativePath(realpathSync(root), realpathSync(candidate));
  return relative === "" || (!relative.startsWith("..") && !isAbsolute(relative));
}

function isWithinReadableWorkspace(path, config) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.R_OK);
    return [config.workingDirectory, ...(config.additionalDirectories ?? [])]
      .some((root) => pathWithin(path, root));
  } catch {
    return false;
  }
}

function normalizeConfig(parsed) {
  const config = { ...parsed, autoContinuePlan: parsed.autoContinuePlan ?? false };
  for (const role of ["executor", "planner"]) {
    if (!config[role]?.model || !config[role]?.reasoning || !config[role]?.sandbox) {
      throw new Error(`Controller config is missing ${role} model, reasoning, or sandbox`);
    }
  }
  if (config.executor.sandbox !== "workspace-write") throw new Error("Executor sandbox must be workspace-write");
  if (config.planner.sandbox !== "read-only") throw new Error("Planner sandbox must be read-only");
  if (!existsSync(config.workingDirectory)) throw new Error(`Working directory does not exist: ${config.workingDirectory}`);
  for (const directory of config.additionalDirectories ?? []) {
    if (!existsSync(directory)) throw new Error(`Additional directory does not exist: ${directory}`);
  }
  if (!Number.isInteger(config.maxIterations) || config.maxIterations < 1) throw new Error("maxIterations must be positive");
  if (!Number.isInteger(config.maxAutomaticWindows) || config.maxAutomaticWindows < 1) {
    throw new Error("maxAutomaticWindows must be positive");
  }
  if (!Array.isArray(config.protectedApprovalScopes) || config.protectedApprovalScopes.length !== new Set(config.protectedApprovalScopes).size || config.protectedApprovalScopes.some((scope) => !PROTECTED_SCOPES.includes(scope)) || PROTECTED_SCOPES.some((scope) => !config.protectedApprovalScopes.includes(scope))) throw new Error("protectedApprovalScopes must contain exactly the complete protected set");
  if (config.autoContinuePlan) {
    if (typeof config.planPath !== "string" || !config.planPath.trim()) {
      throw new Error("planPath is required when autoContinuePlan is true");
    }
    const planPath = absolutePath(config.planPath, config.workingDirectory);
    if (!existsSync(planPath)) throw new Error("Plan file does not exist");
    if (!statSync(planPath).isFile()) throw new Error("Plan path must be a regular readable file");
    try {
      accessSync(planPath, constants.R_OK);
    } catch {
      throw new Error("Plan path must be a regular readable file");
    }
    if (!isWithinReadableWorkspace(planPath, config)) {
      throw new Error("Plan path must be inside a configured workspace");
    }
    config.planPath = planPath;
  } else {
    config.planPath = null;
  }
  return config;
}

function loadConfig(path) {
  return normalizeConfig(readJson(path, "controller config"));
}

function runLayout(runRoot, runId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error("Unsafe run id");
  const runDir = resolve(runRoot, ".codex-agent-loop", "runs", runId);
  return {
    runDir,
    state: resolve(runDir, "state.json"),
    events: resolve(runDir, "events.jsonl"),
    lock: resolve(runDir, "lock.json"),
    inputs: resolve(runDir, "inputs"),
    iterations: resolve(runDir, "iterations"),
  };
}

function ensureLayout(layout) {
  for (const path of [layout.runDir, layout.inputs, layout.iterations]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
}

function assertContainedRealPath(candidate, root, kind = "path") {
  if (!existsSync(candidate)) throw new Error(`Missing ${kind}: ${candidate}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Symlinked ${kind} is not allowed`);
  if (!pathWithin(candidate, root)) throw new Error(`${kind} escapes run directory`);
}

function validateState(state, layout) {
  if (!state || state.version !== "1.0.0" || typeof state.runId !== "string") throw new Error("Invalid persisted run state identity");
  if (!['running','awaiting_user','interrupted','completed'].includes(state.status)) throw new Error("Invalid persisted run state status");
  if (!["executor", "planner", null].includes(state.phase)) throw new Error("Invalid persisted run state phase");
  for (const key of ["iteration", "cumulativeIterations", "windowNumber", "answerSequence"]) if (!Number.isInteger(state[key]) || state[key] < 0) throw new Error(`Invalid persisted run state ${key}`);
  if (state.windowNumber < 1 || state.iteration > state.config.maxIterations || state.cumulativeIterations < state.iteration) throw new Error("Invalid persisted run counters");
  if (!Array.isArray(state.completedTaskIds) || new Set(state.completedTaskIds).size !== state.completedTaskIds.length) throw new Error("Invalid persisted plan progress");
  if (state.status === "awaiting_user" && (!state.pending || typeof state.pending.question !== "string" || !Array.isArray(state.pending.approvalScope))) throw new Error("Invalid persisted pending approval");
  if (state.status !== "awaiting_user" && state.pending !== null) throw new Error("Unexpected persisted pending approval");
  for (const path of [layout.runDir, layout.inputs, layout.iterations, layout.state]) assertContainedRealPath(path, layout.runDir, "run evidence");
  if (state.planSnapshotPath) assertContainedRealPath(resolve(layout.runDir, state.planSnapshotPath), layout.runDir, "plan snapshot");
  if (state.reconciliation !== null && state.reconciliation !== undefined) {
    const r = state.reconciliation;
    if (r.kind !== "executor_failure_reconciliation" || !r.before?.identity || !r.after?.identity || typeof r.failedPromptDigest !== "string" || typeof r.failedPrompt !== "string") throw new Error("Invalid persisted reconciliation evidence");
  }
  return state;
}

function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function saveState(layout, state) {
  state.updatedAt = new Date().toISOString();
  const temporary = `${layout.state}.${process.pid}.tmp`;
  writePrivate(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, layout.state);
  chmodSync(layout.state, 0o600);
}

function appendEvent(layout, state, type, details = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    runId: state.runId,
    iteration: state.iteration,
    phase: state.phase,
    type,
    details,
  };
  appendFileSync(layout.events, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  chmodSync(layout.events, 0o600);
}

function repositoryFingerprint(cwd) {
  const git = (...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  const status = git("status", "--porcelain=v1", "--untracked-files=all");
  const diff = git("diff", "--binary", "HEAD");
  return { head: head.status === 0 ? head.stdout.trim() : null, identity: digest(`${status.stdout}\0${diff.stdout}`) };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(layout, runId) {
  if (existsSync(layout.lock)) {
    const existing = readJson(layout.lock, "run lock");
    if (processAlive(existing.pid)) throw new Error(`Run is already active under PID ${existing.pid}`);
    unlinkSync(layout.lock);
  }
  const fd = openSync(layout.lock, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify({ runId, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } finally {
    closeSync(fd);
  }
  return () => {
    try {
      const current = readJson(layout.lock, "run lock");
      if (current.pid === process.pid) unlinkSync(layout.lock);
    } catch {}
  };
}

function validateReport(report) {
  if (!report || !["complete", "blocked", "failed"].includes(report.status)) throw new Error("Invalid execution report status");
  if (typeof report.outcome !== "string" || !report.outcome.trim()) throw new Error("Invalid execution report outcome");
  if (typeof report.approval_required !== "boolean") throw new Error("Invalid execution report approval_required");
  if (report.approval_required && (typeof report.approval_question !== "string" || !report.approval_question.trim())) {
    throw new Error("Approval-required report is missing approval_question");
  }
  if (!report.approval_required && report.approval_question !== null) throw new Error("Non-approval report must use approval_question=null");
  if (!Array.isArray(report.blockers)) throw new Error("Invalid execution report blockers");
  for (const key of ["production_accessed", "deployed", "live_changes_made"]) {
    if (typeof report.runtime_impact?.[key] !== "boolean") throw new Error(`Invalid runtime_impact.${key}`);
  }
  if (report.evidence !== undefined) {
    const keys = report.evidence && typeof report.evidence === "object" && !Array.isArray(report.evidence)
      ? Object.keys(report.evidence)
      : [];
    if (keys.length !== 1 || keys[0] !== "commit" || typeof report.evidence.commit !== "string" || !/^[0-9a-f]{7,64}$/i.test(report.evidence.commit)) {
      throw new Error("Invalid execution report evidence");
    }
  }
  return report;
}

function planTaskIds(planPath) {
  const source = readFileSync(planPath, "utf8");
  const identifiers = [];
  const taskHeadingLines = [...source.matchAll(/^### Task.*$/gm)].map((match) => match[0]);
  const headings = source.matchAll(/^### Task ([^:\r\n]+):[ \t]*(\S[^\r\n]*)$/gm);
  for (const heading of headings) identifiers.push(heading[1].trim());
  if (!identifiers.length || identifiers.length !== taskHeadingLines.length || identifiers.some((id) => !id)) {
    throw new Error("invalid plan task headings: every task must use '### Task <unique-id>: <title>'");
  }
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("invalid plan task headings: task identifiers must be unique");
  }
  return identifiers;
}

function validateDecision(decision, config) {
  if (!decision || !["run", "ask_user", "done"].includes(decision.action)) throw new Error("Invalid planner action");
  if (typeof decision.reason !== "string" || !decision.reason.trim()) throw new Error("Invalid planner reason");
  if (typeof decision.requires_approval !== "boolean" || !Array.isArray(decision.approval_scope)) {
    throw new Error("Invalid planner approval fields");
  }
  if (decision.approval_scope.length !== new Set(decision.approval_scope).size || decision.approval_scope.some((scope) => !config.protectedApprovalScopes.includes(scope))) throw new Error("Invalid planner approval_scope");
  if (!Array.isArray(decision.completed_task_ids) || decision.completed_task_ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Invalid planner completed_task_ids");
  }
  if (decision.current_task_id !== null && (typeof decision.current_task_id !== "string" || !decision.current_task_id.trim())) {
    throw new Error("Invalid planner current_task_id");
  }
  if (decision.action === "run") {
    if (decision.requires_approval || decision.approval_scope.length || typeof decision.next_prompt !== "string" || !decision.next_prompt.trim() || decision.question !== null) {
      throw new Error("Unsafe run decision");
    }
  }
  if (decision.action === "ask_user") {
    if (!decision.requires_approval || !decision.approval_scope.length || decision.next_prompt !== null || typeof decision.question !== "string" || !decision.question.trim()) {
      throw new Error("Invalid ask_user decision");
    }
  }
  if (decision.action === "done" && (decision.requires_approval || decision.approval_scope.length || decision.next_prompt !== null || decision.question !== null || decision.current_task_id !== null)) {
    throw new Error("Invalid done decision");
  }
  if (config.autoContinuePlan) {
    const expected = planTaskIds(config.planPath);
    const completed = decision.completed_task_ids;
    const invalidCompletedIndex = completed.findIndex((id, index) => id !== expected[index]);
    if (invalidCompletedIndex !== -1 || completed.length > expected.length) {
      const invalidId = completed[invalidCompletedIndex === -1 ? expected.length : invalidCompletedIndex];
      throw new Error(`invalid planner decision: completed_task_ids must be an ordered approved prefix (invalid: ${JSON.stringify(invalidId)})`);
    }
    if (decision.action === "run") {
      const next = expected[completed.length];
      if (!next || decision.current_task_id !== next) {
        throw new Error(`invalid planner decision: current_task_id must be next incomplete task ${JSON.stringify(next ?? null)} (received: ${JSON.stringify(decision.current_task_id)})`);
      }
      const prompt = decision.next_prompt;
      const obligations = [
        [new RegExp(`Task\\s+${next.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "i"), "current task ID"],
        [/TDD|RED\/GREEN/i, "TDD"], [/verif/i, "verification"], [/commit/i, "commit"], [/GROW/i, "GROW"], [/(exclude|do not implement|out[- ]of[- ]scope|later task)/i, "later-task exclusion"],
      ];
      for (const [pattern, label] of obligations) if (!pattern.test(prompt)) throw new Error(`invalid planner decision: next_prompt missing ${label}`);
    }
    if (decision.action === "done" && completed.length !== expected.length) {
      const missing = expected.slice(completed.length);
      throw new Error(`invalid planner decision: plan completion mismatch (missing: ${JSON.stringify(missing)}, unknown: [])`);
    }
  }
  return decision;
}

async function runCodex({ executable, role, config, prompt, schema, directory }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const finalPath = resolve(directory, `${role}-final.json`);
  const temporaryFinal = `${finalPath}.${process.pid}.tmp`;
  const eventsPath = resolve(directory, `${role}-events.jsonl`);
  const stderrPath = resolve(directory, `${role}-stderr.log`);
  const settings = config[role];
  const args = [
    "exec",
    "-m", settings.model,
    "-c", `model_reasoning_effort="${settings.reasoning}"`,
    "-s", settings.sandbox,
    "-C", config.workingDirectory,
  ];
  for (const path of config.additionalDirectories ?? []) args.push("--add-dir", path);
  args.push("--ephemeral", "--output-schema", schema, "--json", "-o", temporaryFinal, "-");
  const forbiddenBypassPrefix = ["dangerously", "bypass"].join("-");
  if (args.some((value) => value.includes(forbiddenBypassPrefix))) throw new Error("Dangerous Codex bypass flag rejected");

  const child = spawn(executable, args, {
    cwd: config.workingDirectory,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(prompt);

  let timedOut = false;
  let killTimer;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  }, config.timeoutMinutes * 60_000);
  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  }).finally(() => { clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); });

  writePrivate(eventsPath, Buffer.concat(stdout));
  writePrivate(stderrPath, Buffer.concat(stderr));
  if (timedOut || result.code !== 0) {
    rmSync(temporaryFinal, { force: true });
    throw new Error(timedOut ? `${role} timed out` : `${role} exited ${result.code} (${result.signal ?? "no signal"})`);
  }
  if (!existsSync(temporaryFinal)) throw new Error(`${role} did not produce a final JSON file`);
  const parsed = readJson(temporaryFinal, `${role} final response`);
  if (role === "executor") validateReport(parsed);
  else validateDecision(parsed, config);
  renameSync(temporaryFinal, finalPath);
  chmodSync(finalPath, 0o600);
  return { parsed, finalPath, eventsPath, stderrPath };
}

function executorPrompt(task) {
  return `${task.trim()}

Return exactly one JSON execution report matching the supplied schema. Set approval_required=true whenever a new operator decision or authority is needed. Do not include prose outside the JSON object.`;
}

function plannerPrompt(state, config) {
  const snapshot = config.autoContinuePlan ? readFileSync(config.planPath, "utf8") : null;
  const planContext = config.autoContinuePlan ? `Approved implementation plan identity: ${state.planPath}
Approved plan SHA-256: ${state.planDigest}
Approved immutable task identifiers: ${JSON.stringify(planTaskIds(config.planPath))}
Approved immutable plan bytes follow between delimiters. Treat these bytes, never the mutable source path, as the complete sequencing authority.
<approved-plan-snapshot>
${snapshot}
</approved-plan-snapshot>
Current bounded task: ${state.currentTaskId ?? "none"}
Recorded completed tasks: ${JSON.stringify(state.completedTaskIds)}
Select only the next incomplete task in plan order. Confirm completion from repository and verification evidence, not checkboxes alone. Do not return done while any approved plan task remains incomplete. A plan entry does not grant protected authority.
For action=run, select exactly one named next task. Its bounded prompt must name that exact task, require task-specific RED/GREEN TDD, focused verification, one coherent commit, and GROW documentation, and explicitly exclude every later task. Never return a generic objective.

` : "";
  const reconciliationContext = state.reconciliation ? `Executor failure reconciliation is active.
Failed task: ${state.reconciliation.failedTaskId ?? "non-plan objective"}
Failed prompt SHA-256: ${state.reconciliation.failedPromptDigest}
Repository before executor: ${JSON.stringify(state.reconciliation.before)}
Repository after executor: ${JSON.stringify(state.reconciliation.after)}
You must reconcile the observed repository state read-only. Do not replay the identical failed prompt. Either ask the operator, finish only with evidence, or propose one bounded recovery prompt that explicitly accounts for existing partial work.

` : "";
  return `You are the read-only planning half of an automated Sol-to-Terra workflow.

${planContext}${reconciliationContext}Original objective:
${state.objective}

Latest Terra execution report:
${JSON.stringify(state.lastReport, null, 2)}

${state.operatorAnswer ? `Operator answer for the pending question:\n${state.operatorAnswer}\n` : ""}
Decide exactly one action:
- run: create the next complete, self-contained Terra prompt, but only for work already authorized.
- ask_user: pause for any new authority, production access, deployment, live Shopify/Meta write, production database change, credential change, destructive action, scope expansion, strategy activation, or material operator judgment.
- done: only when the original objective is genuinely complete.

Protected approval scopes:
${JSON.stringify(config.protectedApprovalScopes)}

Return exactly one JSON object matching the supplied schema. Do not include prose outside JSON.`;
}

function iterationDirectory(layout, iteration) {
  return resolve(layout.iterations, String(iteration).padStart(4, "0"));
}

function publicStatus(layout, state) {
  const output = {
    status: state.status,
    runId: state.runId,
    iteration: state.iteration,
    evidenceDirectory: layout.runDir,
  };
  if (state.planPath) {
    output.planPath = state.planPath;
    output.currentTaskId = state.currentTaskId;
    output.completedTaskIds = [...state.completedTaskIds];
    output.cumulativeIterations = state.cumulativeIterations;
    output.windows = state.windowNumber;
  }
  if (state.status === "awaiting_user") {
    output.question = state.pending.question;
    output.approvalScope = state.pending.approvalScope;
    output.resumeCommand = `npm run codex:loop -- resume ${state.runId} --answer-file /absolute/path/to/answer.md`;
  } else if (state.status === "interrupted") {
    output.reason = state.result?.reason;
    output.resumeCommand = `npm run codex:loop -- resume ${state.runId}`;
  } else if (state.status === "completed") {
    output.outcome = state.result?.reason;
    const finalCommit = state.lastReport?.evidence?.commit;
    if (typeof finalCommit === "string" && /^[0-9a-f]{7,64}$/i.test(finalCommit)) output.finalCommit = finalCommit;
  }
  return output;
}

function pause(layout, state, question, approvalScope, kind) {
  state.status = "awaiting_user";
  state.pending = { kind, question, approvalScope };
  saveState(layout, state);
  appendEvent(layout, state, "approval_paused", { question, approvalScope, kind });
  return publicStatus(layout, state);
}

async function continueRun(layout, state, config, executable) {
  while (true) {
    while (state.iteration < config.maxIterations) {
      if (state.phase === "executor") {
      state.iteration += 1;
      state.cumulativeIterations += 1;
      state.status = "running";
      state.operatorAnswer = null;
      const directory = iterationDirectory(layout, state.cumulativeIterations);
      writePrivate(resolve(directory, "executor-prompt.md"), `${state.currentPrompt.trim()}\n`);
      saveState(layout, state);
      appendEvent(layout, state, "executor_started");
      state.preExecutorFingerprint = repositoryFingerprint(config.workingDirectory);
      saveState(layout, state);
      try {
        const execution = await runCodex({
          executable,
          role: "executor",
          config,
          prompt: executorPrompt(state.currentPrompt),
          schema: executionSchema,
          directory,
        });
        state.lastReport = execution.parsed;
        state.phase = "planner";
        saveState(layout, state);
        appendEvent(layout, state, "executor_completed", { status: state.lastReport.status });
      } catch (error) {
        state.postExecutorFingerprint = repositoryFingerprint(config.workingDirectory);
        state.reconciliation = {
          kind: "executor_failure_reconciliation",
          before: state.preExecutorFingerprint,
          after: state.postExecutorFingerprint,
          failedTaskId: state.currentTaskId,
          failedPrompt: state.currentPrompt,
          failedPromptDigest: digest(state.currentPrompt),
        };
        state.phase = "planner";
        return pause(layout, state, `Executor stopped without a valid report: ${error.message}. Review repository evidence before read-only reconciliation.`, ["new_authority"], "reconcile_executor");
      }
    }

      if (state.phase === "planner") {
      const directory = iterationDirectory(layout, state.cumulativeIterations);
      writePrivate(resolve(directory, "planner-input.md"), `${plannerPrompt(state, config)}\n`);
      appendEvent(layout, state, "planner_started");
      let planning;
      try {
        planning = await runCodex({
          executable,
          role: "planner",
          config,
          prompt: plannerPrompt(state, config),
          schema: decisionSchema,
          directory,
        });
      } catch (error) {
        state.status = "interrupted";
        state.result = { reason: `Planner stopped: ${error.message}` };
        saveState(layout, state);
        appendEvent(layout, state, "planner_interrupted", state.result);
        return publicStatus(layout, state);
      }
      const previousTaskId = state.currentTaskId;
      const previousCompletedTaskIds = [...state.completedTaskIds];
      state.lastDecision = planning.parsed;
      if (state.reconciliation && state.lastDecision.action === "run" && digest(state.lastDecision.next_prompt.trim()) === state.reconciliation.failedPromptDigest) {
        state.status = "interrupted";
        state.result = { reason: "Reconciliation rejected an identical failed executor prompt replay" };
        saveState(layout, state);
        appendEvent(layout, state, "reconciliation_replay_rejected", state.result);
        return publicStatus(layout, state);
      }
      state.currentTaskId = state.lastDecision.current_task_id;
      state.completedTaskIds = [...new Set(state.lastDecision.completed_task_ids)];
      saveState(layout, state);
      appendEvent(layout, state, "planner_completed", { action: state.lastDecision.action });
      for (const taskId of state.completedTaskIds.slice(previousCompletedTaskIds.length)) {
        appendEvent(layout, state, "plan_task_completed", { taskId });
      }
      if (state.currentTaskId && state.currentTaskId !== previousTaskId) {
        appendEvent(layout, state, "plan_task_selected", { taskId: state.currentTaskId });
      }

      if (state.lastReport?.approval_required && !state.operatorAnswer) {
        return pause(layout, state, state.lastReport.approval_question, ["execution_report_approval"], "planner");
      }
      if (state.lastReport && Object.values(state.lastReport.runtime_impact).some(Boolean)) {
        return pause(layout, state, "Protected runtime impact was reported. Automatic execution is halted.", ["protected_runtime_impact"], "protected_runtime_impact");
      }
      if (state.lastDecision.action === "ask_user" || state.lastDecision.requires_approval) {
        return pause(layout, state, state.lastDecision.question, state.lastDecision.approval_scope, "planner");
      }
      if (state.lastDecision.action === "done") {
        state.status = "completed";
        state.phase = null;
        state.pending = null;
        state.result = { reason: state.lastDecision.reason };
        saveState(layout, state);
        if (state.planPath) appendEvent(layout, state, "plan_completed", { completedTaskIds: state.completedTaskIds });
        appendEvent(layout, state, "run_completed", state.result);
        return publicStatus(layout, state);
      }
      state.currentPrompt = state.lastDecision.next_prompt;
      state.reconciliation = null;
      state.operatorAnswer = null;
      state.phase = "executor";
      saveState(layout, state);
      }
    }

    if (!config.autoContinuePlan) {
      return pause(layout, state, `The controller reached its ${config.maxIterations}-iteration limit. Authorize another run with a higher limit?`, ["iteration_limit"], "planner");
    }
    if (state.windowNumber >= config.maxAutomaticWindows) {
      return pause(layout, state, `The controller reached its safety ceiling of ${config.maxAutomaticWindows} automatic windows. Authorize continuation?`, ["automatic_window_limit"], "planner");
    }
    state.windowNumber += 1;
    state.iteration = 0;
    appendEvent(layout, state, "window_advanced", { windowNumber: state.windowNumber });
    saveState(layout, state);
  }
}

function createState(prompt, config) {
  const timestamp = new Date().toISOString();
  return {
    version: "1.0.0",
    runId: `agent-loop-${timestamp.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    status: "running",
    phase: config.autoContinuePlan ? "planner" : "executor",
    iteration: 0,
    planPath: config.planPath,
    currentTaskId: null,
    completedTaskIds: [],
    cumulativeIterations: 0,
    windowNumber: 1,
    objective: prompt,
    currentPrompt: prompt,
    lastReport: null,
    lastDecision: null,
    operatorAnswer: null,
    pending: null,
    answerSequence: 0,
    reconciliation: null,
    result: null,
    config,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const runRoot = absolutePath(options["run-root"] ?? projectRoot);
  const executable = options.codex ? absolutePath(options.codex) : "codex";

  if (options.command === "status") {
    const runId = options.positional[0];
    if (!runId) throw new Error("status requires a run id");
    const layout = runLayout(runRoot, runId);
    console.log(JSON.stringify(publicStatus(layout, readJson(layout.state, "run state"))));
    return;
  }

  const configPath = absolutePath(options.config ?? defaultConfig);
  let config;
  let state;
  let layout;

  if (options.command === "start") {
    config = loadConfig(configPath);
    if (!options["prompt-file"]) throw new Error("start requires --prompt-file");
    const promptPath = absolutePath(options["prompt-file"]);
    const prompt = readFileSync(promptPath, "utf8").trim();
    if (!prompt) throw new Error("Prompt file is empty");
    state = createState(prompt, config);
    layout = runLayout(runRoot, state.runId);
    ensureLayout(layout);
    if (config.autoContinuePlan) {
      const bytes = readFileSync(config.planPath);
      const snapshot = resolve(layout.inputs, "approved-plan.md");
      writePrivate(snapshot, bytes);
      state.planSnapshotPath = relativePath(layout.runDir, snapshot);
      state.planDigest = digest(bytes);
      config = { ...config, planPath: snapshot };
    }
    writePrivate(resolve(layout.inputs, "initial-prompt.md"), `${prompt}\n`);
    saveState(layout, state);
    appendEvent(layout, state, "run_created", { configPath });
  } else {
    const runId = options.positional[0];
    if (!runId) throw new Error("resume requires a run id");
    layout = runLayout(runRoot, runId);
    ensureLayout(layout);
    state = readJson(layout.state, "run state");
    validateState(state, layout);
    config = normalizeConfig(state.config);
    if (state.planSnapshotPath) {
      const snapshot = resolve(layout.runDir, state.planSnapshotPath);
      if (!pathWithin(snapshot, layout.runDir) || digest(readFileSync(snapshot)) !== state.planDigest) throw new Error("Persisted plan snapshot or digest is invalid");
      config = { ...config, planPath: snapshot };
    }
    if (state.status === "completed") {
      console.log(JSON.stringify(publicStatus(layout, state)));
      return;
    }
    if (state.status === "awaiting_user") {
      if (!options["answer-file"]) {
        console.log(JSON.stringify(publicStatus(layout, state)));
        return;
      }
      const answerPath = absolutePath(options["answer-file"]);
      const answer = readFileSync(answerPath, "utf8").trim();
      if (!answer) throw new Error("Answer file is empty");
      state.answerSequence = (state.answerSequence ?? 0) + 1;
      const storedAnswer = resolve(layout.inputs, `answer-${String(state.answerSequence).padStart(4, "0")}.md`);
      const answerFd = openSync(storedAnswer, "wx", 0o600);
      try { writeFileSync(answerFd, `${answer}\n`); } finally { closeSync(answerFd); }
      state.operatorAnswer = answer;
      state.phase = "planner";
      state.pending = null;
      state.status = "running";
      saveState(layout, state);
      appendEvent(layout, state, "operator_answer_recorded", { answerFile: storedAnswer });
    } else if (state.status === "interrupted") {
      state.status = "running";
      state.phase = "planner";
      saveState(layout, state);
    }
  }

  const release = acquireLock(layout, state.runId);
  try {
    const output = await continueRun(layout, state, config, executable);
    console.log(JSON.stringify(output));
  } finally {
    release();
  }
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: "failed",
    outcome: error.message,
    approval_required: false,
    approval_question: null,
    blockers: [error.message],
    recommended_next_step: "Correct the reported local controller error and rerun the command.",
    runtime_impact: {
      production_accessed: false,
      deployed: false,
      live_changes_made: false
    }
  }));
  process.exitCode = 1;
});
