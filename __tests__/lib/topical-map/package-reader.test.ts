import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";

const roots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const artifactNames = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"] as const;
const paths = { map: "agriko-topical-map-2026-07-11.md", evidence: "agriko-topical-map-evidence-2026-07-11.md", "url-inventory": "agriko-topical-map-url-inventory-2026-07-11.csv", "redirect-inventory": "agriko-topical-map-redirect-inventory-2026-07-11.csv", "internal-links": "agriko-topical-map-internal-links-2026-07-11.csv" } as const;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);

async function fixture(mutator?: (manifest: Record<string, unknown>) => void) {
  const root = await mkdtemp(join(tmpdir(), "topical-map-")); roots.push(root);
  const bytes = Object.fromEntries(artifactNames.map((id) => [id, Buffer.from(`bytes:${id}`)])) as Record<typeof artifactNames[number], Buffer>;
  for (const id of artifactNames) await writeFile(join(root, paths[id]), bytes[id]);
  const manifest: Record<string, any> = { schemaVersion: "1.0.0", packageId: "agriko-topical-map-2026-07-11", strategyVersion: "2026-07-11", evidenceDate: "2026-07-11", createdAt: "2026-07-11T00:00:00Z", provenance: { site: "https://agrikoph.com", market: "Philippines", repository: "Agriko/shopify-theme", commit: "a".repeat(40), preparedBy: ["operator"], methodologyVersion: "topical-map-v1" }, compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" }, artifacts: artifactNames.map((id) => ({ id, path: paths[id], mediaType: id.endsWith("inventory") || id === "internal-links" ? "text/csv" : "text/markdown", sha256: hash(bytes[id]), required: true })), approval: { status: "draft", approvedBy: null, approvedAt: null } };
  manifest.packageSha256 = hash(Buffer.from(`${canonical(manifest)}\n${manifest.artifacts.map((artifact: { sha256: string }) => artifact.sha256).join("\n")}`));
  mutator?.(manifest); await writeFile(join(root, "strategy-package-manifest.json"), JSON.stringify(manifest)); return { root, manifest };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("topical-map strategy package reader", () => {
  it("reads exact artifacts as verified bytes", async () => { const { root } = await fixture(); const result = await readStrategyPackage(root); expect(Object.keys(result.artifacts)).toEqual([...artifactNames]); expect(result.artifacts.map.bytes).toEqual(Buffer.from("bytes:map")); });
  it("rejects a declared byte hash mismatch", async () => { const { root } = await fixture(); await writeFile(join(root, paths.map), "changed"); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "HASH_MISMATCH" }); });
  it.each([["absolute", "/etc/passwd"], ["traversal", "../outside"]])("rejects %s paths", async (_name, path) => { const { root } = await fixture((manifest) => { (manifest.artifacts as Array<{ path: string }>)[0]!.path = path; }); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "UNSAFE_PATH" }); });
  it("rejects symlinks that escape the package root", async () => { const { root } = await fixture(); const outside = await mkdtemp(join(tmpdir(), "topical-outside-")); roots.push(outside); await writeFile(join(outside, "outside.md"), "outside"); await rm(join(root, paths.map)); await symlink(join(outside, "outside.md"), join(root, paths.map)); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" }); });
});
