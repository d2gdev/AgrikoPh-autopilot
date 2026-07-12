import { createHash } from "node:crypto";
import { z } from "zod";
import {
  REQUIRED_ARTIFACT_IDS,
  SEMANTIC_SOURCE_ARTIFACT_IDS,
  type CompilationContractEnvelope,
  type SemanticSourceArtifactId,
  type StrategyArtifactId,
  type StrategyArtifactManifest,
  type StrategyArtifactMediaType,
  type StrategyCompatibility,
  type StrategyManifest,
} from "./types";

export type StrategyPackageErrorCode =
  | "INVALID_MANIFEST" | "UNSUPPORTED_SCHEMA" | "INCOMPATIBLE_RUNTIME" | "SITE_HOST_MISMATCH"
  | "MISSING_ARTIFACT" | "DUPLICATE_ARTIFACT" | "UNKNOWN_ARTIFACT" | "INVALID_SHA256"
  | "VERSION_MISMATCH" | "PACKAGE_HASH_MISMATCH" | "UNSAFE_PATH" | "SYMLINK_ESCAPE"
  | "HASH_MISMATCH" | "MISSING_FILE" | "MISSING_COMPILATION_CONTRACT"
  | "CONTRACT_FILENAME_MISMATCH" | "CONTRACT_MEDIA_TYPE_MISMATCH" | "INVALID_CONTRACT_ENCODING"
  | "INVALID_CONTRACT_ENVELOPE" | "UNSUPPORTED_CONTRACT_SCHEMA" | "INVALID_CONTRACT_REVISION"
  | "CONTRACT_STRATEGY_VERSION_MISMATCH" | "CONTRACT_SITE_HOST_MISMATCH"
  | "CONTRACT_SOURCE_ARTIFACT_MISMATCH" | "CONTRACT_SOURCE_HASH_MISMATCH"
  | "CONTRACT_COMPATIBILITY_MISMATCH";

export class StrategyPackageError extends Error {
  constructor(public readonly code: StrategyPackageErrorCode, message: string) {
    super(message);
    this.name = "StrategyPackageError";
  }
}

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha = /^[a-f0-9]{64}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const contractFilename = /^agriko-topical-map-compilation-contract-\d{4}-\d{2}-\d{2}\.json$/;
const contractRevision = /^[1-9][0-9]*$/;
const compatibilitySchema = z.object({
  runtimeSchema: z.string(),
  pluginVersion: z.string(),
  siteHost: z.string(),
  urlNormalization: z.string(),
}).strict();
const sourceArtifactSchema = z.object({ id: z.string(), sha256: z.string() }).strict();
const contractEnvelopeSchema = z.object({
  contractSchemaVersion: z.string(),
  contractRevision: z.string(),
  strategyVersion: z.string(),
  siteHost: z.string(),
  sourceArtifacts: z.array(z.unknown()),
  compatibility: z.unknown(),
}).passthrough();

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function derivePackageSha256(manifest: Omit<StrategyManifest, "packageSha256">): string {
  return hash(`${canonicalJson(manifest)}\n${manifest.artifacts.map((artifact) => artifact.sha256).join("\n")}`);
}

function expectedArtifact(id: StrategyArtifactId, strategyVersion: string): { path: string; mediaType: StrategyArtifactMediaType } {
  if (id === "map") return { path: `agriko-topical-map-${strategyVersion}.md`, mediaType: "text/markdown" };
  if (id === "evidence") return { path: `agriko-topical-map-evidence-${strategyVersion}.md`, mediaType: "text/markdown" };
  if (id === "compilation-contract") return { path: `agriko-topical-map-compilation-contract-${strategyVersion}.json`, mediaType: "application/json" };
  return { path: `agriko-topical-map-${id}-${strategyVersion}.csv`, mediaType: "text/csv" };
}

