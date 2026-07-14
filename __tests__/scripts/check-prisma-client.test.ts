import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPrismaClientFreshness } from "../../scripts/check-prisma-client.mjs";

const fixtures: string[] = [];

function makeFixture({ stampHash }: { stampHash?: string } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "autopilot-prisma-client-"));
  fixtures.push(rootDir);

  mkdirSync(join(rootDir, "prisma"), { recursive: true });
  writeFileSync(join(rootDir, "prisma/schema.prisma"), "generator client { provider = \"prisma-client-js\" }\n");
  writeFileSync(join(rootDir, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(rootDir, "package-lock.json"), '{"lockfileVersion":3}\n');

  if (stampHash) {
    mkdirSync(join(rootDir, "node_modules/.cache/autopilot"), { recursive: true });
    writeFileSync(join(rootDir, "node_modules/.cache/autopilot/prisma-generate.json"), JSON.stringify({ hash: stampHash }), { encoding: "utf8", flag: "w" });
  }

  return rootDir;
}

function expectedHash() {
  const hash = createHash("sha256");
  const hashInputs: Array<[string, string]> = [
    ["prisma/schema.prisma", "generator client { provider = \"prisma-client-js\" }\n"],
    ["package.json", '{"name":"fixture"}\n'],
    ["package-lock.json", '{"lockfileVersion":3}\n'],
  ];
  for (const [file, contents] of hashInputs) {
    hash.update(file);
    hash.update(createHash("sha256").update(contents).digest("hex"));
  }
  return hash.digest("hex");
}

function writeMatchingStamp(rootDir: string) {
  const stampPath = join(rootDir, "node_modules/.cache/autopilot/prisma-generate.json");
  mkdirSync(join(rootDir, "node_modules/.cache/autopilot"), { recursive: true });
  writeFileSync(stampPath, JSON.stringify({ hash: expectedHash() }));
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("checkPrismaClientFreshness", () => {
  it("reports a reused stale Prisma client before typecheck", () => {
    const fixture = makeFixture({ stampHash: "old" });

    expect(checkPrismaClientFreshness({ rootDir: fixture })).toMatchObject({
      current: false,
      actualHash: "old",
    });
  });

  it("reports a missing Prisma stamp as not current", () => {
    const fixture = makeFixture();

    expect(checkPrismaClientFreshness({ rootDir: fixture })).toMatchObject({
      current: false,
      actualHash: null,
    });
  });

  it("reports a malformed Prisma stamp as not current", () => {
    const fixture = makeFixture();
    const stampPath = join(fixture, "node_modules/.cache/autopilot/prisma-generate.json");
    mkdirSync(join(fixture, "node_modules/.cache/autopilot"), { recursive: true });
    writeFileSync(stampPath, "not valid JSON");

    expect(checkPrismaClientFreshness({ rootDir: fixture })).toMatchObject({
      current: false,
      actualHash: null,
    });
  });

  it("accepts the exact schema/package hash", () => {
    const fixture = makeFixture();
    writeMatchingStamp(fixture);

    expect(checkPrismaClientFreshness({ rootDir: fixture }).current).toBe(true);
  });
});
