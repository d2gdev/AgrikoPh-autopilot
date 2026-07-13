import { normalizeGovernedUrl } from "./url-normalizer";

export const ALL_TOPICAL_MAP_DOMAINS = ["clusters", "page_roles", "url_intent_ownership", "content_decisions", "prohibited_content", "internal_links", "redirects", "canonicalization", "indexation", "evidence_gates", "high_stakes_reviews"] as const;
export type TopicalMapDomain = typeof ALL_TOPICAL_MAP_DOMAINS[number];
export type DomainCounts = Record<TopicalMapDomain, number>;
export type ProjectedLocator =
  | { kind: "markdown_heading" | "markdown_prose_span"; headingPath: string[]; contentFingerprint: string; lineStart: number; lineEnd: number }
  | { kind: "csv_row"; businessKey: string; headerFingerprint: string; rowFingerprint: string; rowNumber: number };
export type SourceReference = { coverageUnitId: string; artifactId: string; locator: ProjectedLocator };
export type InputSourceReference = { coverageUnitId?: unknown; artifactId?: unknown; locator?: unknown };
export type ProjectionRule = { ruleId: string; ruleType: string; payload: unknown; sourceArtifactId: string; sourceReferences: InputSourceReference[] };
export type ProjectionInput = { strategy: { id: string; strategyVersion: string; contractRevision: string; packageSha256: string; activatedAt: Date | string | null }; rules: ProjectionRule[] };
type RuleEvidence = { ruleIds: string[] };
export type CommandCenterPage = RuleEvidence & { url: string; cluster?: string; role?: string; dominantIntent?: string; primaryKeywordOrTheme?: string; exclusiveIntentScope?: string; decision?: string; exactTargetIfAny?: string; priority?: string; evidence?: string };
export type TopicalMapCommandCenter = {
  identity: { versionId: string; strategyVersion: string; contractRevision: string; packageSha256: string; activatedAt: string | null };
  domainCounts: DomainCounts;
  clusters: Array<RuleEvidence & { name: string; memberUrls: string[] }>;
  pages: CommandCenterPage[];
  prohibited: Array<RuleEvidence & { url: string; item: string; priority?: string; evidence?: string }>;
  work: {
    internalLinks: Array<RuleEvidence & { fromUrl: string; toUrl: string; currentBodyState?: string; requiredAction?: string; recommendedAnchor?: string; linkPurpose?: string; priority?: string; verification?: string }>;
    redirects: Array<RuleEvidence & { redirectId?: string; source: string; configuredTarget?: string; finalTarget: string; hopCount?: string; topicRelevant?: string; knownState?: string; requiredAction?: string; priority?: string; evidence?: string }>;
    canonicalization: Array<RuleEvidence & { currentUrl: string; proposedCanonicalUrl: string; decision?: string; priority?: string; evidence?: string }>;
    indexation: Array<RuleEvidence & { currentUrl: string; proposedCanonicalUrl: string; publishingState?: string; decision?: string; priority?: string; evidence?: string }>;
  };
  blockers: { evidence: Array<RuleEvidence & { name: string; text: string }>; reviews: Array<RuleEvidence & { name: string; text: string }> };
  provenance: Record<string, { sourceArtifactId: string; sourceReferences: SourceReference[] }>;
};

