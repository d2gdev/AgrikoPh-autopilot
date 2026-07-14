import { createHash } from "node:crypto";
import { hasMissingMeta } from "@/lib/seo/meta";
import type { GscQueryPageRow, GscQueryRow } from "@/lib/seo/types";
import { z } from "zod";
import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";
import { topicalMapActionEligibility, topicalMapInternalLinkEligibility, topicalMapInternalLinkRequiresAddition } from "@/lib/topical-map/action-eligibility";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "how", "why",
  "what", "which", "where", "when", "does", "can", "its",
]);

export interface SeoAnalysisLimits {
  queriesTotal: number;
  queriesAnalyzed: number;
  articlesTotalLowerBound: number;
  articlesAnalyzed: number;
  articlesTruncated: boolean;
}

export interface SeoAnalysisArticle {
  blogHandle?: string;
  handle: string;
  title: string;
  wordCount: number | null;
  internalLinkCount: number | null;
  seoData: unknown;
  updatedAt?: Date;
}

export interface ProgrammaticSeoGap {
  query: string;
  impressions: number;
  position: number;
  suggestedTitle: string;
  issue?: "missing-meta" | "thin-content";
  articleHandle?: string;
  wordCount?: number | null;
}

export type StrategyIdentity = { versionId: string; packageSha256: string };
export function readAnalysisStrategyIdentity(payload: unknown): StrategyIdentity | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.schemaVersion !== "2" || !value.strategy || typeof value.strategy !== "object" || Array.isArray(value.strategy)) return null;
  const strategy = value.strategy as Record<string, unknown>;
  return typeof strategy.versionId === "string" && typeof strategy.packageSha256 === "string" && /^[a-f0-9]{64}$/.test(strategy.packageSha256)
    ? { versionId: strategy.versionId, packageSha256: strategy.packageSha256 }
    : null;
}
export type MapAwareSeoGap = {
  candidateId: string;
  kind: "content" | "link";
  strategyVersionId: string;
  packageSha256: string;
  ruleIds: string[];
  state: "candidate";
  action: "create" | "update" | "refresh";
  query: string;
  suggestedTitle: string;
  currentArticleTitle?: string;
  page?: string;
  fromUrl?: string;
  toUrl?: string;
  type?: string;
  priority: string;
  mapEvidence: string | null;
  observedEvidence: Array<{ query: string; impressions: number; position: number | null }>;
  observation: { source: "store" | "link_inspection"; capturedAt: string; provenance: string };
};
export type MapAwareSeoAnalysis = {
  gaps: MapAwareSeoGap[];
  observations: ProgrammaticSeoGap[];
  suppressed: Array<{ strategyVersionId: string; packageSha256: string; page: string; reason: string; ruleIds: string[]; currentArticleTitle?: string; observation?: { source: "store"; capturedAt: string; provenance: string } }>;
};

const IdentitySchema = z.object({ versionId: z.string().min(1), packageSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const MapGapSchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(["content", "link"]), strategyVersionId: z.string().min(1), packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ruleIds: z.array(z.string().min(1)).min(1), state: z.literal("candidate"), action: z.enum(["create", "update", "refresh"]), query: z.string().min(1), suggestedTitle: z.string().min(1), currentArticleTitle: z.string().min(1).max(500).optional(),
  page: z.string().min(1).optional(), fromUrl: z.string().min(1).optional(), toUrl: z.string().min(1).optional(), type: z.string().min(1).optional(),
  priority: z.string().min(1), mapEvidence: z.string().min(1).nullable(), observedEvidence: z.array(z.object({ query: z.string().min(1), impressions: z.number().nonnegative(), position: z.number().nullable() }).strict()).max(20),
  observation: z.object({ source: z.enum(["store", "link_inspection"]), capturedAt: z.string().datetime(), provenance: z.string().min(1).max(200) }).strict(),
}).strict();
const ObservationSchema = z.object({ query: z.string().min(1), impressions: z.number().nonnegative(), position: z.number(), suggestedTitle: z.string().min(1), issue: z.enum(["missing-meta", "thin-content"]).optional(), articleHandle: z.string().min(1).optional(), wordCount: z.number().nullable().optional() }).strict();
const SuppressedSchema = z.object({ strategyVersionId: z.string().min(1), packageSha256: z.string().regex(/^[a-f0-9]{64}$/), page: z.string().min(1), reason: z.string().min(1), ruleIds: z.array(z.string().min(1)).min(1), currentArticleTitle: z.string().min(1).max(500).optional(), observation: z.object({ source: z.literal("store"), capturedAt: z.string().datetime(), provenance: z.string().min(1).max(200) }).strict().optional() }).strict();
export const SEO_ANALYSIS_MAX_AGE_HOURS = 72;

