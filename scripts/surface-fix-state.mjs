import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export function statePath(root, runId) {
  return resolve(root, ".surface-fix", `${runId}.json`);
}

export function loadState(root, runId) {
  const path = statePath(root, runId);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function saveState(root, runId, state) {
  const path = statePath(root, runId);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  return path;
}

export function transition(state, phase, evidence = {}) {
  return { ...state, phase, updatedAt: new Date().toISOString(), evidence: { ...state.evidence, ...evidence } };
}
