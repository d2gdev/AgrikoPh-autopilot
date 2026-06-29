#!/usr/bin/env node

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const args = new Set(process.argv.slice(2));
const profile = args.has("--remote") ? "remote" : args.has("--local") ? "local" : "default";
const prismaMode = args.has("--prisma=always")
  ? "always"
  : args.has("--prisma=skip")
    ? "skip"
    : "auto";

const DEFAULT_HEAP_MB = profile === "remote" ? 1536 : 4096;
const PRISMA_STAMP = resolve(ROOT, "node_modules/.cache/autopilot/prisma-generate.json");

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(cmd, cmdArgs, env = process.env) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hashFile(path) {
  if (!existsSync(path)) return "";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function prismaHash() {
  const h = createHash("sha256");
  for (const file of ["prisma/schema.prisma", "package.json", "package-lock.json"]) {
    h.update(file);
    h.update(hashFile(resolve(ROOT, file)));
  }
  return h.digest("hex");
}

function shouldGeneratePrisma() {
  if (prismaMode === "always") return true;
  if (prismaMode === "skip") return false;
  if (!existsSync(resolve(ROOT, "node_modules/@prisma/client"))) return true;
  if (!existsSync(PRISMA_STAMP)) return true;

  try {
    const stamp = JSON.parse(readFileSync(PRISMA_STAMP, "utf8"));
    return stamp.hash !== prismaHash();
  } catch {
    return true;
  }
}

function writePrismaStamp() {
  mkdirSync(dirname(PRISMA_STAMP), { recursive: true });
  writeFileSync(
    PRISMA_STAMP,
    JSON.stringify({ hash: prismaHash(), generatedAt: new Date().toISOString() }, null, 2),
  );
}

function withHeap(env) {
  const current = env.NODE_OPTIONS ?? "";
  if (current.includes("--max-old-space-size")) return env;
  return { ...env, NODE_OPTIONS: `${current} --max-old-space-size=${DEFAULT_HEAP_MB}`.trim() };
}

const buildEnv = withHeap({
  ...process.env,
  NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
  ...(profile === "remote" ? {
    NEXT_BUILD_CPUS: process.env.NEXT_BUILD_CPUS ?? "1",
    NEXT_MEMORY_BASED_WORKERS: process.env.NEXT_MEMORY_BASED_WORKERS ?? "true",
  } : {}),
});

if (shouldGeneratePrisma()) {
  console.log(`[build] Generating Prisma Client (${prismaMode})`);
  run(command("npx"), ["prisma", "generate"], buildEnv);
  writePrismaStamp();
} else {
  console.log("[build] Prisma Client is current; skipping generate");
}

console.log(`[build] Running next build (${profile})`);
run(command("npx"), ["next", "build"], buildEnv);
