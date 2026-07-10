import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("content proposal operation-state migration", () => {
  it("adds nullable lifecycle fields and index without updating existing rows", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "prisma/migrations/20260710200000_add_content_proposal_operation_state/migration.sql"),
      "utf8",
    );

    for (const column of [
      "draftGenerationToken",
      "draftGenerationStartedAt",
      "publishOperationId",
      "publishStartedAt",
      "publishFinalizedAt",
      "publishWarning",
    ]) {
      expect(sql).toContain(`ADD COLUMN "${column}"`);
    }

    expect(sql).toContain("CREATE UNIQUE INDEX \"ContentProposal_publishOperationId_key\"");
    expect(sql).not.toMatch(/UPDATE\s+\"ContentProposal\"/i);
  });
});
