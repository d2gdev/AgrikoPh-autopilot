export function resolveDeployBranch({ requestedBranch, allowNonMain }) {
  const branch = requestedBranch?.trim() || "main";
  if (branch !== "main" && !allowNonMain) {
    throw new Error(
      `Refusing to deploy non-main branch "${branch}" without --allow-non-main.`,
    );
  }
  return branch;
}

export function assertCleanWorktree(status) {
  if (status.trim()) {
    throw new Error(
      "Refusing to deploy with a dirty working tree. Commit or stash local changes first.",
    );
  }
}

export function assertRemoteStepOrder(script) {
  const buildIndex = script.indexOf("npm run build:remote");
  const migrateIndex = script.indexOf("npm run db:migrate");
  if (buildIndex < 0 || migrateIndex < 0 || buildIndex > migrateIndex) {
    throw new Error("The remote build must complete before database migrations run.");
  }
}