export function mapCandidateId(input: Pick<MapAwareSeoGap, "strategyVersionId" | "packageSha256" | "kind" | "action" | "ruleIds" | "page" | "fromUrl" | "toUrl">): string {
  const normalize = (value?: string) => value ? normalizeGovernedUrl(value) : null;
  return createHash("sha256").update(JSON.stringify([
    input.strategyVersionId,
    input.packageSha256,
    input.kind,
    input.action,
    normalize(input.page),
    normalize(input.fromUrl),
    normalize(input.toUrl),
    [...new Set(input.ruleIds)].sort(),
  ])).digest("hex");
}
export const AnalysisEvidenceSchema = z.object({
  gscCapturedAt: z.string().datetime().nullable(),
  storeCapturedAt: z.string().datetime().nullable(),
  linkCapturedAt: z.string().datetime().nullable(),
  requiredObservationFamilies: z.array(z.enum(["store", "link_inspection"])).max(2),
  storeInspection: z.object({ required: z.number().int().nonnegative(), inspected: z.number().int().nonnegative() }).strict(),
  linkInspection: z.object({ required: z.number().int().nonnegative(), inspected: z.number().int().nonnegative() }).strict(),
  maxAgeHours: z.literal(SEO_ANALYSIS_MAX_AGE_HOURS),
}).strict().superRefine((value, ctx) => {
  const families = new Set(value.requiredObservationFamilies);
  if (families.size !== value.requiredObservationFamilies.length) ctx.addIssue({ code: "custom", message: "Duplicate observation family" });
  for (const [family, inspection, capturedAt] of [["store", value.storeInspection, value.storeCapturedAt], ["link_inspection", value.linkInspection, value.linkCapturedAt]] as const) {
    if ((inspection.required > 0) !== families.has(family)) ctx.addIssue({ code: "custom", message: `Required observation family mismatch: ${family}` });
    if (inspection.inspected > inspection.required) ctx.addIssue({ code: "custom", message: `Inspected count exceeds required count: ${family}` });
    if ((inspection.inspected > 0) !== (capturedAt !== null)) ctx.addIssue({ code: "custom", message: `Observation timestamp/count mismatch: ${family}` });
  }
});
export const MapAnalysisEnvelopeSchema = z.object({
  schemaVersion: z.literal("2"),
  strategy: IdentitySchema,
  generatedAt: z.string().datetime(),
  analysis: z.object({ gaps: z.array(MapGapSchema), observations: z.array(ObservationSchema), suppressed: z.array(SuppressedSchema) }).strict(),
  evidence: AnalysisEvidenceSchema,
  presentation: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, ctx) => {
  for (const item of [...value.analysis.gaps, ...value.analysis.suppressed]) if (item.strategyVersionId !== value.strategy.versionId || item.packageSha256 !== value.strategy.packageSha256) ctx.addIssue({ code: "custom", message: "Analysis item strategy identity mismatch" });
  for (const gap of value.analysis.gaps) {
    if ((gap.kind === "content" && gap.observation.source !== "store") || (gap.kind === "link" && gap.observation.source !== "link_inspection")) ctx.addIssue({ code: "custom", message: "Analysis observation source mismatch" });
    if (gap.candidateId !== mapCandidateId(gap)) ctx.addIssue({ code: "custom", message: "Analysis candidate identity mismatch" });
  }
});

export function readAnalysisForStrategy(payload: unknown, active: StrategyIdentity): MapAwareSeoAnalysis | null {
  const parsed = MapAnalysisEnvelopeSchema.safeParse(payload);
  return parsed.success && parsed.data.strategy.versionId === active.versionId && parsed.data.strategy.packageSha256 === active.packageSha256
    ? parsed.data.analysis as MapAwareSeoAnalysis : null;
}

