import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { derivePackageSha256, parseManifest } from "@/lib/topical-map/manifest";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

const artifactDefinitions = [
  ["map", "agriko-topical-map-2026-07-11.md", "text/markdown"],
  ["evidence", "agriko-topical-map-evidence-2026-07-11.md", "text/markdown"],
  ["url-inventory", "agriko-topical-map-url-inventory-2026-07-11.csv", "text/csv"],
  ["redirect-inventory", "agriko-topical-map-redirect-inventory-2026-07-11.csv", "text/csv"],
  ["internal-links", "agriko-topical-map-internal-links-2026-07-11.csv", "text/csv"],
  ["compilation-contract", "agriko-topical-map-compilation-contract-2026-07-11.json", "application/json"],
] as const;

function withPackageHash(manifest: Record<string, any>): Record<string, any> {
  const withoutHash = { ...manifest };
  delete withoutHash.packageSha256;
  return { ...withoutHash, packageSha256: hash(`${canonical(withoutHash)}\n${(withoutHash.artifacts as Array<{ sha256: string }>).map((artifact) => artifact.sha256).join("\n")}`) };
}

function validManifest() {
  return withPackageHash({
    schemaVersion: "1.0.0", packageId: "agriko-topical-map-2026-07-11", strategyVersion: "2026-07-11", evidenceDate: "2026-07-11", createdAt: "2026-07-11T00:00:00Z",
    provenance: { site: "https://agrikoph.com", market: "Philippines", repository: "Agriko/shopify-theme", commit: "a".repeat(40), preparedBy: ["operator"], methodologyVersion: "topical-map-v1" },
    compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" },
    artifacts: artifactDefinitions.map(([id, path, mediaType]) => ({ id, path, mediaType, sha256: hash(`bytes:${id}`), required: true })),
    approval: { status: "draft", approvedBy: null, approvedAt: null },
  });
}

describe("topical-map strategy manifest", () => {
  it("accepts the exact activation-authorized revision 3 package identity", () => {
    const themeRoot = process.env.TOPICAL_MAP_THEME_ROOT ?? resolve(process.cwd(), "../shopify-theme");
    const manifest = JSON.parse(readFileSync(resolve(themeRoot, "docs/seo/strategy-package-manifest-2026-07-13.json"), "utf8"));
    const parsed = parseManifest(manifest);
    expect(manifest.artifacts).toHaveLength(6);
    expect(manifest.artifacts.map(({ id, sha256 }) => ({ id, sha256 }))).toEqual([
      { id: "map", sha256: "f213be82bf5c774d3cb278b5f316feb4b21ff430762874f46a792a9186b8a7de" },
      { id: "evidence", sha256: "37c3356dfb9b5ec378fdc88f2d4b6f6e87f1bfba56e599988ffbbe542874c921" },
      { id: "url-inventory", sha256: "03d673d8a4bc02dd7c1db7690c28de31b3d30bd3860f8dbc44d7c7176d827a31" },
      { id: "redirect-inventory", sha256: "fd2cb1c1892dde6f28d2d042af7a1ecb16fa22d64bf165cfb0bcba19edb2070e" },
      { id: "internal-links", sha256: "b7d620096fb6c7eed326a70b13ff7c3cbe891fe24b4ed94247ad09836cf36345" },
      { id: "compilation-contract", sha256: "3fe3f70b239fc907b61dc8baf96e2c3916c515fd046f2124ea1f2edb0098cb05" },
    ]);
    expect(parsed.packageSha256).toBe("f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c");
    const { packageSha256: _packageSha256, ...withoutHash } = manifest;
    expect(derivePackageSha256(withoutHash)).toBe(manifest.packageSha256);
  });
  it("accepts exactly six artifacts and produces a stable canonical hash", () => {
    const input = validManifest();
    const first = parseManifest(input);
    const reordered = {
      approval: input.approval,
      artifacts: input.artifacts,
      compatibility: { urlNormalization: input.compatibility.urlNormalization, siteHost: input.compatibility.siteHost, pluginVersion: input.compatibility.pluginVersion, runtimeSchema: input.compatibility.runtimeSchema },
      provenance: input.provenance,
      createdAt: input.createdAt,
      evidenceDate: input.evidenceDate,
      strategyVersion: input.strategyVersion,
      packageId: input.packageId,
      schemaVersion: input.schemaVersion,
      packageSha256: input.packageSha256,
    };
    const second = parseManifest(reordered);
    expect(first.packageSha256).toBe(second.packageSha256);
    expect(first.artifacts).toHaveLength(6);
    expect(first.artifacts.at(-1)?.id).toBe("compilation-contract");
  });

  it("rejects the historical five-artifact package", () => {
    const manifest = validManifest();
    manifest.artifacts = (manifest.artifacts as Array<{ id: string }>).filter((artifact) => artifact.id !== "compilation-contract");
    expect(() => parseManifest(withPackageHash(manifest))).toThrow(expect.objectContaining({ code: "MISSING_COMPILATION_CONTRACT" }));
  });

  it.each([
    ["contract filename", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: (value.artifacts as Array<Record<string, unknown>>).map((artifact) => artifact.id === "compilation-contract" ? { ...artifact, path: "wrong.json" } : artifact) }), "CONTRACT_FILENAME_MISMATCH"],
    ["contract path escape", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: (value.artifacts as Array<Record<string, unknown>>).map((artifact) => artifact.id === "compilation-contract" ? { ...artifact, path: "../agriko-topical-map-compilation-contract-2026-07-13.json" } : artifact) }), "UNSAFE_PATH"],
    ["contract media type", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: (value.artifacts as Array<Record<string, unknown>>).map((artifact) => artifact.id === "compilation-contract" ? { ...artifact, mediaType: "text/json" } : artifact) }), "CONTRACT_MEDIA_TYPE_MISMATCH"],
    ["duplicate contract", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [...(value.artifacts as Array<Record<string, unknown>>), (value.artifacts as Array<Record<string, unknown>>).at(-1)] }), "DUPLICATE_ARTIFACT"],
    ["unknown contract-like identity", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: (value.artifacts as Array<Record<string, unknown>>).map((artifact) => artifact.id === "compilation-contract" ? { ...artifact, id: "contract" } : artifact) }), "UNKNOWN_ARTIFACT"],
    ["malformed hash", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [{ ...(value.artifacts as Array<Record<string, unknown>>)[0], sha256: "bad" }, ...(value.artifacts as Array<Record<string, unknown>>).slice(1)] }), "INVALID_SHA256"],
    ["unsupported schema", (value: ReturnType<typeof validManifest>) => ({ ...value, schemaVersion: "2.0.0" }), "UNSUPPORTED_SCHEMA"],
    ["unsupported runtime", (value: ReturnType<typeof validManifest>) => ({ ...value, compatibility: { ...(value.compatibility as Record<string, unknown>), runtimeSchema: ">=2.0.0 <3.0.0" } }), "INCOMPATIBLE_RUNTIME"],
    ["wrong host", (value: ReturnType<typeof validManifest>) => ({ ...value, compatibility: { ...(value.compatibility as Record<string, unknown>), siteHost: "example.com" } }), "SITE_HOST_MISMATCH"],
  ])("rejects %s", (_name, mutate, code) => {
    expect(() => parseManifest(withPackageHash(mutate(validManifest())))).toThrow(expect.objectContaining({ code }));
  });
});
