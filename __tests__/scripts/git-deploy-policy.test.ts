import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCleanWorktree,
  assertRemoteStepOrder,
  resolveDeployBranch,
} from "../../scripts/git-deploy-policy.mjs";

describe("git deploy policy", () => {
  it("defaults production deploys to main", () => {
    expect(resolveDeployBranch({ requestedBranch: null, allowNonMain: false })).toBe("main");
  });

  it("requires an explicit override for non-main branches", () => {
    expect(() =>
      resolveDeployBranch({ requestedBranch: "feature/emergency", allowNonMain: false }),
    ).toThrow(/allow-non-main/);
    expect(resolveDeployBranch({
      requestedBranch: "feature/emergency",
      allowNonMain: true,
    })).toBe("feature/emergency");
  });

  it("rejects a dirty worktree", () => {
    expect(() => assertCleanWorktree(" M app/page.tsx")).toThrow(/working tree/i);
    expect(assertCleanWorktree("\n")).toBeUndefined();
  });

  it("requires the remote build to finish before database migration", () => {
    expect(() => assertRemoteStepOrder(`
      npm run db:migrate
      npm run build:remote
    `)).toThrow(/before database migrations/i);
    expect(assertRemoteStepOrder(`
      npm run build:remote
      npm run db:migrate
    `)).toBeUndefined();
  });

  it("keeps unsafe SSH options out and includes rollback handling", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/git-deploy.mjs"), "utf8");

    expect(source).not.toContain("StrictHostKeyChecking=no");
    expect(source).not.toContain("http.extraHeader");
    expect(source).not.toContain("GITHUB_AUTH_HEADER");
    expect(source).toContain("GIT_ASKPASS");
    expect(source).toContain("unset GITHUB_TOKEN GIT_ASKPASS GIT_TERMINAL_PROMPT");
    expect(source).toContain('stdio: ["pipe", "inherit", "inherit"]');
    expect(source.indexOf("npm run build:remote")).toBeLessThan(source.indexOf("npm run db:migrate"));
    expect(source).toContain("mv .next.old .next");
    expect(source.indexOf('curl -fsS "$HEALTH_URL"')).toBeLessThan(
      source.indexOf("rm -rf /opt/autopilot/.next.old"),
    );
    expect(source).toContain("--allow-non-main");
  });
});