export function createMapAnalysisEnvelope(input: { strategy: StrategyIdentity; generatedAt: Date; analysis: MapAwareSeoAnalysis; evidence: z.infer<typeof AnalysisEvidenceSchema>; presentation?: Record<string, unknown> }) {
  return MapAnalysisEnvelopeSchema.parse({ schemaVersion: "2", strategy: { versionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256 }, generatedAt: input.generatedAt.toISOString(), analysis: input.analysis, evidence: input.evidence, ...(input.presentation ? { presentation: input.presentation } : {}) });
}

export function analysisEvidenceState(payload: unknown, now = new Date()): "current" | "evidence_stale" | "observation_unavailable" {
  const parsed = MapAnalysisEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return "observation_unavailable";
  const evidence = parsed.data.evidence;
  if (!evidence.gscCapturedAt) return "observation_unavailable";
  for (const family of evidence.requiredObservationFamilies) {
    const inspection = family === "store" ? evidence.storeInspection : evidence.linkInspection;
    const capturedAt = family === "store" ? evidence.storeCapturedAt : evidence.linkCapturedAt;
    if (inspection.inspected !== inspection.required || !capturedAt) return "observation_unavailable";
  }
  const timestamps = [evidence.gscCapturedAt, ...evidence.requiredObservationFamilies.map(family => family === "store" ? evidence.storeCapturedAt! : evidence.linkCapturedAt!)];
  if (timestamps.some(value => new Date(value).getTime() > now.getTime() + 5 * 60_000)) return "observation_unavailable";
  return timestamps.some(value => now.getTime() - new Date(value).getTime() > evidence.maxAgeHours * 3_600_000) ? "evidence_stale" : "current";
}

