import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(__dirname, "../..");

describe("surface integrity loop command", () => {
  it("runs only local deterministic checks, including Growth Brief evidence checks", () => {
    const wrapper = resolve(projectRoot, "scripts/codex-surface-loop.mjs");

    expect(existsSync(wrapper)).toBe(true);
    const usage = spawnSync(process.execPath, [wrapper, "--help"], { cwd: projectRoot, encoding: "utf8" });
    expect(usage.status).toBe(0);
    expect(usage.stdout).toContain("start");
    expect(usage.stdout).toContain("status");

    const source = readFileSync(wrapper, "utf8");
    expect(source).toContain("for (let pass = 1; pass <= 5; pass += 1)");
    expect(source).toContain("__tests__/api/growth-brief-route.test.ts");
    expect(source).not.toContain("model");
    expect(source).not.toContain("codex-agent-loop");
  });
});
