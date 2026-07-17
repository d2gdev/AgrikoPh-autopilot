import { z } from "zod";

export const SEO_TASK_TYPES = [
  "canonical_transfer_review",
  "ctr_experiment_review",
  "indexation_review",
  "content_quality_review",
  "cohort_review",
  "technical_review",
  "other",
] as const;

export const SEO_TASK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const SEO_TASK_OWNER_SURFACES = ["seo", "content", "store"] as const;
export const SEO_TASK_EVIDENCE_STATUSES = ["waiting", "insufficient", "sufficient", "not_required"] as const;
export const SEO_TASK_SOURCE_TYPES = ["operator", "seo_experiment", "topical_map", "system"] as const;
export const SEO_TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export const SEO_TASK_BUCKETS = ["ready", "waiting", "scheduled", "closed"] as const;

export const SeoTaskTypeSchema = z.enum(SEO_TASK_TYPES);
export const SeoTaskPrioritySchema = z.enum(SEO_TASK_PRIORITIES);
export const SeoTaskOwnerSurfaceSchema = z.enum(SEO_TASK_OWNER_SURFACES);
export const SeoTaskEvidenceStatusSchema = z.enum(SEO_TASK_EVIDENCE_STATUSES);
export const SeoTaskSourceTypeSchema = z.enum(SEO_TASK_SOURCE_TYPES);
export const SeoTaskStatusSchema = z.enum(SEO_TASK_STATUSES);
export const SeoTaskBucketSchema = z.enum(SEO_TASK_BUCKETS);

const OptionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const JsonObject = z.record(z.unknown()).superRefine((value, context) => {
  if (JSON.stringify(value).length > 50_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "JSON value is too large." });
  }
});

const DestinationPath = z.string().trim().max(1_000).refine((value) => {
  try {
    const url = new URL(value, "https://agrikoph.com");
    return url.origin === "https://agrikoph.com"
      && ["/seo-pillar", "/content-pilot", "/store-pilot"].includes(url.pathname);
  } catch {
    return false;
  }
}, "Destination must be an allowlisted internal path.");

export const SeoTaskListQuerySchema = z.object({
  bucket: SeoTaskBucketSchema.default("ready"),
  priority: z.union([z.literal("all"), SeoTaskPrioritySchema]).default("all"),
  taskType: z.union([z.literal("all"), SeoTaskTypeSchema]).default("all"),
  q: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const CreateSeoTaskSchema = z.object({
  taskType: SeoTaskTypeSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5_000),
  targetUrl: OptionalText(2_000),
  topicalCluster: OptionalText(200),
  pageRole: OptionalText(200),
  ownerSurface: SeoTaskOwnerSurfaceSchema.default("seo"),
  destinationPath: DestinationPath.nullable().optional(),
  priority: SeoTaskPrioritySchema,
  earliestReviewAt: z.coerce.date(),
  dueAt: z.coerce.date().nullable().optional(),
  requiresEvidence: z.boolean().default(true),
  evidenceRequirement: JsonObject,
  evidenceStatus: SeoTaskEvidenceStatusSchema.default("waiting"),
  evidenceSnapshot: JsonObject.nullable().optional(),
  lastEvaluatedAt: z.coerce.date().nullable().optional(),
  sourceType: SeoTaskSourceTypeSchema,
  sourceKey: z.string().trim().min(1).max(500),
  sourceData: JsonObject,
}).strict();

const ExpectedVersion = z.number().int().min(1);

const EditFields = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5_000).optional(),
  targetUrl: OptionalText(2_000),
  topicalCluster: OptionalText(200),
  pageRole: OptionalText(200),
  ownerSurface: SeoTaskOwnerSurfaceSchema.optional(),
  destinationPath: DestinationPath.nullable().optional(),
  priority: SeoTaskPrioritySchema.optional(),
  earliestReviewAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  requiresEvidence: z.boolean().optional(),
  evidenceRequirement: JsonObject.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one edit field is required.");

export const SeoTaskMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    expectedVersion: ExpectedVersion,
    fields: EditFields,
  }).strict(),
  z.object({
    action: z.literal("update_evidence"),
    expectedVersion: ExpectedVersion,
    evidenceStatus: SeoTaskEvidenceStatusSchema,
    evidenceSnapshot: JsonObject.nullable(),
    lastEvaluatedAt: z.coerce.date().optional(),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    expectedVersion: ExpectedVersion,
    note: z.string().trim().min(1).max(5_000),
    decisionData: JsonObject.nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("cancel"),
    expectedVersion: ExpectedVersion,
    note: z.string().trim().min(1).max(5_000),
    decisionData: JsonObject.nullable().optional(),
  }).strict(),
]);

export type SeoTaskType = z.infer<typeof SeoTaskTypeSchema>;
export type SeoTaskPriority = z.infer<typeof SeoTaskPrioritySchema>;
export type SeoTaskOwnerSurface = z.infer<typeof SeoTaskOwnerSurfaceSchema>;
export type SeoTaskEvidenceStatus = z.infer<typeof SeoTaskEvidenceStatusSchema>;
export type SeoTaskSourceType = z.infer<typeof SeoTaskSourceTypeSchema>;
export type SeoTaskStatus = z.infer<typeof SeoTaskStatusSchema>;
export type SeoTaskBucket = z.infer<typeof SeoTaskBucketSchema>;
export type SeoTaskListInput = z.infer<typeof SeoTaskListQuerySchema>;
export type CreateSeoTaskInput = z.infer<typeof CreateSeoTaskSchema>;
export type SeoTaskMutation = z.infer<typeof SeoTaskMutationSchema>;
