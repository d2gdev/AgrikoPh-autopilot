import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  decodeQueueCursor,
  encodeQueueCursor,
  orderQueueRows,
  pageQueueRows,
  parseQueueQuery,
} from "@/lib/content-pilot/queue-query";

describe("content proposal queue query", () => {
  it("uses bounded defaults", () => {
    expect(parseQueueQuery("http://test.local")).toMatchObject({ limit: 50 });
  });

  it("rejects structurally invalid cursors before Prisma", () => {
    const valid = Buffer.from(JSON.stringify({ sort: "priority", id: "proposal-1" })).toString("base64url");
    expect(decodeQueueCursor(valid)).toEqual({ sort: "priority", id: "proposal-1" });

    for (const value of [
      { id: "proposal-1" },
      { sort: "unsafe", id: "proposal-1" },
      { sort: "priority", id: "" },
    ]) {
      const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
      expect(() => decodeQueueCursor(encoded)).toThrow("Invalid cursor");
    }
  });
  it("caps oversized limits", () => {
    expect(parseQueueQuery("http://test.local?limit=999")).toMatchObject({ limit: 100 });
  });
  it("accepts only known filters and sort keys", () => {
    expect(parseQueueQuery("http://test.local?status=approved&type=seo-fix&priority=P1&stage=ready&sort=createdAt&q=meta")).toMatchObject({
      status: "approved", type: "seo-fix", priority: "P1", stage: "ready", sort: "createdAt", q: "meta",
    });
    expect(() => parseQueueQuery("http://test.local?sort=unsafe")).toThrow("Invalid queue query");
  });

  it("orders the complete result set by the selected queue sort", () => {
    const rows = [
      { id: "medium", priority: "Medium", impact: "Medium", createdAt: new Date("2026-07-01T00:00:00Z") },
      { id: "p2-high", priority: "P2", impact: "High", createdAt: new Date("2026-07-03T00:00:00Z") },
      { id: "p1-low", priority: "P1", impact: "Low", createdAt: new Date("2026-07-02T00:00:00Z") },
    ];

    expect(orderQueueRows(rows, "priority").map((row) => row.id)).toEqual(["p1-low", "p2-high", "medium"]);
    expect(orderQueueRows(rows, "createdAt").map((row) => row.id)).toEqual(["p2-high", "p1-low", "medium"]);
    expect(orderQueueRows(rows, "impact").map((row) => row.id)).toEqual(["p2-high", "medium", "p1-low"]);
  });

  it("continues a sorted page from an opaque row cursor", () => {
    const rows = [
      { id: "one", priority: "P1", impact: "High", createdAt: new Date("2026-07-03T00:00:00Z") },
      { id: "two", priority: "P2", impact: "Medium", createdAt: new Date("2026-07-02T00:00:00Z") },
      { id: "three", priority: "P3", impact: "Low", createdAt: new Date("2026-07-01T00:00:00Z") },
    ];
    const first = pageQueueRows(rows, "priority", 2);

    expect(first.rows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(decodeQueueCursor(first.nextCursor!)).toEqual({ sort: "priority", id: "two" });
    expect(pageQueueRows(rows, "priority", 2, first.nextCursor).rows.map((row) => row.id)).toEqual(["three"]);
    expect(encodeQueueCursor({ sort: "impact", id: "one" })).toBeTypeOf("string");
  });

  it("normalizes legacy medium priorities through a bounded data migration", () => {
    const migration = "prisma/migrations/20260718143000_normalize_content_proposal_priority/migration.sql";

    expect(existsSync(migration)).toBe(true);
    expect(readFileSync(migration, "utf8")).toContain(`SET "priority" = 'P2'`);
  });
});
