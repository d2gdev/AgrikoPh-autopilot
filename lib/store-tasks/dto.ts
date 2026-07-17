import { z } from "zod";

const Text = z.string().max(500);
const ChangeFields = z.object({ title: z.string().max(500).optional(), seoTitle: z.string().max(500).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(), bodyHtml: z.string().max(50_000).optional() }).strict();
const ChangeProposed = z.object({ action: z.string().max(50).refine(action => !["redirect_create", "redirect_update", "redirect_delete"].includes(action)), before: ChangeFields.optional(), after: ChangeFields.optional(), advisory: z.string().max(200).optional() }).strict();
const RedirectProposed = z.object({ action: z.literal("redirect_create"), before: z.object({ state: z.literal("absent") }).strict(), after: z.object({ target: Text }).strict() }).strict();
const RedirectUpdateProposed = z.object({ action: z.literal("redirect_update"), before: z.object({ id: Text, target: Text }).strict(), after: z.object({ target: Text }).strict() }).strict();
const RedirectDeleteProposed = z.object({ action: z.literal("redirect_delete"), before: z.object({ id: Text, target: Text }).strict(), after: z.object({ state: z.literal("absent") }).strict() }).strict();
const Proposed = z.union([RedirectProposed, RedirectUpdateProposed, RedirectDeleteProposed, ChangeProposed]);
const SourceFields = { source: z.string().max(50).optional(), strategyVersionId: Text.optional(), packageSha256: z.string().max(64).optional(), ruleDomains: z.array(Text).max(10).optional(), targetType: Text.optional(), targetUrl: Text.optional(), action: z.string().max(50).optional(), executable: z.boolean().optional(), advisoryReason: Text.optional(), resolutionStatus: z.enum(["resolved", "manual_gate", "activation_blocking"]).optional(), observedAt: Text.optional(), observationProvenance: Text.optional(), observedStateHash: z.string().max(64).optional(), generationProvenance: Text.optional(), recommendationId: Text.optional(), ruleCount: z.number().int().min(0).max(10_000).optional(), mapPriority: z.string().max(40).optional(), proposedCanonicalUrl: Text.optional(), mapDecision: Text.optional(), mapEvidence: z.string().max(2_000).optional(), mapPublishingState: z.string().max(100).optional(), mapProposedRedirectTarget: Text.optional(), observedRedirectTarget: Text.optional(), observedRedirectId: Text.optional(), redirectId: Text.optional(), redirectTarget: Text.optional(), liveOwnerUrl: Text.optional() };
const Reference = z.object({ kind: Text, id: Text }).strict();
const ListSource = z.object({ ...SourceFields, ruleIds: z.array(Text).max(25).optional(), sourceReferences: z.array(Reference).max(25).optional() }).strict();
const DetailSource = z.object({ ...SourceFields, ruleIds: z.array(Text).max(100).optional(), sourceReferences: z.array(Reference).max(100).optional(), links: z.array(z.object({ toUrl: Text, anchor: Text, currentBodyState: Text.optional(), linkPurpose: Text.optional(), requiredAction: Text.optional(), verification: Text.optional(), priority: z.string().max(40).optional(), resolutionStatus: z.enum(["resolved", "manual_gate", "activation_blocking"]).optional() }).strict()).max(100).optional(), replacements: z.array(z.object({ fromUrl: Text, toUrl: Text }).strict()).max(100).optional() }).strict();
const Base = z.object({ id: Text, taskType: Text, targetType: Text, targetUrl: Text.nullable(), title: Text, description: z.string().max(2_000), priority: Text, status: Text, completedAt: z.date().nullable(), completionNote: z.string().max(2_000).nullable() }).strict();
export const StoreTaskListDtoSchema = Base.extend({ createdAt: z.date(), targetId: Text.nullable(), sourceData: ListSource, proposedState: Proposed }).strict().superRefine((v, ctx) => { if (JSON.stringify(v).length > 12_000) ctx.addIssue({ code: "custom", message: "List DTO too large" }); });
export const StoreTaskDetailDtoSchema = z.object({ id: Text, targetUrl: Text.nullable(), status: Text, completionNote: z.string().max(2_000).nullable(), sourceData: DetailSource, proposedState: Proposed }).strict().superRefine((v, ctx) => { if (JSON.stringify(v).length > 110_000) ctx.addIssue({ code: "custom", message: "Detail DTO too large" }); });

function sourceProjection(value: unknown, detail = false) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = ["source", "strategyVersionId", "packageSha256", "ruleIds", "ruleDomains", "targetType", "targetUrl", "action", "executable", "advisoryReason", "resolutionStatus", "observedAt", "observationProvenance", "observedStateHash", "generationProvenance", "sourceReferences", "recommendationId", "mapPriority", "proposedCanonicalUrl", "mapDecision", "mapEvidence", "mapPublishingState", "mapProposedRedirectTarget", "observedRedirectTarget", "observedRedirectId", "redirectId", "redirectTarget", "liveOwnerUrl", ...(detail ? ["links", "replacements"] : [])];
  const projected = Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]]));
  if (!detail && Array.isArray(raw.ruleIds)) {
    projected.ruleIds = raw.ruleIds.slice(0, 25);
    projected.ruleCount = raw.ruleIds.length;
  }
  return (detail ? DetailSource : ListSource).parse(projected);
}

function previewFields(value: unknown) {
  const parsed = ChangeFields.safeParse(value); if (!parsed.success) return undefined;
  return Object.fromEntries(Object.entries(parsed.data).map(([key, item]) => [key, typeof item === "string" && item.length > 400 ? `${item.slice(0, 400)}…` : item]));
}
type TaskRow = Record<string, unknown> & { id: string; targetUrl: string | null; status: string; completionNote: string | null; sourceData: unknown; proposedState: unknown };
export function toStoreTaskListDto(row: TaskRow) {
  const source = sourceProjection(row.sourceData); const proposed = Proposed.parse(row.proposedState);
  if (proposed.action === "redirect_create" || proposed.action === "redirect_update" || proposed.action === "redirect_delete") return StoreTaskListDtoSchema.parse({ ...row, sourceData: source, proposedState: proposed });
  if (proposed.action === "internal_link_replace") return StoreTaskListDtoSchema.parse({ ...row, sourceData: source, proposedState: { action: proposed.action } });
  return StoreTaskListDtoSchema.parse({ ...row, sourceData: source, proposedState: { ...proposed, before: previewFields(proposed.before), after: previewFields(proposed.after) } });
}
export function toStoreTaskDetailDto(row: TaskRow) { return StoreTaskDetailDtoSchema.parse({ id: row.id, targetUrl: row.targetUrl, status: row.status, completionNote: row.completionNote, sourceData: sourceProjection(row.sourceData, true), proposedState: Proposed.parse(row.proposedState) }); }
