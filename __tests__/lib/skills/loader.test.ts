import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();

describe("skills loader", () => {
  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("parses YAML frontmatter and markdown content from skill files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-skills-"));
    fs.mkdirSync(path.join(dir, "skills-source"));
    fs.writeFileSync(
      path.join(dir, "skills-source", "example.md"),
      [
        "---",
        "name: Example Skill",
        "description: Parses safely",
        "metadata:",
        "  platform: seo",
        "  insightBlock: sample-insight",
        "---",
        "",
        "Skill prompt body",
      ].join("\n"),
    );
    process.chdir(dir);

    const { loadAllSkillsSync } = await import("@/lib/skills/loader");
    const skills = loadAllSkillsSync();

    expect(skills).toEqual([
      expect.objectContaining({
        id: "example",
        name: "Example Skill",
        description: "Parses safely",
        platform: "seo",
        insightBlock: "sample-insight",
        fullPrompt: "Skill prompt body",
      }),
    ]);
  });

  function writeSkillFile(dir: string, extraSourcesYaml: string): void {
    fs.mkdirSync(path.join(dir, "skills-source"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "skills-source", "example.md"),
      [
        "---",
        "name: Example Skill",
        "description: Parses safely",
        "metadata:",
        "  platform: seo",
        extraSourcesYaml,
        "---",
        "",
        "Skill prompt body",
      ].join("\n"),
    );
  }

  it("parses valid extraSources into SkillDefinition.extraSources", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-skills-"));
    writeSkillFile(dir, "  extraSources: [gsc, market_intel]");
    process.chdir(dir);
    vi.resetModules(); // SKILLS_DIR is captured from process.cwd() at module-load time

    const { loadAllSkillsSync } = await import("@/lib/skills/loader");
    const skills = loadAllSkillsSync();

    expect(skills[0]!.extraSources).toEqual(["gsc", "market_intel"]);
  });

  it("leaves extraSources undefined when frontmatter omits it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-skills-"));
    fs.mkdirSync(path.join(dir, "skills-source"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "skills-source", "example.md"),
      ["---", "name: Example Skill", "description: Parses safely", "metadata:", "  platform: seo", "---", "", "Body"].join("\n"),
    );
    process.chdir(dir);
    vi.resetModules();

    const { loadAllSkillsSync } = await import("@/lib/skills/loader");
    const skills = loadAllSkillsSync();

    expect(skills[0]!.extraSources).toBeUndefined();
  });

  it("warns and drops unknown extraSources values, keeping the valid ones", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-skills-"));
    writeSkillFile(dir, "  extraSources: [gsc, bogus_source]");
    process.chdir(dir);
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { loadAllSkillsSync } = await import("@/lib/skills/loader");
    const skills = loadAllSkillsSync();

    expect(skills[0]!.extraSources).toEqual(["gsc"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bogus_source"));
    warnSpy.mockRestore();
  });
});