function manifestErrorForContract(id: string, kind: "path" | "mediaType"): StrategyPackageErrorCode {
  if (id !== "compilation-contract") return kind === "path" ? "VERSION_MISMATCH" : "INVALID_MANIFEST";
  return kind === "path" ? "CONTRACT_FILENAME_MISMATCH" : "CONTRACT_MEDIA_TYPE_MISMATCH";
}

export function parseManifest(value: unknown): StrategyManifest {
  if (!isRecord(value) || !Array.isArray(value.artifacts) || !isRecord(value.compatibility) || !isRecord(value.provenance) || !isRecord(value.approval)) throw new StrategyPackageError("INVALID_MANIFEST", "Manifest is malformed.");
  if (value.schemaVersion !== "1.0.0") throw new StrategyPackageError("UNSUPPORTED_SCHEMA", "Unsupported manifest schema.");
  if (value.compatibility.runtimeSchema !== ">=1.0.0 <2.0.0") throw new StrategyPackageError("INCOMPATIBLE_RUNTIME", "Unsupported runtime compatibility.");
  if (value.compatibility.siteHost !== "agrikoph.com") throw new StrategyPackageError("SITE_HOST_MISMATCH", "Unsupported site host.");
  for (const key of ["packageId", "strategyVersion", "evidenceDate", "createdAt", "packageSha256"]) if (typeof value[key] !== "string") throw new StrategyPackageError("INVALID_MANIFEST", `Invalid ${key}.`);
  if (!date.test(value.strategyVersion as string) || !date.test(value.evidenceDate as string) || value.packageId !== `agriko-topical-map-${value.strategyVersion}` || Number.isNaN(Date.parse(value.createdAt as string))) throw new StrategyPackageError("INVALID_MANIFEST", "Invalid version or date.");
  if (!sha.test(value.packageSha256 as string)) throw new StrategyPackageError("INVALID_SHA256", "Invalid package hash.");

  const seen = new Set<string>();
  const artifacts = value.artifacts.map((entry): StrategyArtifactManifest => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.path !== "string" || typeof entry.mediaType !== "string" || typeof entry.sha256 !== "string" || entry.required !== true) throw new StrategyPackageError("INVALID_MANIFEST", "Invalid artifact.");
    if (/\0/.test(entry.path) || /^(?:\/|[A-Za-z]:[\\/])/.test(entry.path) || entry.path.split(/[\\/]/).includes("..")) throw new StrategyPackageError("UNSAFE_PATH", "Unsafe artifact path.");
    if (!REQUIRED_ARTIFACT_IDS.includes(entry.id as StrategyArtifactId)) throw new StrategyPackageError("UNKNOWN_ARTIFACT", "Unknown artifact.");
    if (seen.has(entry.id)) throw new StrategyPackageError("DUPLICATE_ARTIFACT", "Duplicate artifact.");
    seen.add(entry.id);
    if (!sha.test(entry.sha256)) throw new StrategyPackageError("INVALID_SHA256", "Invalid artifact hash.");
    const expected = expectedArtifact(entry.id as StrategyArtifactId, value.strategyVersion as string);
    if (entry.id === "compilation-contract" ? !contractFilename.test(entry.path) : entry.path !== expected.path) throw new StrategyPackageError(manifestErrorForContract(entry.id, "path"), "Artifact filename/version mismatch.");
    if (entry.mediaType !== expected.mediaType) throw new StrategyPackageError(manifestErrorForContract(entry.id, "mediaType"), "Artifact media type is invalid.");
    return { id: entry.id as StrategyArtifactId, path: entry.path, mediaType: expected.mediaType, sha256: entry.sha256, required: true };
  });

  for (const id of REQUIRED_ARTIFACT_IDS) {
    if (!seen.has(id)) throw new StrategyPackageError(id === "compilation-contract" ? "MISSING_COMPILATION_CONTRACT" : "MISSING_ARTIFACT", "Missing required artifact.");
  }
  const manifest: StrategyManifest = {
    schemaVersion: "1.0.0", packageId: value.packageId as string, strategyVersion: value.strategyVersion as string,
    evidenceDate: value.evidenceDate as string, createdAt: value.createdAt as string, provenance: value.provenance,
    compatibility: value.compatibility as unknown as StrategyCompatibility, artifacts, packageSha256: value.packageSha256 as string, approval: value.approval,
  };
  const withoutHash = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "packageSha256")) as Omit<StrategyManifest, "packageSha256">;
  if (derivePackageSha256(withoutHash) !== manifest.packageSha256) throw new StrategyPackageError("PACKAGE_HASH_MISMATCH", "Package hash mismatch.");
  return manifest;
}

