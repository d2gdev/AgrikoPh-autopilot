import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStrategyPackage } from "@/lib/topical-map/package-reader";

const roots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const semanticArtifactIds = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"] as const;
const artifactIds = [...semanticArtifactIds, "compilation-contract"] as const;
const paths = { map: "agriko-topical-map-2026-07-11.md", evidence: "agriko-topical-map-evidence-2026-07-11.md", "url-inventory": "agriko-topical-map-url-inventory-2026-07-11.csv", "redirect-inventory": "agriko-topical-map-redirect-inventory-2026-07-11.csv", "internal-links": "agriko-topical-map-internal-links-2026-07-11.csv", "compilation-contract": "agriko-topical-map-compilation-contract-2026-07-11.json" } as const;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);

function contractBytes(sourceHashes: Record<typeof semanticArtifactIds[number], string>, mutate?: (contract: Record<string, unknown>) => void) {
  const contract: Record<string, unknown> = {
    contractSchemaVersion: "1.0.0", contractRevision: "1", strategyVersion: "2026-07-11", siteHost: "agrikoph.com",
    sourceArtifacts: semanticArtifactIds.map((id) => ({ id, sha256: sourceHashes[id] })),
    compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" },
    futurePolicyBody: { intentionallyOpaque: true },
  };
  mutate?.(contract);
  return Buffer.from(JSON.stringify(contract));
}

function refreshPackageHash(manifest: Record<string, unknown>) {
  const withoutHash = { ...manifest };
  delete withoutHash.packageSha256;
  manifest.packageSha256 = hash(Buffer.from(`${canonical(withoutHash)}\n${(manifest.artifacts as Array<{ sha256: string }>).map((artifact) => artifact.sha256).join("\n")}`));
}

