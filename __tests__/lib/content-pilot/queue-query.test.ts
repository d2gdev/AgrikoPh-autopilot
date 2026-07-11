import { describe, expect, it } from "vitest";
import { decodeQueueCursor, parseQueueQuery } from "@/lib/content-pilot/queue-query";

describe("content proposal queue query", () => {
  it("uses bounded defaults", () => {
    expect(parseQueueQuery("http://test.local")).toMatchObject({ limit: 50 });
  });

  it("rejects structurally invalid cursors before Prisma", () => {
    const valid = Buffer.from(JSON.stringify({ priority: "P1", createdAt: "2026-07-11T00:00:00.000Z", id: "proposal-1" })).toString("base64url");
    expect(decodeQueueCursor(valid)).toEqual({ priority: "P1", createdAt: "2026-07-11T00:00:00.000Z", id: "proposal-1" });

    for (const value of [
      { createdAt: "2026-07-11T00:00:00.000Z", id: "proposal-1" },
      { priority: "urgent", createdAt: "2026-07-11T00:00:00.000Z", id: "proposal-1" },
      { priority: "P1", createdAt: "not-a-date", id: "proposal-1" },
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
});
