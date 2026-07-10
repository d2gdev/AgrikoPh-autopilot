import { describe, expect, it } from "vitest";
import { parseQueueQuery } from "@/lib/content-pilot/queue-query";

describe("content proposal queue query", () => {
  it("uses bounded defaults", () => {
    expect(parseQueueQuery("http://test.local")).toMatchObject({ limit: 100 });
  });
  it("caps oversized limits", () => {
    expect(parseQueueQuery("http://test.local?limit=999")).toMatchObject({ limit: 200 });
  });
});