async function fixture(options: { manifest?: (manifest: Record<string, unknown>) => void; contract?: (contract: Record<string, unknown>) => void; contractBytes?: Buffer } = {}) {
  const root = await mkdtemp(join(tmpdir(), "topical-map-")); roots.push(root);
  const bytes = Object.fromEntries(semanticArtifactIds.map((id) => [id, Buffer.from(`bytes:${id}`)])) as Record<typeof semanticArtifactIds[number], Buffer>;
  for (const id of semanticArtifactIds) await writeFile(join(root, paths[id]), bytes[id]);
  const sourceHashes = Object.fromEntries(semanticArtifactIds.map((id) => [id, hash(bytes[id])])) as Record<typeof semanticArtifactIds[number], string>;
  const contract = options.contractBytes ?? contractBytes(sourceHashes, options.contract);
  await writeFile(join(root, paths["compilation-contract"]), contract);
  const manifest: Record<string, any> = { schemaVersion: "1.0.0", packageId: "agriko-topical-map-2026-07-11", strategyVersion: "2026-07-11", evidenceDate: "2026-07-11", createdAt: "2026-07-11T00:00:00Z", provenance: { site: "https://agrikoph.com", market: "Philippines", repository: "Agriko/shopify-theme", commit: "a".repeat(40), preparedBy: ["operator"], methodologyVersion: "topical-map-v1" }, compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" }, artifacts: artifactIds.map((id) => ({ id, path: paths[id], mediaType: id === "compilation-contract" ? "application/json" : id === "map" || id === "evidence" ? "text/markdown" : "text/csv", sha256: id === "compilation-contract" ? hash(contract) : sourceHashes[id], required: true })), approval: { status: "draft", approvedBy: null, approvedAt: null } };
  options.manifest?.(manifest); refreshPackageHash(manifest); await writeFile(join(root, "strategy-package-manifest.json"), JSON.stringify(manifest)); return { root, manifest, sourceHashes };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("topical-map strategy package reader", () => {
  it("reads a valid six-artifact package and preserves opaque top-level fields", async () => { const { root } = await fixture(); const result = await readStrategyPackage(root); expect(Object.keys(result.artifacts)).toEqual([...artifactIds]); expect(result.artifacts["compilation-contract"].bytes.toString()).toContain("futurePolicyBody"); });
  it("rejects five-artifact packages", async () => { const { root } = await fixture({ manifest: (manifest) => { manifest.artifacts = (manifest.artifacts as Array<{ id: string }>).filter((artifact) => artifact.id !== "compilation-contract"); } }); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "MISSING_COMPILATION_CONTRACT" }); });
  it("rejects a contract byte change before decoding its body", async () => { const { root } = await fixture(); await writeFile(join(root, paths["compilation-contract"]), "not-json"); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "HASH_MISMATCH" }); });
  it.each([
    ["UTF-8 BOM", Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "INVALID_CONTRACT_ENCODING"],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), "INVALID_CONTRACT_ENCODING"],
    ["malformed JSON", Buffer.from("{not json"), "INVALID_CONTRACT_ENVELOPE"],
  ])("rejects %s after byte hash verification", async (_name, bytes, code) => { const { root } = await fixture({ contractBytes: bytes }); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code }); });
  it.each([
    ["unsupported schema", (contract: Record<string, unknown>) => { contract.contractSchemaVersion = "2.0.0"; }, "UNSUPPORTED_CONTRACT_SCHEMA"],
    ["invalid revision", (contract: Record<string, unknown>) => { contract.contractRevision = "01"; }, "INVALID_CONTRACT_REVISION"],
    ["strategy version mismatch", (contract: Record<string, unknown>) => { contract.strategyVersion = "2026-07-10"; }, "CONTRACT_STRATEGY_VERSION_MISMATCH"],
    ["top-level site host mismatch", (contract: Record<string, unknown>) => { contract.siteHost = "example.com"; }, "CONTRACT_SITE_HOST_MISMATCH"],
    ["compatibility site host mismatch", (contract: Record<string, unknown>) => { (contract.compatibility as Record<string, unknown>).siteHost = "example.com"; }, "CONTRACT_SITE_HOST_MISMATCH"],
    ["compatibility mismatch", (contract: Record<string, unknown>) => { (contract.compatibility as Record<string, unknown>).pluginVersion = ">=9.0.0"; }, "CONTRACT_COMPATIBILITY_MISMATCH"],
    ["unknown compatibility key", (contract: Record<string, unknown>) => { (contract.compatibility as Record<string, unknown>).unexpected = true; }, "CONTRACT_COMPATIBILITY_MISMATCH"],
    ["missing source artifact", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as unknown[]).pop(); }, "CONTRACT_SOURCE_ARTIFACT_MISMATCH"],
    ["duplicate source artifact", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as unknown[]).push((contract.sourceArtifacts as unknown[])[0]!); }, "CONTRACT_SOURCE_ARTIFACT_MISMATCH"],
    ["reordered source artifacts", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as unknown[]).reverse(); }, "CONTRACT_SOURCE_ARTIFACT_MISMATCH"],
    ["unknown source artifact", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as Array<Record<string, unknown>>)[0]!.id = "unknown"; }, "CONTRACT_SOURCE_ARTIFACT_MISMATCH"],
    ["unknown source artifact field", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as Array<Record<string, unknown>>)[0]!.unexpected = true; }, "CONTRACT_SOURCE_ARTIFACT_MISMATCH"],
    ["source hash mismatch", (contract: Record<string, unknown>) => { (contract.sourceArtifacts as Array<Record<string, unknown>>)[0]!.sha256 = "a".repeat(64); }, "CONTRACT_SOURCE_HASH_MISMATCH"],
  ])("rejects contract %s", async (_name, contract, code) => { const { root } = await fixture({ contract }); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code }); });
  it("keeps canonical package identity deterministic and changes it when only contract bytes change", async () => { const first = await fixture(); const second = await fixture({ contract: (contract) => { contract.extraOpaqueField = "changed"; } }); const firstPackage = await readStrategyPackage(first.root); const secondPackage = await readStrategyPackage(second.root); expect(firstPackage.packageSha256).not.toBe(secondPackage.packageSha256); expect(firstPackage.manifest.artifacts.at(-1)?.sha256).not.toBe(secondPackage.manifest.artifacts.at(-1)?.sha256); });
  it.each([["absolute", "/etc/passwd"], ["traversal", "../outside"]])("rejects %s contract paths", async (_name, path) => { const { root } = await fixture({ manifest: (manifest) => { (manifest.artifacts as Array<{ id: string; path: string }>).find((artifact) => artifact.id === "compilation-contract")!.path = path; } }); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "UNSAFE_PATH" }); });
  it("rejects a contract symlink that escapes the package root", async () => { const { root } = await fixture(); const outside = await mkdtemp(join(tmpdir(), "topical-outside-")); roots.push(outside); await writeFile(join(outside, "contract.json"), "{}"); await rm(join(root, paths["compilation-contract"])); await symlink(join(outside, "contract.json"), join(root, paths["compilation-contract"])); await expect(readStrategyPackage(root)).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" }); });
});