const domainSet = new Set<string>(ALL_TOPICAL_MAP_DOMAINS);
function assertDomain(value: string): TopicalMapDomain { if (!domainSet.has(value)) throw new Error("UNKNOWN_TOPICAL_MAP_DOMAIN"); return value as TopicalMapDomain; }
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(payload: Record<string, unknown>, key: string): string | undefined { return typeof payload[key] === "string" && payload[key] !== "" ? payload[key] as string : undefined; }
function url(value: string | undefined): string { if (!value) return ""; const normalized = normalizeGovernedUrl(value); if (normalized.startsWith("/")) return normalized; const parsed = new URL(normalized); return `${parsed.pathname}${parsed.search}${parsed.hash}`; }
function priority(value?: string): number { const ranks: Record<string, number> = { critical: 0, highest: 0, high: 1, medium: 2, low: 3 }; return ranks[value?.toLowerCase() ?? ""] ?? 4; }
function ordered<T extends { ruleIds: string[]; priority?: string }>(values: T[], key: (v: T) => string): T[] { return values.sort((a, b) => priority(a.priority) - priority(b.priority) || key(a).localeCompare(key(b)) || a.ruleIds.join().localeCompare(b.ruleIds.join())); }
function projectedReference(value: InputSourceReference): SourceReference {
  if (typeof value.coverageUnitId !== "string" || typeof value.artifactId !== "string") throw new Error("INVALID_SOURCE_REFERENCE");
  const locator = object(value.locator);
  if ((locator.kind === "markdown_heading" || locator.kind === "markdown_prose_span") && Array.isArray(locator.headingPath) && locator.headingPath.every((v) => typeof v === "string") && typeof locator.contentFingerprint === "string" && Number.isInteger(locator.lineStart) && Number.isInteger(locator.lineEnd)) return { coverageUnitId: value.coverageUnitId, artifactId: value.artifactId, locator: { kind: locator.kind, headingPath: [...locator.headingPath] as string[], contentFingerprint: locator.contentFingerprint, lineStart: locator.lineStart as number, lineEnd: locator.lineEnd as number } };
  if (locator.kind === "csv_row" && typeof locator.businessKey === "string" && typeof locator.headerFingerprint === "string" && typeof locator.rowFingerprint === "string" && Number.isInteger(locator.rowNumber)) return { coverageUnitId: value.coverageUnitId, artifactId: value.artifactId, locator: { kind: "csv_row", businessKey: locator.businessKey, headerFingerprint: locator.headerFingerprint, rowFingerprint: locator.rowFingerprint, rowNumber: locator.rowNumber as number } };
  throw new Error("INVALID_SOURCE_REFERENCE");
}

