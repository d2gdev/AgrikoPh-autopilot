#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STAMP_PATH = "node_modules/.cache/autopilot/prisma-generate.json";
const HASH_INPUTS = ["prisma/schema.prisma", "package.json", "package-lock.json"];

function hashFile(path) {
  if (!existsSync(path)) return "";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectedPrismaHash(rootDir) {
  const hash = createHash("sha256");
  for (const file of HASH_INPUTS) {
    hash.update(file);
    hash.update(hashFile(resolve(rootDir, file)));
  }
  return hash.digest("hex");
}

export function checkPrismaClientFreshness({ rootDir = ROOT } = {}) {
  const expectedHash = expectedPrismaHash(rootDir);
  const stampPath = resolve(rootDir, STAMP_PATH);
  let actualHash = null;

  try {
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    actualHash = typeof stamp.hash === "string" ? stamp.hash : null;
  } catch {
    // A missing or malformed stamp means Prisma generation cannot be verified.
  }

  return {
    current: actualHash === expectedHash,
    expectedHash,
    actualHash,
  };
}

export function writePrismaClientStamp({ rootDir = ROOT } = {}) {
  const stampPath = resolve(rootDir, STAMP_PATH);
  const { expectedHash } = checkPrismaClientFreshness({ rootDir });
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, JSON.stringify({ hash: expectedHash, generatedAt: new Date().toISOString() }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    writePrismaClientStamp();
    console.log("Prisma Client freshness stamp updated.");
  } else {
    const result = checkPrismaClientFreshness();
    if (!result.current) {
      console.error("Prisma Client is missing or stale. Run `npm run db:generate` before typecheck.");
      process.exitCode = 1;
    } else {
      console.log("Prisma Client freshness stamp is current.");
    }
  }
}
