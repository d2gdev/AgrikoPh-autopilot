#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = resolve(root, ".surface-ui-loop", "state.json");
const command = process.argv[2] ?? "start";

if (command === "--help" || command === "-h") {
  console.log("Usage: npm run codex:surface-loop -- start | status");
  process.exit(0);
}

if (!new Set(["start", "status"]).has(command)) {
  console.error("Usage: npm run codex:surface-loop -- start | status");
  process.exit(1);
}

if (command === "status") {
  console.log(existsSync(statePath) ? readFileSync(statePath, "utf8") : JSON.stringify({ cleanPasses: 0, status: "not_started" }));
  process.exit(0);
}

const preflight = [
  ["typecheck", "npx", ["tsc", "--noEmit", "--incremental", "false"]],
  ["lint", "npm", ["run", "lint", "--", "--quiet"]],
];
const focusedTests = [
  "__tests__/api/content-pilot-routes.test.ts",
  "__tests__/api/growth-brief-route.test.ts",
  "__tests__/api/market-intelligence-route.test.ts",
  "__tests__/api/social-pilot-route.test.ts",
  "__tests__/components/pilot-usability-helpers.test.ts",
  "__tests__/components/social-pilot-source.test.ts",
  "__tests__/lib/content-pilot/generate-proposals.test.ts",
  "__tests__/lib/content-pilot/proposal-replacement.test.ts",
  "__tests__/lib/opportunities/generate.test.ts",
  "__tests__/scripts/codex-surface-loop.test.ts",
];
const checks = [
  ["focused-tests", "npm", ["test", "--", ...focusedTests]],
  ["diff", "git", ["diff", "--check"]],
];

for (const [name, executable, args] of preflight) {
  console.log(`[surface-loop] ${name}`);
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({ status: "failed", cleanPasses: 0, requiredCleanPasses: 5, results: [{ pass: 0, check: name, exitCode: result.status ?? 1 }], finishedAt: new Date().toISOString() }, null, 2)}\n`);
    process.exit(result.status ?? 1);
  }
}

let cleanPasses = 0;
const results = [];
for (let pass = 1; pass <= 5; pass += 1) {
  console.log(`[surface-loop] starting pass ${pass}/5`);
  const failed = checks.find(([name, executable, args]) => {
    const result = spawnSync(executable, args, { cwd: root, stdio: "inherit" });
    if (result.status === 0) return false;
    results.push({ pass, check: name, exitCode: result.status ?? 1 });
    return true;
  });
  if (failed) break;
  cleanPasses += 1;
  console.log(`[surface-loop] clean pass ${cleanPasses}/5`);
  results.push({ pass, check: "all", exitCode: 0 });
}

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, `${JSON.stringify({
  status: cleanPasses === 5 ? "clean" : "failed",
  cleanPasses,
  requiredCleanPasses: 5,
  results,
  finishedAt: new Date().toISOString(),
}, null, 2)}\n`);

process.exitCode = cleanPasses === 5 ? 0 : 1;
