import { describe, expect, it } from "vitest";
import { parseQueueQuery } from "@/lib/content-pilot/queue-query";

describe("content proposal queue query", () => {
  it("uses bounded defaults", () => {
    expect(parseQueueQuery("http://test.local")).toMatchObject({ limit: 50 });
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
