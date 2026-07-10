import { describe, expect, it } from "vitest";
import { publishFeedback } from "@/app/(embedded)/(content-pilot)/content-pilot/components/publish-feedback";

describe("Content Pilot publish feedback", () => {
  it("uses the exact warning feedback for a Shopify publish that completed with warnings", () => {
    expect(publishFeedback("Black Rice Guide", {
      kind: "published_with_warnings",
      publishWarning: "Local re-index is delayed.",
    })).toEqual({
      tone: "warning",
      message: "Published with warning: \"Black Rice Guide\" was published to Shopify. Local re-index is delayed.",
    });
  });
});
