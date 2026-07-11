export const REQUIRED_ARTIFACT_IDS = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"] as const;
export type StrategyArtifactId = typeof REQUIRED_ARTIFACT_IDS[number];
export interface StrategyArtifactManifest { id: StrategyArtifactId; path: string; mediaType: "text/markdown" | "text/csv"; sha256: string; required: true; }
export interface StrategyManifest { schemaVersion: "1.0.0"; packageId: string; strategyVersion: string; evidenceDate: string; createdAt: string; provenance: Record<string, unknown>; compatibility: { runtimeSchema: string; pluginVersion: string; siteHost: "agrikoph.com"; urlNormalization: string }; artifacts: StrategyArtifactManifest[]; packageSha256: string; approval: Record<string, unknown>; }
export interface RawStrategyArtifact extends StrategyArtifactManifest { bytes: Buffer; byteLength: number; }
export interface RawStrategyPackage { manifest: StrategyManifest; packageSha256: string; root: string; artifacts: Record<StrategyArtifactId, RawStrategyArtifact>; }
