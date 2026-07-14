#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

function loadConfig(path) {
  const config = readJson(path, "controller config");
  for (const role of ["executor", "planner"]) {
    if (!config[role]?.model || !config[role]?.reasoning || !config[role]?.sandbox) {
      throw new Error(`Controller config is missing ${role} model, reasoning, or sandbox`);
    }
    if (/\bsol\b/i.test(config[role].model)) {
      config[role] = {
        ...config[role],
        model: "gpt-5.6-terra",
        reasoning: "medium",
      };
    }
  }
  if (config.executor.sandbox !== "workspace-write") throw new Error("Executor sandbox must be workspace-write");
  if (config.planner.sandbox !== "read-only") throw new Error("Planner sandbox must be read-only");
  if (!existsSync(config.workingDirectory)) throw new Error(`Working directory does not exist: ${config.workingDirectory}`);
  for (const directory of config.additionalDirectories ?? []) {
    if (!existsSync(directory)) throw new Error(`Additional directory does not exist: ${directory}`);
  }
  if (!Number.isInteger(config.maxIterations) || config.maxIterations < 1) throw new Error("maxIterations must be positive");
  const requiredCleanPasses = config.requiredCleanPasses ?? 0;
  if (!Number.isInteger(requiredCleanPasses) || requiredCleanPasses < 0) {
    throw new Error("requiredCleanPasses must be a non-negative integer");
  }
  const executorRetryLimit = config.executorRetryLimit ?? 2;
  if (!Number.isInteger(executorRetryLimit) || executorRetryLimit < 0) {
    throw new Error("executorRetryLimit must be a non-negative integer");
  }
  const executorRetryDelayMs = config.executorRetryDelayMs ?? 1000;
  if (!Number.isInteger(executorRetryDelayMs) || executorRetryDelayMs < 0) {
    throw new Error("executorRetryDelayMs must be a non-negative integer");
  }
  return {
    ...config,
    requiredCleanPasses,
    executorRetryLimit,
    executorRetryDelayMs,
  };
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
  const previous = existsSync(layout.events) ? readFileSync(layout.events, "utf8") : "";
  writePrivate(layout.events, `${previous}${JSON.stringify(event)}\n`);
}

