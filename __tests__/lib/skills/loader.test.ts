import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

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
});
