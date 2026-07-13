import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppProvider } from "@shopify/polaris";
import { MapTaskDetails, type StoreTaskView } from "@/app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails";
import { ApplyMapTaskModal } from "@/app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal";

const executable: StoreTaskView = {
  id: "task-map",
  targetUrl: "/products/black-rice",
  sourceData: {
    source: "topical-map", executable: true, strategyVersionId: "strategy-v3",
    packageSha256: "a".repeat(64), ruleIds: ["product:black-rice", "seo:title"],
    ruleDomains: ["content_decisions"], observedAt: "2026-07-13T04:00:00.000Z",
  },
  proposedState: {
    action: "seo_update",
    before: { seoTitle: "Black Rice" , seoDescription: "Old description" },
    after: { seoTitle: "Organic Black Rice", seoDescription: "New description" },
  },
};

function render(component: React.ReactNode) {
  return renderToStaticMarkup(<AppProvider i18n={{}}>{component}</AppProvider>);
}

describe("topical-map Store Task components", () => {
  it("shows capability, identity, rules, evidence, target, and exact changed fields without raw JSON", () => {
    const html = render(<MapTaskDetails task={executable} />);
    expect(html).toContain("Executable");
    expect(html).toContain("strategy-v3");
    expect(html).toContain("Package aaaaaaaaaaaa");
    expect(html).toContain("product:black-rice");
    expect(html).toContain("Jul 13, 2026");
    expect(html).toContain("/products/black-rice");
    expect(html).toContain("SEO title");
    expect(html).toContain("Black Rice");
    expect(html).toContain("Organic Black Rice");
    expect(html).not.toContain("{&quot;");
  });

  it("shows advisory capability and its operator-readable reason", () => {
    const html = render(<MapTaskDetails task={{ ...executable, sourceData: {
      source: "topical-map", executable: false, strategyVersionId: "strategy-v3",
      packageSha256: "a".repeat(64), ruleIds: ["canonical:a"], ruleDomains: ["canonicalization"],
      advisoryReason: "canonicalization_execution_prohibited",
    }, proposedState: { action: "advisory", advisory: "canonicalization_execution_prohibited" } }} />);
    expect(html).toContain("Advisory only");
    expect(html).toContain("Canonicalization changes cannot be executed from Store Pilot");
  });

  it("confirmation modal names the target and changed fields and delegates confirmation", () => {
    const confirmed = vi.fn();
    const modal = ApplyMapTaskModal({ open: true, task: executable, loading: false, onClose: () => {}, onConfirm: confirmed });
    expect(modal.props.title).toBe("Apply topical-map change");
    expect(modal.props.primaryAction.onAction).toBe(confirmed);
    const html = render(<MapTaskDetails task={executable} compact />);
    expect(html).toContain("/products/black-rice");
    expect(html).toContain("SEO title");
    expect(confirmed).not.toHaveBeenCalled();
  });
});
