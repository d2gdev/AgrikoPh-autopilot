#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controller = resolve(projectRoot, "scripts/codex-agent-loop.mjs");
const config = resolve(projectRoot, "config/codex-surface-loop.json");
const prompt = resolve(projectRoot, "config/codex-agent-loop/prompts/surface-integrity.md");
const [command, ...rest] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log("Usage: npm run codex:surface-loop -- start | status <run-id> | resume <run-id> [--answer-file <path>]");
  process.exitCode = 0;
} else if (!["start", "status", "resume"].includes(command)) {
  console.error("Usage: npm run codex:surface-loop -- start | status <run-id> | resume <run-id> [--answer-file <path>]");
  process.exitCode = 1;
} else if (command === "start" && rest.includes("--prompt-file")) {
  console.error("The surface-integrity prompt is fixed; do not supply --prompt-file.");
  process.exitCode = 1;
} else {
  const args = [controller, command, "--config", config];
  if (command === "start") args.push("--prompt-file", prompt);
  args.push(...rest);
  const child = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  process.exitCode = child.status ?? 1;
}
