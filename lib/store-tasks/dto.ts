import { z } from "zod";

const Text = z.string().max(500);
const ChangeFields = z.object({ title: z.string().max(500).optional(), seoTitle: z.string().max(500).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(), bodyHtml: z.string().max(50_000).optional() }).strict();
const ChangeProposed = z.object({ action: z.string().max(50).refine(action => action !== "redirect_create"), before: ChangeFields.optional(), after: ChangeFields.optional(), advisory: z.string().max(200).optional() }).strict();
const RedirectProposed = z.object({ action: z.literal("redirect_create"), before: z.object({ state: z.literal("absent") }).strict(), after: z.object({ target: Text }).strict() }).strict();
const Proposed = z.union([RedirectProposed, ChangeProposed]);
const SourceFields = { source: z.string().max(50).optional(), strategyVersionId: Text.optional(), packageSha256: z.string().max(64).optional(), ruleDomains: z.array(Text).max(10).optional(), targetType: Text.optional(), targetUrl: Text.optional(), executable: z.boolean().optional(), advisoryReason: Text.optional(), observedAt: Text.optional(), generationProvenance: Text.optional(), recommendationId: Text.optional(), mapPriority: z.string().max(40).optional(), proposedCanonicalUrl: Text.optional(), mapDecision: Text.optional(), mapEvidence: z.string().max(2_000).optional() };
const Reference = z.object({ kind: Text, id: Text }).strict();
const ListSource = z.object({ ...SourceFields, ruleIds: z.array(Text).max(25).optional(), sourceReferences: z.array(Reference).max(25).optional() }).strict();
const DetailSource = z.object({ ...SourceFields, ruleIds: z.array(Text).max(100).optional(), sourceReferences: z.array(Reference).max(100).optional(), links: z.array(z.object({ toUrl: Text, anchor: Text }).strict()).max(100).optional() }).strict();
const Base = z.object({ id: Text, taskType: Text, targetType: Text, targetUrl: Text.nullable(), title: Text, description: z.string().max(2_000), priority: Text, status: Text, completedAt: z.date().nullable(), completionNote: z.string().max(2_000).nullable() }).strict();
export const StoreTaskListDtoSchema = Base.extend({ createdAt: z.date(), targetId: Text.nullable(), sourceData: ListSource, proposedState: Proposed }).strict().superRefine((v, ctx) => { if (JSON.stringify(v).length > 12_000) ctx.addIssue({ code: "custom", message: "List DTO too large" }); });
export const StoreTaskDetailDtoSchema = z.object({ id: Text, targetUrl: Text.nullable(), status: Text, completionNote: z.string().max(2_000).nullable(), sourceData: DetailSource, proposedState: Proposed }).strict().superRefine((v, ctx) => { if (JSON.stringify(v).length > 110_000) ctx.addIssue({ code: "custom", message: "Detail DTO too large" }); });

function sourceProjection(value: unknown, detail = false) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = ["source", "strategyVersionId", "packageSha256", "ruleIds", "ruleDomains", "targetType", "targetUrl", "executable", "advisoryReason", "observedAt", "generationProvenance", "sourceReferences", "recommendationId", "mapPriority", "proposedCanonicalUrl", "mapDecision", "mapEvidence", ...(detail ? ["links"] : [])];
  return (detail ? DetailSource : ListSource).parse(Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]])));
}

function previewFields(value: unknown) {
  const parsed = ChangeFields.safeParse(value); if (!parsed.success) return undefined;
  return Object.fromEntries(Object.entries(parsed.data).map(([key, item]) => [key, typeof item === "string" && item.length > 400 ? `${item.slice(0, 400)}…` : item]));
}
type TaskRow = Record<string, unknown> & { id: string; targetUrl: string | null; status: string; completionNote: string | null; sourceData: unknown; proposedState: unknown };
export function toStoreTaskListDto(row: TaskRow) {
  const source = sourceProjection(row.sourceData); const proposed = Proposed.parse(row.proposedState);
  if (proposed.action === "redirect_create") return StoreTaskListDtoSchema.parse({ ...row, sourceData: source, proposedState: proposed });
  return StoreTaskListDtoSchema.parse({ ...row, sourceData: source, proposedState: { ...proposed, before: previewFields(proposed.before), after: previewFields(proposed.after) } });
}
export function toStoreTaskDetailDto(row: TaskRow) { return StoreTaskDetailDtoSchema.parse({ id: row.id, targetUrl: row.targetUrl, status: row.status, completionNote: row.completionNote, sourceData: sourceProjection(row.sourceData, true), proposedState: Proposed.parse(row.proposedState) }); }
