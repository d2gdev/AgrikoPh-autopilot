import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("content proposal dedupe key migration", () => {
  it("backfills canonical keys before enforcing their uniqueness", async () => {
    const sql = await readFile(resolve(process.cwd(), "prisma/migrations/20260710160000_add_content_proposal_dedupe_key/migration.sql"), "utf8");

    expect(sql).toContain('ADD COLUMN "dedupeKey" TEXT');
    expect(sql).toContain('DROP INDEX IF EXISTS "ContentProposal_active_action_dedupe_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "ContentProposal_dedupeKey_key"');
    expect(sql).toContain('ALTER COLUMN "dedupeKey" SET NOT NULL');
    expect(sql).toContain(":history:");
  });
});
