import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseManifest } from "@/lib/topical-map/manifest";

const artifacts = [
  ["map", "agriko-topical-map-2026-07-11.md", "text/markdown"],
  ["evidence", "agriko-topical-map-evidence-2026-07-11.md", "text/markdown"],
  ["url-inventory", "agriko-topical-map-url-inventory-2026-07-11.csv", "text/csv"],
  ["redirect-inventory", "agriko-topical-map-redirect-inventory-2026-07-11.csv", "text/csv"],
  ["internal-links", "agriko-topical-map-internal-links-2026-07-11.csv", "text/csv"],
] as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

function validManifest() {
  const manifest = {
    schemaVersion: "1.0.0", packageId: "agriko-topical-map-2026-07-11", strategyVersion: "2026-07-11",
    evidenceDate: "2026-07-11", createdAt: "2026-07-11T00:00:00Z",
    provenance: { site: "https://agrikoph.com", market: "Philippines", repository: "Agriko/shopify-theme", commit: "a".repeat(40), preparedBy: ["operator"], methodologyVersion: "topical-map-v1" },
    compatibility: { runtimeSchema: ">=1.0.0 <2.0.0", pluginVersion: ">=0.1.0", siteHost: "agrikoph.com", urlNormalization: "agriko-url-v1" },
    artifacts: artifacts.map(([id, path, mediaType]) => ({ id, path, mediaType, sha256: hash(`bytes:${id}`), required: true })),
    approval: { status: "draft", approvedBy: null, approvedAt: null },
  };
  return { ...manifest, packageSha256: hash(`${canonical(manifest)}\n${manifest.artifacts.map((artifact) => artifact.sha256).join("\n")}`) };
}

describe("topical-map strategy manifest", () => {
  it("accepts the exact complete package and produces a stable canonical hash", () => {
    const first = parseManifest(validManifest());
    const reordered = JSON.parse(JSON.stringify({ ...validManifest(), compatibility: validManifest().compatibility }));
    const second = parseManifest(reordered);
    expect(first.packageSha256).toBe(second.packageSha256);
    expect(first.artifacts).toHaveLength(5);
  });

  it.each([
    ["missing evidence", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: value.artifacts.filter((artifact) => artifact.id !== "evidence") }), "MISSING_ARTIFACT"],
    ["duplicate artifact", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [...value.artifacts, value.artifacts[0]] }), "DUPLICATE_ARTIFACT"],
    ["unknown artifact", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [...value.artifacts.slice(0, 4), { ...value.artifacts[4], id: "unknown" }] }), "UNKNOWN_ARTIFACT"],
    ["malformed hash", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [{ ...value.artifacts[0], sha256: "bad" }, ...value.artifacts.slice(1)] }), "INVALID_SHA256"],
    ["unsupported schema", (value: ReturnType<typeof validManifest>) => ({ ...value, schemaVersion: "2.0.0" }), "UNSUPPORTED_SCHEMA"],
    ["unsupported runtime", (value: ReturnType<typeof validManifest>) => ({ ...value, compatibility: { ...value.compatibility, runtimeSchema: ">=2.0.0 <3.0.0" } }), "INCOMPATIBLE_RUNTIME"],
    ["wrong host", (value: ReturnType<typeof validManifest>) => ({ ...value, compatibility: { ...value.compatibility, siteHost: "example.com" } }), "SITE_HOST_MISMATCH"],
    ["filename version mismatch", (value: ReturnType<typeof validManifest>) => ({ ...value, artifacts: [{ ...value.artifacts[0], path: "agriko-topical-map-2026-07-10.md" }, ...value.artifacts.slice(1)] }), "VERSION_MISMATCH"],
  ])("rejects %s", (_name, mutate, code) => {
    expect(() => parseManifest(mutate(validManifest()))).toThrow(expect.objectContaining({ code }));
  });
});
