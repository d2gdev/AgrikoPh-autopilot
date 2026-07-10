import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { publishFeedback, publishReconciliationMessage } from "@/app/(embedded)/(content-pilot)/content-pilot/components/publish-feedback";

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

  it("keeps a reconciliation-required publish outcome critical instead of treating it as success", () => {
    expect(publishReconciliationMessage({
      reconciliationRequired: true,
      error: "Shopify confirmed publication but its receipt could not be recorded.",
    })).toBe("Shopify confirmed publication but its receipt could not be recorded.");
  });

  it("keeps the queue row in its reconciliation state for HTTP 202 publish outcomes", () => {
    const queueSource = readFileSync("app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx", "utf8");

    expect(queueSource).toContain("res.status === 202");
    expect(queueSource).toContain("publishReconciliationMessage(result)");
  });
});
