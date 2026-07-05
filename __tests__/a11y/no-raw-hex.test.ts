import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = "app/(embedded)";

// Deliberate brand surface — the Market Intelligence hero is a self-contained
// dark branded panel whose agricultural palette has no Polaris token
// equivalent. See the BRAND_HERO constant's comment in that file.
const ALLOWLIST = new Set([
  "app/(embedded)/(market-intelligence)/market-intelligence/components.tsx",
]);

// Word-boundary hex; can false-positive on e.g. "#123456" issue refs in
// comments — if that ever happens, reword the comment or extend ALLOWLIST.
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|css)$/.test(name) ? [p] : [];
  });
}

describe("a11y/theming policy (roadmap Phase 9): no raw hex colors in app/(embedded)", () => {
  it("uses Polaris design tokens instead of hardcoded hex colors", () => {
    const offenders = walk(ROOT)
      .filter((p) => !ALLOWLIST.has(p.split("\\").join("/")))
      .flatMap((p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .map((line, i) => (HEX.test(line) ? `${p}:${i + 1}: ${line.trim()}` : null))
          .filter((x): x is string => x !== null)
      );
    expect(offenders).toEqual([]);
  });
});
