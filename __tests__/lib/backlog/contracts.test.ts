import { describe, expect, it } from "vitest";
import {
  BacklogItemMutationSchema,
  CreateBacklogItemSchema,
} from "@/lib/backlog/contracts";

describe("backlog contracts", () => {
  it("requires a due date when creating an item", () => {
    expect(CreateBacklogItemSchema.safeParse({
      title: "Recheck Shopify cache",
      description: "Check the canonical article response.",
    }).success).toBe(false);

    expect(CreateBacklogItemSchema.parse({
      title: "Recheck Shopify cache",
      description: "Check the canonical article response.",
      dueAt: "2026-07-22T15:59:59.999Z",
    })).toMatchObject({
      title: "Recheck Shopify cache",
      dueAt: new Date("2026-07-22T15:59:59.999Z"),
    });
  });

  it("supports bounded edit, completion, and reopening actions", () => {
    expect(BacklogItemMutationSchema.parse({
      action: "edit",
      expectedVersion: 1,
      fields: { dueAt: "2026-07-23T15:59:59.999Z" },
    })).toMatchObject({ action: "edit", expectedVersion: 1 });

    expect(BacklogItemMutationSchema.safeParse({
      action: "edit",
      expectedVersion: 1,
      fields: {},
    }).success).toBe(false);
    expect(BacklogItemMutationSchema.parse({
      action: "complete",
      expectedVersion: 2,
    })).toEqual({ action: "complete", expectedVersion: 2 });
    expect(BacklogItemMutationSchema.parse({
      action: "reopen",
      expectedVersion: 3,
    })).toEqual({ action: "reopen", expectedVersion: 3 });
  });
});
