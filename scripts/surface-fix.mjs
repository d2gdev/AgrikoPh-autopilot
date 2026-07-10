import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { loadState, saveState, transition } from "./surface-fix-state.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [surface, ...flags] = process.argv.slice(2);
if (!surface) throw new Error("Usage: node scripts/surface-fix.mjs <surface> [--fix|--deploy]");
const deploy = flags.includes("--deploy");
const fix = deploy || flags.includes("--fix");
if (flags.some((flag) => flag !== "--fix" && flag !== "--deploy")) throw new Error("Unknown surface-fix flag");
const runId = surface.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let state = loadState(root, runId) ?? { runId, surface, mode: deploy ? "deploy" : fix ? "fix" : "audit", phase: "audit", evidence: {} };
state = transition(state, state.phase, { expectedCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() });
saveState(root, runId, state);
if (deploy && state.phase !== "deploying" && state.phase !== "verifying") {
  state = transition(state, "deploying");
  saveState(root, runId, state);
  execFileSync("node", ["scripts/git-deploy.mjs"], { cwd: root, stdio: "inherit" });
}
if (deploy && state.phase === "deploying") {
  const deadline = Date.now() + 90_000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const output = execFileSync("ssh", ["autopilot-prod", "cd /opt/autopilot && git rev-parse HEAD && stat -c %Y .next/BUILD_ID && pm2 pid autopilot"], { encoding: "utf8" }).trim().split(/\r?\n/);
      last = { commit: output[0], buildIdMtime: output[1], pm2Pid: output[2] };
      if (last.commit === state.evidence.expectedCommit && last.buildIdMtime && last.pm2Pid) {
        state = transition(state, "verifying", { remote: last });
        saveState(root, runId, state);
        break;
      }
    } catch { /* retain redacted last observation only */ }
    execFileSync("sleep", ["3"]);
  }
  if (state.phase === "deploying") {
    state = transition(state, "failed", { remote: last, error: "deployment polling timed out" });
    saveState(root, runId, state);
    throw new Error("Deployment polling timed out");
  }
}
if (deploy && state.phase === "verifying") {
  const health = execFileSync("curl", ["-fsS", "https://autopilot.agrikoph.com/api/health"], { encoding: "utf8" });
  const parsedHealth = JSON.parse(health);
  if (parsedHealth.status !== "ok") throw new Error("Deployment health did not report ok");
  state = transition(state, "deployed", { healthStatus: "ok" });
  saveState(root, runId, state);
}
console.log(JSON.stringify(state));
