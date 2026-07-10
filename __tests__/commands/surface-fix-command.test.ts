import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandPath = ".codex/skills/surface-fix/SKILL.md";

function readCommand() {
  return readFileSync(commandPath, "utf8");
}

describe("Codex surface-fix skill", () => {
  it("has one project-local Codex definition", () => {
    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(".claude/commands/surface-fix.md")).toBe(false);
  });

  it("keeps the default invocation audit-only and non-mutating", () => {
    const command = readCommand();

    expect(command).toContain('$surface-fix "<surface>"');
    expect(command).toMatch(/default[\s\S]{0,180}audit-only/i);
    expect(command).toMatch(/no worktree, code change, merge, or deployment/i);
  });

  it("requires explicit flags for remediation and deployment", () => {
    const command = readCommand();

    expect(command).toMatch(/--fix[\s\S]{0,240}isolated worktree/i);
    expect(command).toMatch(/--deploy[\s\S]{0,120}implies[\s\S]{0,80}--fix/i);
    expect(command).toMatch(/--deploy[\s\S]{0,240}production health/i);
  });

  it("preserves review approval, safety boundaries, and finite stopping criteria", () => {
    const command = readCommand();

    expect(command).toMatch(/re-review[\s\S]{0,100}explicit user approval/i);
    expect(command).toMatch(/no live Shopify or Meta mutations/i);
    expect(command).toMatch(/no production database access or migration/i);
    expect(command).toMatch(/no P0, P1, or P2[\s\S]{0,180}surface-owned/i);
    expect(command).toMatch(/unrelated legacy warnings[\s\S]{0,120}separately/i);
    expect(command).toMatch(/no partial handoffs/i);
  });
});
