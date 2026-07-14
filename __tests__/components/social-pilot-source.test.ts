import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Social Pilot analysis provenance", () => {
  it("labels transient AI analysis with its loaded-post provenance and generation time", () => {
    const source = readFileSync("app/(embedded)/(social-pilot)/social-pilot/page.tsx", "utf8");

    expect(source).toContain("setAnalysisGeneratedAt(new Date().toISOString())");
    expect(source).toContain("Temporary analysis of the currently loaded posts; it is not persisted.");
    expect(source).toContain("Generated {timeAgo(analysisGeneratedAt)} from {posts.length} loaded posts.");
  });

  it("turns an expired Meta credential into a recoverable operator state", () => {
    const source = readFileSync("app/(embedded)/(social-pilot)/social-pilot/page.tsx", "utf8");

    expect(source).toContain("META_TOKEN_EXPIRED");
    expect(source).toContain("Meta access token expired");
    expect(source).toContain("Update META_ACCESS_TOKEN in Settings");
  });
});
