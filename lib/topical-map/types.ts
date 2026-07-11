export const SEMANTIC_SOURCE_ARTIFACT_IDS = ["map", "evidence", "url-inventory", "redirect-inventory", "internal-links"] as const;
export const REQUIRED_ARTIFACT_IDS = [...SEMANTIC_SOURCE_ARTIFACT_IDS, "compilation-contract"] as const;

export type SemanticSourceArtifactId = typeof SEMANTIC_SOURCE_ARTIFACT_IDS[number];
export type StrategyArtifactId = typeof REQUIRED_ARTIFACT_IDS[number];
export type StrategyArtifactMediaType = "text/markdown" | "text/csv" | "application/json";

export interface StrategyArtifactManifest {
  id: StrategyArtifactId;
  path: string;
  mediaType: StrategyArtifactMediaType;
  sha256: string;
  required: true;
}

export interface StrategyCompatibility {
  runtimeSchema: string;
  pluginVersion: string;
  siteHost: "agrikoph.com";
  urlNormalization: string;
}

export interface StrategyManifest {
  schemaVersion: "1.0.0";
  packageId: string;
  strategyVersion: string;
  evidenceDate: string;
  createdAt: string;
  provenance: Record<string, unknown>;
  compatibility: StrategyCompatibility;
  artifacts: StrategyArtifactManifest[];
  packageSha256: string;
  approval: Record<string, unknown>;
}

export interface CompilationContractSourceArtifact {
  id: SemanticSourceArtifactId;
  sha256: string;
}

export interface CompilationContractEnvelope {
  contractSchemaVersion: "1.0.0";
  contractRevision: string;
  strategyVersion: string;
  siteHost: "agrikoph.com";
  sourceArtifacts: CompilationContractSourceArtifact[];
  compatibility: StrategyCompatibility;
  [opaqueTopLevelField: string]: unknown;
}

export interface RawStrategyArtifact extends StrategyArtifactManifest {
  bytes: Buffer;
  byteLength: number;
}

export interface RawStrategyPackage {
  manifest: StrategyManifest;
  packageSha256: string;
  root: string;
  artifacts: Record<StrategyArtifactId, RawStrategyArtifact>;
}

export type CompilationContractErrorCode = "INVALID_CONTRACT_SCHEMA";

export class CompilationContractError extends Error {
  constructor(public readonly code: CompilationContractErrorCode) {
    super("Compilation contract schema is invalid.");
    this.name = "CompilationContractError";
  }
}
