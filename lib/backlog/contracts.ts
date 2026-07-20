import { z } from "zod";

export const BacklogStatusSchema = z.enum(["open", "completed"]);

export const BacklogListQuerySchema = z.object({
  status: BacklogStatusSchema.or(z.literal("all")).default("open"),
}).strict();

export const CreateBacklogItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5_000),
  dueAt: z.coerce.date(),
}).strict();

const EditFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5_000).optional(),
  dueAt: z.coerce.date().optional(),
}).strict().refine(
  (fields) => Object.keys(fields).length > 0,
  "At least one edit field is required.",
);

export const BacklogItemMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    expectedVersion: z.number().int().min(1),
    fields: EditFieldsSchema,
  }).strict(),
  z.object({
    action: z.literal("complete"),
    expectedVersion: z.number().int().min(1),
  }).strict(),
  z.object({
    action: z.literal("reopen"),
    expectedVersion: z.number().int().min(1),
  }).strict(),
]);

export const DeleteBacklogItemSchema = z.object({
  expectedVersion: z.number().int().min(1),
}).strict();

export type BacklogListQuery = z.infer<typeof BacklogListQuerySchema>;
export type CreateBacklogItem = z.infer<typeof CreateBacklogItemSchema>;
export type BacklogItemMutation = z.infer<typeof BacklogItemMutationSchema>;
