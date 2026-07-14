import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("cleanup-topical-map-advisories CLI", () => {
  it("compiles for the CommonJS format used by the repository tsx runtime", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const output = execFileSync(
      path.join(root, "node_modules/.bin/esbuild"),
      [path.join(root, "scripts/cleanup-topical-map-advisories.ts"), "--format=cjs", "--platform=node"],
      { cwd: root, encoding: "utf8" },
    );

    expect(output).toContain("function main()");
  });
});