function readUsageLimitMessageFromEvents(directory) {
  try {
    const eventsPath = resolve(directory, "executor-events.jsonl");
    if (!existsSync(eventsPath)) return null;
    const raw = readFileSync(eventsPath, "utf8").trim();
    if (!raw) return null;
    const lines = raw.split(/\r?\n/).reverse();
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const message =
        parsed?.message ??
        parsed?.error?.message ??
        parsed?.details?.message ??
        null;
      if (typeof message === "string" && /usage limit/i.test(message)) {
        return message;
      }
      if (parsed?.type === "error" && typeof parsed?.error?.message === "string") {
        if (/usage limit/i.test(parsed.error.message)) return parsed.error.message;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function validateReport(report, requiredCleanPasses) {
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
  const auditPass = report.audit_pass;
  if (requiredCleanPasses > 0 && !auditPass) throw new Error("Audit profile report is missing audit_pass");
  if (auditPass !== null && auditPass !== undefined) {
    if (typeof auditPass.clean !== "boolean" || !Array.isArray(auditPass.defects) || !Array.isArray(auditPass.fixes) || !Array.isArray(auditPass.verification)) {
      throw new Error("Invalid audit_pass");
    }
    if (!auditPass.verification.length || auditPass.verification.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("Audit pass requires verification evidence");
    }
    if (auditPass.clean && (auditPass.defects.length || auditPass.fixes.length)) throw new Error("Clean audit pass cannot report defects or fixes");
    if (!auditPass.clean && !auditPass.defects.length) throw new Error("Unclean audit pass requires a defect");
  }
  return report;
}

function validateDecision(decision) {
  if (!decision || !["run", "ask_user", "done"].includes(decision.action)) throw new Error("Invalid planner action");
  if (typeof decision.reason !== "string" || !decision.reason.trim()) throw new Error("Invalid planner reason");
  if (typeof decision.requires_approval !== "boolean" || !Array.isArray(decision.approval_scope)) {
    throw new Error("Invalid planner approval fields");
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
  if (decision.action === "done" && (decision.requires_approval || decision.approval_scope.length || decision.next_prompt !== null || decision.question !== null)) {
    throw new Error("Invalid done decision");
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
  if (args.some((value) => value.includes("dangerously-bypass"))) throw new Error("Dangerous Codex bypass flag rejected");

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
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, config.timeoutMinutes * 60_000);
  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  }).finally(() => clearTimeout(timeout));

  writePrivate(eventsPath, Buffer.concat(stdout));
  writePrivate(stderrPath, Buffer.concat(stderr));
  if (timedOut || result.code !== 0) {
    rmSync(temporaryFinal, { force: true });
    throw new Error(timedOut ? `${role} timed out` : `${role} exited ${result.code} (${result.signal ?? "no signal"})`);
  }
  if (!existsSync(temporaryFinal)) throw new Error(`${role} did not produce a final JSON file`);
  const parsed = readJson(temporaryFinal, `${role} final response`);
  if (role === "executor") validateReport(parsed, config.requiredCleanPasses);
  else validateDecision(parsed);
  renameSync(temporaryFinal, finalPath);
  chmodSync(finalPath, 0o600);
  return { parsed, finalPath, eventsPath, stderrPath };
}

function executorPrompt(task, config) {
  const auditInstruction = config.requiredCleanPasses > 0
    ? `\nThis is an audit pass. Populate audit_pass with clean=true only when no defect was found. Any defect found during this pass, even if repaired, requires clean=false and lists the defect, local fix, and verification evidence.`
    : "";
  return `${task.trim()}

Return exactly one JSON execution report matching the supplied schema. Set approval_required=true whenever a new operator decision or authority is needed.${auditInstruction} Do not include prose outside the JSON object.`;
}

function plannerPrompt(state, config) {
  return `You are the read-only planning half of an automated Sol-to-Terra workflow.

Original objective:
${state.objective}

Latest Terra execution report:
${JSON.stringify(state.lastReport, null, 2)}

${state.operatorAnswer ? `Operator answer for the pending question:\n${state.operatorAnswer}\n` : ""}${config.requiredCleanPasses > 0 ? `Consecutive clean audit passes: ${state.consecutiveCleanPasses}/${config.requiredCleanPasses}. Do not return done until the requirement is met.\n` : ""}
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
  if (state.status === "awaiting_user") {
    output.question = state.pending.question;
    output.approvalScope = state.pending.approvalScope;
    output.resumeCommand = `npm run codex:loop -- resume ${state.runId} --answer-file /absolute/path/to/answer.md`;
  } else if (state.status === "interrupted") {
    output.reason = state.result?.reason;
    output.resumeCommand = `npm run codex:loop -- resume ${state.runId}`;
  } else if (state.status === "completed") {
    output.outcome = state.result?.reason;
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
  while (state.iteration < config.maxIterations) {
    if (state.phase === "executor") {
      state.iteration += 1;
      state.status = "running";
      state.operatorAnswer = null;
      if (state.executorRetryCount === undefined) state.executorRetryCount = 0;
      const directory = iterationDirectory(layout, state.iteration);
      writePrivate(resolve(directory, "executor-prompt.md"), `${state.currentPrompt.trim()}\n`);
      saveState(layout, state);
      appendEvent(layout, state, "executor_started");
      try {
        const execution = await runCodex({
          executable,
          role: "executor",
          config,
          prompt: executorPrompt(state.currentPrompt, config),
          schema: executionSchema,
          directory,
        });
        state.lastReport = execution.parsed;
        if (state.lastReport.audit_pass) {
          const auditPass = state.lastReport.audit_pass;
          state.consecutiveCleanPasses = auditPass.clean ? state.consecutiveCleanPasses + 1 : 0;
          state.auditPassLedger.push({
            iteration: state.iteration,
            clean: auditPass.clean,
            defects: auditPass.defects,
            fixes: auditPass.fixes,
            verification: auditPass.verification,
          });
        }
        state.phase = "planner";
        state.executorRetryCount = 0;
        saveState(layout, state);
        appendEvent(layout, state, "executor_completed", { status: state.lastReport.status });
      } catch (error) {
        const usageLimitMessage = readUsageLimitMessageFromEvents(directory);
        if (usageLimitMessage) {
          state.executorRetryCount = 0;
          return pause(
            layout,
            state,
            `Codex usage limit reached: ${usageLimitMessage}. Retry will fail until usage resets or credits are added.`,
            ["retry_executor"],
            "retry_executor"
          );
        }
        const nextRetryCount = (state.executorRetryCount ?? 0) + 1;
        if (nextRetryCount <= config.executorRetryLimit) {
          state.executorRetryCount = nextRetryCount;
          state.status = "running";
          state.pending = null;
          saveState(layout, state);
          appendEvent(layout, state, "executor_retry", {
            iteration: state.iteration,
            retryCount: nextRetryCount,
            retryLimit: config.executorRetryLimit,
            error: error.message,
          });
          await delay(config.executorRetryDelayMs);
          continue;
        }
        return pause(
          layout,
          state,
          `Executor stopped without a valid report: ${error.message} after ${nextRetryCount} attempts. Authorize retry after reviewing the run logs?`,
          ["retry_executor"],
          "retry_executor"
        );
      }
    }

    if (state.phase === "planner") {
      const directory = iterationDirectory(layout, state.iteration);
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
      state.lastDecision = planning.parsed;
      saveState(layout, state);
      appendEvent(layout, state, "planner_completed", { action: state.lastDecision.action });

      if (state.lastReport.approval_required && !state.operatorAnswer) {
        return pause(layout, state, state.lastReport.approval_question, ["execution_report_approval"], "planner");
      }
      if (state.lastDecision.action === "ask_user" || state.lastDecision.requires_approval) {
        return pause(layout, state, state.lastDecision.question, state.lastDecision.approval_scope, "planner");
      }
      if (state.lastDecision.action === "done") {
        if (config.requiredCleanPasses > 0 && state.consecutiveCleanPasses < config.requiredCleanPasses) {
          state.status = "interrupted";
          state.result = { reason: `Planner attempted completion before ${config.requiredCleanPasses} clean passes.` };
          saveState(layout, state);
          appendEvent(layout, state, "clean_pass_gate_rejected", state.result);
          return publicStatus(layout, state);
        }
        state.status = "completed";
        state.phase = null;
        state.pending = null;
        state.result = { reason: state.lastDecision.reason };
        saveState(layout, state);
        appendEvent(layout, state, "run_completed", state.result);
        return publicStatus(layout, state);
      }
      state.currentPrompt = state.lastDecision.next_prompt;
      state.operatorAnswer = null;
      state.executorRetryCount = 0;
      state.phase = "executor";
      saveState(layout, state);
    }
  }
  return pause(layout, state, `The controller reached its ${config.maxIterations}-iteration limit. Authorize another run with a higher limit?`, ["iteration_limit"], "planner");
}

function createState(prompt, config) {
  const timestamp = new Date().toISOString();
  return {
    version: "1.0.0",
    runId: `agent-loop-${timestamp.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    status: "running",
    phase: "executor",
    iteration: 0,
    objective: prompt,
    currentPrompt: prompt,
    lastReport: null,
    lastDecision: null,
    operatorAnswer: null,
    pending: null,
    result: null,
    executorRetryCount: 0,
    consecutiveCleanPasses: 0,
    auditPassLedger: [],
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
  const config = loadConfig(configPath);
  let state;
  let layout;

  if (options.command === "start") {
    if (!options["prompt-file"]) throw new Error("start requires --prompt-file");
    const promptPath = absolutePath(options["prompt-file"]);
    const prompt = readFileSync(promptPath, "utf8").trim();
    if (!prompt) throw new Error("Prompt file is empty");
    state = createState(prompt, config);
    layout = runLayout(runRoot, state.runId);
    ensureLayout(layout);
    writePrivate(resolve(layout.inputs, "initial-prompt.md"), `${prompt}\n`);
    saveState(layout, state);
    appendEvent(layout, state, "run_created", { configPath });
  } else {
    const runId = options.positional[0];
    if (!runId) throw new Error("resume requires a run id");
    layout = runLayout(runRoot, runId);
    ensureLayout(layout);
    state = readJson(layout.state, "run state");
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
      const storedAnswer = resolve(layout.inputs, `answer-${String(state.iteration).padStart(4, "0")}.md`);
      writePrivate(storedAnswer, `${answer}\n`);
      state.operatorAnswer = answer;
      state.phase = state.pending.kind === "retry_executor" ? "executor" : "planner";
      if (state.pending.kind === "retry_executor") {
        state.executorRetryCount = 0;
      }
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
