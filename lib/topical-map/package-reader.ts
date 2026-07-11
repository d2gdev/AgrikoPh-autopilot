import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { StrategyPackageError, parseManifest } from "./manifest";
import { type RawStrategyPackage } from "./types";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, target: string) => { const rel = relative(root, target); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
export async function readStrategyPackage(root: string): Promise<RawStrategyPackage> {
  const resolvedRoot = await realpath(root); const manifestPath = resolve(resolvedRoot, "strategy-package-manifest.json");
  let manifestTarget: string; try { manifestTarget = await realpath(manifestPath); } catch { throw new StrategyPackageError("MISSING_FILE", "Manifest could not be read."); } if (!inside(resolvedRoot, manifestTarget)) throw new StrategyPackageError("SYMLINK_ESCAPE", "Manifest symlink escapes root.");
  let input: unknown; try { input = JSON.parse(await readFile(manifestTarget, "utf8")); } catch { throw new StrategyPackageError("MISSING_FILE", "Manifest could not be read."); }
  const manifest = parseManifest(input); const pairs = await Promise.all(manifest.artifacts.map(async (artifact) => { if (artifact.path.includes("\0") || isAbsolute(artifact.path) || artifact.path.split(/[\\/]/).includes("..")) throw new StrategyPackageError("UNSAFE_PATH", "Unsafe artifact path."); const unresolved = resolve(resolvedRoot, artifact.path); if (!inside(resolvedRoot, unresolved)) throw new StrategyPackageError("UNSAFE_PATH", "Artifact path escapes root."); let target: string; try { target = await realpath(unresolved); } catch { throw new StrategyPackageError("MISSING_FILE", "Artifact is missing."); } if (!inside(resolvedRoot, target)) throw new StrategyPackageError("SYMLINK_ESCAPE", "Artifact symlink escapes root."); const bytes = await readFile(target); if (hash(bytes) !== artifact.sha256) throw new StrategyPackageError("HASH_MISMATCH", "Artifact hash mismatch."); return [artifact.id, { ...artifact, bytes, byteLength: bytes.byteLength }] as const; }));
  return { manifest, packageSha256: manifest.packageSha256, root: resolvedRoot, artifacts: Object.fromEntries(pairs) as RawStrategyPackage["artifacts"] };
}