export function projectTopicalMapCommandCenter(input: ProjectionInput): TopicalMapCommandCenter {
  const domainCounts = Object.fromEntries(ALL_TOPICAL_MAP_DOMAINS.map((domain) => [domain, 0])) as DomainCounts;
  const byDomain = new Map<TopicalMapDomain, ProjectionRule[]>();
  const provenance: TopicalMapCommandCenter["provenance"] = {};
  const sortedRules = [...input.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  for (let index = 1; index < sortedRules.length; index++) if (sortedRules[index - 1]!.ruleId === sortedRules[index]!.ruleId) throw new Error("DUPLICATE_TOPICAL_MAP_RULE_ID");
  for (const rule of sortedRules) { const domain = assertDomain(rule.ruleType); domainCounts[domain]++; byDomain.set(domain, [...(byDomain.get(domain) ?? []), rule]); provenance[rule.ruleId] = { sourceArtifactId: rule.sourceArtifactId, sourceReferences: rule.sourceReferences.map(projectedReference).sort((a, b) => a.coverageUnitId.localeCompare(b.coverageUnitId) || a.artifactId.localeCompare(b.artifactId) || JSON.stringify(a.locator).localeCompare(JSON.stringify(b.locator))) }; }
  const rules = (domain: TopicalMapDomain) => (byDomain.get(domain) ?? []).slice().sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const clusters = rules("clusters").map((r) => { const p = object(r.payload); return { name: text(p, "cluster") ?? "", memberUrls: Array.isArray(p.memberUrls) ? p.memberUrls.filter((v): v is string => typeof v === "string").map((v) => url(v)).sort() : [], ruleIds: [r.ruleId] }; }).sort((a, b) => a.name.localeCompare(b.name));
  const pageMap = new Map<string, CommandCenterPage>();
  for (const domain of ["page_roles", "url_intent_ownership", "content_decisions"] as const) for (const r of rules(domain)) { const p = object(r.payload); const normalized = url(text(p, "currentUrl")); if (!normalized) continue; const page = pageMap.get(normalized) ?? { url: normalized, ruleIds: [] }; page.ruleIds.push(r.ruleId); for (const key of ["cluster", "role", "dominantIntent", "primaryKeywordOrTheme", "exclusiveIntentScope", "decision", "exactTargetIfAny", "priority", "evidence"] as const) { const value = text(p, key); if (value !== undefined) page[key] = value; } pageMap.set(normalized, page); }
  const pages = ordered([...pageMap.values()].map((p) => ({ ...p, ruleIds: p.ruleIds.sort() })), (p) => p.url);
  const prohibited = ordered(rules("prohibited_content").map((r) => { const p = object(r.payload); return { url: url(text(p, "currentUrl")), item: text(p, "exactTargetIfAny") ?? text(p, "decision") ?? "", priority: text(p, "priority"), evidence: text(p, "evidence"), ruleIds: [r.ruleId] }; }), (v) => v.url);
  const internalLinks = ordered(rules("internal_links").map((r) => { const p = object(r.payload); return { fromUrl: url(text(p, "fromUrl")), toUrl: url(text(p, "toUrl")), currentBodyState: text(p, "currentBodyState"), requiredAction: text(p, "requiredAction"), recommendedAnchor: text(p, "recommendedAnchor"), linkPurpose: text(p, "linkPurpose"), priority: text(p, "priority"), verification: text(p, "verification"), ruleIds: [r.ruleId] }; }), (v) => `${v.fromUrl}\0${v.toUrl}`);
  const redirects = ordered(rules("redirects").map((r) => { const p = object(r.payload); return { redirectId: text(p, "redirectId"), source: url(text(p, "source")), configuredTarget: text(p, "configuredTarget") ? url(text(p, "configuredTarget")) : undefined, finalTarget: url(text(p, "finalTarget")), hopCount: text(p, "hopCount"), topicRelevant: text(p, "topicRelevant"), knownState: text(p, "knownState"), requiredAction: text(p, "requiredAction"), priority: text(p, "priority"), evidence: text(p, "evidence"), ruleIds: [r.ruleId] }; }), (v) => v.source);
  const technical = (domain: "canonicalization" | "indexation") => ordered(rules(domain).map((r) => { const p = object(r.payload); return { currentUrl: url(text(p, "currentUrl")), proposedCanonicalUrl: url(text(p, "proposedCanonicalUrl")), publishingState: text(p, "publishingState"), decision: text(p, "decision"), priority: text(p, "priority"), evidence: text(p, "evidence"), ruleIds: [r.ruleId] }; }), (v) => v.currentUrl);
  const literal = (domain: "evidence_gates" | "high_stakes_reviews") => rules(domain).map((r) => { const p = object(r.payload); return { name: text(p, "name") ?? "", text: text(p, "literalText") ?? "", ruleIds: [r.ruleId] }; }).sort((a, b) => a.name.localeCompare(b.name) || a.ruleIds[0]!.localeCompare(b.ruleIds[0]!));
  return { identity: { versionId: input.strategy.id, strategyVersion: input.strategy.strategyVersion, contractRevision: input.strategy.contractRevision, packageSha256: input.strategy.packageSha256, activatedAt: input.strategy.activatedAt === null ? null : new Date(input.strategy.activatedAt).toISOString() }, domainCounts, clusters, pages, prohibited, work: { internalLinks, redirects, canonicalization: technical("canonicalization"), indexation: technical("indexation") }, blockers: { evidence: literal("evidence_gates"), reviews: literal("high_stakes_reviews") }, provenance };
}

type CommandCenterStoredRule = { ruleId: string; ruleType: string; sourceArtifactId: string; compiledPayload: unknown };
type CommandCenterActivation = { strategyVersion: { id: string; strategyVersion: string; contractRevision: number | string | null; packageSha256: string; activatedAt: Date | string | null; lifecycle: string; validationStatus: string; compiledRules: CommandCenterStoredRule[] } } | null;

export async function loadActiveTopicalMapCommandCenter(db: { topicalMapActivation: { findUnique(args: unknown): Promise<unknown> } }): Promise<TopicalMapCommandCenter | null> {
  const activation = await db.topicalMapActivation.findUnique({ where: { siteHost: "agrikoph.com" }, select: { strategyVersion: { select: { id: true, strategyVersion: true, contractRevision: true, packageSha256: true, activatedAt: true, lifecycle: true, validationStatus: true, compiledRules: { select: { ruleId: true, ruleType: true, sourceArtifactId: true, compiledPayload: true } } } } } });
  if (!activation) return null;
  const active = (activation as CommandCenterActivation)!.strategyVersion;
  if (active.lifecycle !== "active" || active.validationStatus !== "valid" || active.contractRevision === null) return null;
  return projectTopicalMapCommandCenter({ strategy: { ...active, contractRevision: String(active.contractRevision) }, rules: active.compiledRules.map((rule) => { const compiled = object(rule.compiledPayload); return { ruleId: rule.ruleId, ruleType: rule.ruleType, sourceArtifactId: rule.sourceArtifactId, payload: compiled.payload, sourceReferences: Array.isArray(compiled.sourceReferences) ? compiled.sourceReferences : [] }; }) });
}