export function buildMapAwareSeoGaps(input: {
  strategy: StrategyIdentity;
  commandCenter: TopicalMapCommandCenter;
  queries: GscQueryRow[];
  queryPagePairs: GscQueryPageRow[];
  articles: SeoAnalysisArticle[];
  verifiedAbsentUrls?: Map<string, Date>;
  linkInspections?: Map<string, { capturedAt: Date; targets: Set<string> }>;
  asOf?: Date;
}): MapAwareSeoAnalysis {
  const asOf = input.asOf ?? new Date();
  const usable = (capturedAt: Date) => capturedAt.getTime() <= asOf.getTime() + 5 * 60_000 && asOf.getTime() - capturedAt.getTime() <= SEO_ANALYSIS_MAX_AGE_HOURS * 3_600_000;
  const articleUrl = (article: SeoAnalysisArticle) => normalizeGovernedUrl(`/blogs/${article.blogHandle ?? "news"}/${article.handle}`);
  const existing = new Set(input.articles.map(articleUrl));
  const observations = buildProgrammaticSeoGaps(input);
  const queries = new Map(input.queries.map(item => [item.query.toLowerCase(), item]));
  const evidenceFor = (query: string, page?: string) => {
    const byPage = page ? input.queryPagePairs.filter(item => normalizeGovernedUrl(item.page) === page).slice(0, 20).map(item => ({ query: item.query, impressions: item.impressions, position: Number.isFinite(Number(item.position)) ? Number(item.position) : null })) : [];
    if (byPage.length) return byPage;
    const item = queries.get(query.toLowerCase());
    return item ? [{ query: item.query, impressions: item.impressions, position: Number.isFinite(Number(item.position)) ? Number(item.position) : null }] : [];
  };
  const prohibitedByUrl = new Map(input.commandCenter.prohibited.map((item) => [item.url, item]));
  const gaps: MapAwareSeoGap[] = [];
  const suppressed: MapAwareSeoAnalysis["suppressed"] = [];
  const suppressedStoreContext = (pageUrl: string) => {
    const article = input.articles.find(item => articleUrl(item) === pageUrl);
    const capturedAt = article?.updatedAt ?? input.verifiedAbsentUrls?.get(pageUrl);
    return {
      ...(article?.title ? { currentArticleTitle: article.title } : {}),
      ...(capturedAt ? { observation: { source: "store" as const, capturedAt: capturedAt.toISOString(), provenance: article ? `ArticleRecord:${article.blogHandle ?? "news"}/${article.handle}` : `ArticleRecord:absence:${pageUrl}` } } : {}),
    };
  };
  for (const page of input.commandCenter.pages) {
    if (!page.decision) continue;
    if (!page.contentDecisionPolicy) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: "rule_policy_unavailable", ruleIds: [...page.ruleIds] });
      continue;
    }
    const eligibility = topicalMapActionEligibility(page.contentDecisionPolicy);
    if (!eligibility.actionable) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: eligibility.reason, ruleIds: [...page.ruleIds], ...suppressedStoreContext(page.url) });
      continue;
    }
    const exists = existing.has(page.url);
    const isBlog = /^\/blogs\/[^/]+\/[^/]+$/.test(page.url);
    if (!exists && !isBlog) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: "observation_unavailable: no verified Shopify-backed page observation", ruleIds: [...page.ruleIds] });
      continue;
    }
    if (!exists && input.verifiedAbsentUrls && !input.verifiedAbsentUrls.has(page.url)) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: "observation_unavailable: governed blog URL was not directly inspected", ruleIds: [...page.ruleIds] });
      continue;
    }
    const article = input.articles.find(item => articleUrl(item) === page.url);
    const capturedAt = exists ? article?.updatedAt : input.verifiedAbsentUrls?.get(page.url);
    if (!capturedAt || !usable(capturedAt)) { suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: "observation_unavailable: store observation is stale, future-dated, or missing", ruleIds: [...page.ruleIds] }); continue; }
    const create = !exists && /(create|publish|new)/i.test(page.decision);
    const refresh = exists && /(refresh|update|improve|optimi[sz]e|expand)/i.test(page.decision);
    if (!create && !refresh) continue;
    const prohibited = prohibitedByUrl.get(page.url);
    if (prohibited) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: page.url, reason: prohibited.item, ruleIds: [...page.ruleIds, ...prohibited.ruleIds].sort() });
      continue;
    }
    const query = page.primaryKeywordOrTheme ?? page.url;
    const gap = { kind: "content" as const, strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, ruleIds: [...page.ruleIds], state: "candidate" as const, action: refresh ? "refresh" as const : "create" as const, query, suggestedTitle: page.title ?? query, ...(article?.title ? { currentArticleTitle: article.title } : {}), page: page.url, priority: page.priority ?? "unspecified", mapEvidence: page.evidence ?? null, observedEvidence: evidenceFor(query, page.url), observation: { source: "store" as const, capturedAt: capturedAt.toISOString(), provenance: exists ? `ArticleRecord:${article!.blogHandle ?? "news"}/${article!.handle}` : `ArticleRecord:absence:${page.url}` } };
    gaps.push({ ...gap, candidateId: mapCandidateId(gap) });
  }
  for (const link of input.commandCenter.work.internalLinks) {
    const eligibility = topicalMapInternalLinkEligibility(link.policy, link.currentBodyState, link.requiredAction);
    if (!eligibility.actionable) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: link.fromUrl, reason: eligibility.reason, ruleIds: [...link.ruleIds] });
      continue;
    }
    if (!topicalMapInternalLinkRequiresAddition(link.requiredAction)) continue;
    const inspection = input.linkInspections?.get(link.fromUrl);
    if (input.linkInspections && !inspection) {
      suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: link.fromUrl, reason: "observation_unavailable: link source was not inspected", ruleIds: [...link.ruleIds] });
      continue;
    }
    if (!inspection || !usable(inspection.capturedAt)) { suppressed.push({ strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, page: link.fromUrl, reason: "observation_unavailable: link inspection is stale, future-dated, or missing", ruleIds: [...link.ruleIds] }); continue; }
    if (inspection?.targets.has(normalizeGovernedUrl(link.toUrl))) continue;
    const query = link.recommendedAnchor ?? link.toUrl;
    const gap = { kind: "link" as const, strategyVersionId: input.strategy.versionId, packageSha256: input.strategy.packageSha256, ruleIds: [...link.ruleIds], state: "candidate" as const, action: "update" as const, query, suggestedTitle: `Add internal link from ${link.fromUrl} to ${link.toUrl}`, page: link.fromUrl, fromUrl: link.fromUrl, toUrl: link.toUrl, type: "internal-link", priority: link.priority ?? "unspecified", mapEvidence: null, observedEvidence: evidenceFor(query), observation: { source: "link_inspection" as const, capturedAt: inspection.capturedAt.toISOString(), provenance: `ArticleRecord.linksData:${link.fromUrl}` } };
    gaps.push({ ...gap, candidateId: mapCandidateId(gap) });
  }
  return { gaps, observations, suppressed };
}