export function parseCompilationContractEnvelope(value: unknown, manifest: StrategyManifest): CompilationContractEnvelope {
  const envelopeResult = contractEnvelopeSchema.safeParse(value);
  if (!envelopeResult.success) throw new StrategyPackageError("INVALID_CONTRACT_ENVELOPE", "Compilation contract envelope is invalid.");
  const envelope = envelopeResult.data;
  if (envelope.contractSchemaVersion !== "1.0.0") throw new StrategyPackageError("UNSUPPORTED_CONTRACT_SCHEMA", "Unsupported compilation contract schema.");
  if (!contractRevision.test(envelope.contractRevision)) throw new StrategyPackageError("INVALID_CONTRACT_REVISION", "Compilation contract revision is invalid.");
  if (envelope.strategyVersion !== manifest.strategyVersion) throw new StrategyPackageError("CONTRACT_STRATEGY_VERSION_MISMATCH", "Compilation contract strategy version does not match manifest.");
  if (envelope.siteHost !== "agrikoph.com" || envelope.siteHost !== manifest.compatibility.siteHost) throw new StrategyPackageError("CONTRACT_SITE_HOST_MISMATCH", "Compilation contract site host does not match manifest.");

  const sourceArtifactsResult = z.array(sourceArtifactSchema).safeParse(envelope.sourceArtifacts);
  if (!sourceArtifactsResult.success || sourceArtifactsResult.data.length !== SEMANTIC_SOURCE_ARTIFACT_IDS.length || sourceArtifactsResult.data.some((artifact, index) => artifact.id !== SEMANTIC_SOURCE_ARTIFACT_IDS[index])) throw new StrategyPackageError("CONTRACT_SOURCE_ARTIFACT_MISMATCH", "Compilation contract source artifact identities are invalid.");
  if (sourceArtifactsResult.data.some((artifact) => !sha.test(artifact.sha256))) throw new StrategyPackageError("CONTRACT_SOURCE_HASH_MISMATCH", "Compilation contract source hash is invalid.");
  for (const source of sourceArtifactsResult.data) {
    const manifestArtifact = manifest.artifacts.find((artifact) => artifact.id === source.id);
    if (!manifestArtifact || manifestArtifact.sha256 !== source.sha256) throw new StrategyPackageError("CONTRACT_SOURCE_HASH_MISMATCH", "Compilation contract source hash does not match manifest.");
  }

  const compatibilityResult = compatibilitySchema.safeParse(envelope.compatibility);
  if (!compatibilityResult.success) throw new StrategyPackageError("CONTRACT_COMPATIBILITY_MISMATCH", "Compilation contract compatibility does not match manifest.");
  if (compatibilityResult.data.siteHost !== "agrikoph.com" || compatibilityResult.data.siteHost !== manifest.compatibility.siteHost) throw new StrategyPackageError("CONTRACT_SITE_HOST_MISMATCH", "Compilation contract site host does not match manifest.");
  if (canonicalJson(compatibilityResult.data) !== canonicalJson(manifest.compatibility)) throw new StrategyPackageError("CONTRACT_COMPATIBILITY_MISMATCH", "Compilation contract compatibility does not match manifest.");
  return { ...envelope, contractSchemaVersion: "1.0.0", siteHost: "agrikoph.com", sourceArtifacts: sourceArtifactsResult.data as Array<{ id: SemanticSourceArtifactId; sha256: string }>, compatibility: compatibilityResult.data as StrategyCompatibility };
}
