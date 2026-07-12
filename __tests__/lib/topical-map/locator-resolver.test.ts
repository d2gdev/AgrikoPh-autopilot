import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSourceLocator } from "@/lib/topical-map/locator-resolver";

const root = "/home/sean/Agriko/shopify-theme/docs/seo";
const sourcePaths = {
  map: "agriko-topical-map-2026-07-12.md",
  evidence: "agriko-topical-map-evidence-2026-07-12.md",
  "url-inventory": "agriko-topical-map-url-inventory-2026-07-12.csv",
  "redirect-inventory": "agriko-topical-map-redirect-inventory-2026-07-12.csv",
  "internal-links": "agriko-topical-map-internal-links-2026-07-12.csv",
} as const;
type ArtifactId = keyof typeof sourcePaths;
const sources = new Map<ArtifactId, Promise<Buffer>>();

async function approvedContract() {
  return JSON.parse(await readFile(join(root, "agriko-topical-map-compilation-contract-2026-07-12.json"), "utf8"));
}
async function source(id: ArtifactId) {
  const bytes = sources.get(id) ?? readFile(join(root, sourcePaths[id]));
  sources.set(id, bytes);
  return bytes;
}

describe("topical-map source locator resolution", () => {
  it("resolves every approved Markdown and CSV locator while preserving its source artifact identity", async () => {
    const contract = await approvedContract();
    const locators = [
      ...contract.coverageInventory.map((entry: any) => ({ artifactId: entry.artifactId, locator: entry.locator })),
      ...contract.rules.flatMap((rule: any) => rule.sourceReferences.map((reference: any) => ({ artifactId: reference.artifactId, locator: reference.locator }))),
      ...contract.unresolvedAmbiguities.flatMap((ambiguity: any) => ambiguity.sourceReferences.map((reference: any) => ({ artifactId: reference.artifactId, locator: reference.locator }))),
    ];

    expect(contract.coverageInventory).toHaveLength(853);
    expect(contract.rules).toHaveLength(1493);
    await Promise.all(locators.map(async ({ artifactId, locator }: any) => {
      const resolved = resolveSourceLocator({ artifactId, bytes: await source(artifactId), locator });
      expect(resolved.artifactId).toBe(artifactId);
    }));
  }, 30000);

  it("tolerates harmless line movement when the approved CSV fingerprint remains unique", async () => {
    const contract = await approvedContract();
    const entry = contract.coverageInventory.find((item: any) => item.locator.kind === "csv_row");
    const resolved = resolveSourceLocator({ artifactId: entry.artifactId, bytes: Buffer.concat([Buffer.from("\n"), await source(entry.artifactId)]), locator: entry.locator });
    expect(resolved.lineStart).toBeGreaterThan(entry.locator.rowNumber);
  });

  it.each([
    ["missing", (locator: any) => ({ ...locator, businessKey: "missing" }), "LOCATOR_MISSING"],
    ["fingerprint drift", (locator: any) => ({ ...locator, rowFingerprint: "0".repeat(64) }), "LOCATOR_FINGERPRINT_DRIFT"],
    ["malformed", () => ({ kind: "csv_row" }), "INVALID_SOURCE_LOCATOR"],
    ["cross-artifact", (locator: any) => locator, "LOCATOR_CROSS_ARTIFACT"],
  ])("rejects %s CSV locators with a stable error", async (_name, mutate, code) => {
    const contract = await approvedContract();
    const entry = contract.coverageInventory.find((item: any) => item.locator.kind === "csv_row");
    const artifactId = code === "LOCATOR_CROSS_ARTIFACT" ? "map" : entry.artifactId;
    const bytes = await source(artifactId);
    expect(() => resolveSourceLocator({ artifactId, bytes, locator: mutate(entry.locator) })).toThrow(expect.objectContaining({ code }));
  });

  it("rejects duplicated CSV anchors even when their fingerprints match", async () => {
    const contract = await approvedContract();
    const entry = contract.coverageInventory.find((item: any) => item.locator.kind === "csv_row" && item.artifactId === "url-inventory");
    const bytes = await source("url-inventory");
    const duplicate = bytes.toString("utf8").split(/\r?\n/)[entry.locator.rowNumber - 1];
    expect(() => resolveSourceLocator({ artifactId: "url-inventory", bytes: Buffer.concat([bytes, Buffer.from(`\n${duplicate}\n`)]), locator: entry.locator })).toThrow(expect.objectContaining({ code: "LOCATOR_AMBIGUOUS" }));
  });

  it.each(["markdown_heading", "markdown_prose_span"])("resolves the approved %s variant and rejects fingerprint drift", async (kind) => {
    const contract = await approvedContract();
    const entry = contract.coverageInventory.find((item: any) => item.locator.kind === kind);
    const bytes = await source(entry.artifactId);
    expect(resolveSourceLocator({ artifactId: entry.artifactId, bytes, locator: entry.locator }).artifactId).toBe(entry.artifactId);
    expect(() => resolveSourceLocator({ artifactId: entry.artifactId, bytes, locator: { ...entry.locator, contentFingerprint: "0".repeat(64) } })).toThrow(expect.objectContaining({ code: "LOCATOR_FINGERPRINT_DRIFT" }));
  }, 30000);
});