function articleHandleFromBlogPage(page: string | undefined): string | null {
  if (!page) return null;
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    path = page.split(/[?#]/)[0] ?? page;
  }
  const parts = path.split("/").filter(Boolean);
  const blogIndex = parts.findIndex((part) => part === "blogs");
  const handle = blogIndex >= 0 ? parts[blogIndex + 2] : null;
  return handle && /^[a-z0-9][a-z0-9_-]*$/i.test(handle) ? handle.toLowerCase() : null;
}

function meaningfulTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term));
}

function titleCoversQuery(title: string, query: string): boolean {
  const queryTerms = meaningfulTerms(query);
  if (queryTerms.length === 0) return false;
  const titleTerms = new Set(meaningfulTerms(title));
  const matchCount = queryTerms.filter((term) => titleTerms.has(term)).length;
  return queryTerms.length <= 2
    ? matchCount >= queryTerms.length
    : matchCount >= Math.max(2, Math.ceil(queryTerms.length * 0.75));
}

const gapKey = (gap: ProgrammaticSeoGap) =>
  gap.articleHandle
    ? `${gap.issue ?? "article"}:${gap.articleHandle.toLowerCase()}`
    : `new-content:${gap.query.trim().toLowerCase()}`;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const keys = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (keys.has(itemKey)) return false;
    keys.add(itemKey);
    return true;
  });
}

export function buildProgrammaticSeoGaps(input: {
  queries: GscQueryRow[];
  queryPagePairs: GscQueryPageRow[];
  articles: SeoAnalysisArticle[];
  queryLimit?: number;
}): ProgrammaticSeoGap[] {
  const articleHandles = new Set(input.articles.map((article) => article.handle.toLowerCase()));
  const coveredQueries = new Set<string>();
  for (const pair of input.queryPagePairs) {
    const handle = articleHandleFromBlogPage(pair.page);
    if (handle && articleHandles.has(handle)) coveredQueries.add(pair.query.toLowerCase());
  }

  const queries = input.queries
    .filter((query) => {
      const position = parseFloat(query.position);
      return position >= 5 && position <= 20 &&
        !coveredQueries.has(query.query.toLowerCase()) &&
        !input.articles.some((article) => titleCoversQuery(article.title, query.query));
    })
    .sort((a, b) =>
      b.impressions - a.impressions ||
      a.clicks - b.clicks ||
      parseFloat(a.position) - parseFloat(b.position) ||
      a.query.localeCompare(b.query)
    )
    .slice(0, input.queryLimit ?? 30);

  const gaps: ProgrammaticSeoGap[] = [];
  for (const query of queries) {
    const position = parseFloat(query.position);
    const title = query.query.charAt(0).toUpperCase() + query.query.slice(1);
    gaps.push({
      query: query.query,
      impressions: query.impressions,
      position,
      suggestedTitle: `${title}: Benefits, Uses & Complete Guide`,
    });
  }

  for (const article of input.articles.filter((item) => (item.wordCount ?? 0) < 300).slice(0, 5)) {
    gaps.push({
      query: article.title.toLowerCase(),
      impressions: 0,
      position: 0,
      suggestedTitle: article.title,
      issue: "thin-content",
      articleHandle: article.handle,
      wordCount: article.wordCount,
    });
  }

  for (const article of input.articles.filter((item) => hasMissingMeta(item.seoData)).slice(0, 5)) {
    gaps.push({
      query: article.title.toLowerCase(),
      impressions: 0,
      position: 0,
      suggestedTitle: article.title,
      issue: "missing-meta",
      articleHandle: article.handle,
      wordCount: article.wordCount,
    });
  }

  return uniqueBy(gaps, gapKey);
}
