import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { loadState, saveState, transition } from "./surface-fix-state.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const [surface, ...rawFlags] = args;
if (!surface) throw new Error("Usage: node scripts/surface-fix.mjs <surface> [--fix|--deploy] [--resume=<run-id>|--resume <run-id>]");

const parsed = {
  flags: new Set(),
  resumeRunId: null,
};
for (let i = 0; i < rawFlags.length; i++) {
  const flag = rawFlags[i];
  if (flag === "--fix") {
    parsed.flags.add("fix");
    continue;
  }
  if (flag === "--deploy") {
    parsed.flags.add("deploy");
    continue;
  }
  if (flag === "--resume") {
    const next = rawFlags[i + 1];
    if (!next) throw new Error("--resume requires a run id: --resume <run-id>");
    parsed.resumeRunId = next;
    i += 1;
    continue;
  }
  if (flag.startsWith("--resume=")) {
    parsed.resumeRunId = flag.slice("--resume=".length);
    continue;
  }

  throw new Error("Unknown surface-fix flag");
}

const deploy = parsed.flags.has("deploy");
const fix = deploy || parsed.flags.has("fix");
const runIdFromSurface = surface.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normalizeRunId = (value) => value.replace(/\.json$/i, "");
const runMarker = parsed.resumeRunId
  ? normalizeRunId(parsed.resumeRunId)
  : `${runIdFromSurface}-${new Date().toISOString().replace(/[:.]/g, "-")}-${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim()}`;

let state = loadState(root, runMarker);
if (!state) {
  state = {
    runId: runMarker,
    surface,
    mode: deploy ? "deploy" : fix ? "fix" : "audit",
    phase: "audit",
    evidence: {},
  };
}

if (!fix) {
  state = { runId: runMarker, surface, mode: "audit", phase: "audit", evidence: {} };
}

function getDeploymentSnapshot() {
  const output = execFileSync("ssh", ["autopilot-prod", "cd /opt/autopilot && git rev-parse HEAD && stat -c %Y .next/BUILD_ID && pm2 pid autopilot"], {
    encoding: "utf8",
  }).trim();
  const parts = output.split(/\r?\n/);
  return {
    commit: parts[0],
    buildIdMtime: parts[1] ? Number(parts[1]) : NaN,
    pm2Pid: parts[2] || "",
  };
}

const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
state = transition(state, state.phase, {
  expectedCommit: state.evidence.expectedCommit ?? gitHead,
});

saveState(root, runMarker, state);

if (deploy && state.phase !== "deploying" && state.phase !== "verifying") {
  const baseline = getDeploymentSnapshot();
  state = transition(state, "deploying", {
    expectedCommit: gitHead,
    deploymentBaseline: baseline,
    deployInvokedAt: new Date().toISOString(),
  });
  saveState(root, runMarker, state);
  execFileSync("node", ["scripts/git-deploy.mjs"], { cwd: root, stdio: "inherit" });
}

if (deploy && state.phase === "deploying") {
  const deadline = Date.now() + 90_000;
  let last = state.evidence.deploymentBaseline ?? null;
  const expectedCommit = state.evidence.expectedCommit;
  const baseline = state.evidence.deploymentBaseline;

  while (Date.now() < deadline) {
    try {
      const observed = getDeploymentSnapshot();
      last = observed;
      const isSameCommit = observed.commit === expectedCommit;
      const buildAdvanced = Number.isFinite(observed.buildIdMtime) && Number.isFinite(baseline?.buildIdMtime)
        ? observed.buildIdMtime >= baseline.buildIdMtime + 1
        : false;
      const pidChanged = observed.pm2Pid && baseline?.pm2Pid && observed.pm2Pid !== baseline.pm2Pid;

      if (isSameCommit && observed.pm2Pid && (buildAdvanced || pidChanged)) {
        state = transition(state, "verifying", { remote: observed });
        saveState(root, runMarker, state);
        break;
      }
    } catch {
      // retain redacted last observation only
    }
    execFileSync("sleep", ["3"]);
  }

  if (state.phase === "deploying") {
    state = transition(state, "failed", { remote: last, error: "deployment polling timed out" });
    saveState(root, runMarker, state);
    throw new Error("Deployment polling timed out");
  }
}

if (deploy && state.phase === "verifying") {
  const health = execFileSync("curl", ["-fsS", "https://autopilot.agrikoph.com/api/health"], { encoding: "utf8" });
  const parsedHealth = JSON.parse(health);
  if (parsedHealth.status !== "ok") throw new Error("Deployment health did not report ok");
  state = transition(state, "deployed", { healthStatus: "ok" });
  saveState(root, runMarker, state);
}

console.log(JSON.stringify({ ...state, runId: runMarker }));
