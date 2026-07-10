import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const tablePath = "app/(embedded)/components/ResponsiveDataTable.tsx";
const tableCssPath = "app/(embedded)/components/ResponsiveDataTable.module.css";
const pagePath = "app/(embedded)/(seo-pillar)/seo-pillar/page.tsx";
const navigationPath = "app/(embedded)/(seo-pillar)/seo-pillar/components/SeoPilotNavigation.tsx";
const responsiveCssPath = "app/(embedded)/(seo-pillar)/seo-pillar/components/seo-pilot-responsive.module.css";
const panelPaths = [
  "OverviewPanel.tsx",
  "OpportunitiesPanel.tsx",
  "ContentGapsPanel.tsx",
  "OnPageHealthPanel.tsx",
  "KeywordsPanel.tsx",
  "PillarClustersPanel.tsx",
  "PageHealthPanel.tsx",
  "OpportunityClustersPanel.tsx",
  "StrategyPanel.tsx",
].map((file) => `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/${file}`);

describe("SEO Pilot responsive layout contract", () => {
  it("uses a contained semantic table only at genuinely wide layouts", () => {
    const source = read(tablePath);
    const css = read(tableCssPath);

    expect(source).toContain('import styles from "./ResponsiveDataTable.module.css"');
    expect(source).toContain("xlUp");
    expect(source).toContain("<table");
    expect(source).not.toMatch(/\bDataTable\b/);
    expect(css).toMatch(/table-layout:\s*fixed/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toContain("min-width: 0");
    expect(css).toContain("max-width: 100%");
    expect(css).toContain(":global(.Polaris-Badge)");
    expect(css).toMatch(/white-space:\s*normal/);
  });

  it("uses non-scrolling compact navigation", () => {
    const page = read(pagePath);
    const navigation = read(navigationPath);

    expect(page).toContain("<SeoPilotNavigation");
    expect(page).not.toContain("<Tabs");
    expect(navigation).toContain("xlUp");
    expect(navigation).toContain('label="SEO Pilot view"');
    expect(navigation).toContain("<Select");
  });

  it("keeps every SEO Pilot panel on the shared responsive presentation", () => {
    for (const path of panelPaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/<DataTable\b/);
      expect(source, path).not.toContain("overflowX");
      expect(source, path).not.toMatch(/minWidth:\s*\d/);
      expect(source, path).not.toContain("wrap={false}");
    }
  });

  it("provides shrinkable wrappers for controls, actions, and long content", () => {
    const css = read(responsiveCssPath);
    expect(css).toContain(".control");
    expect(css).toContain(".actionContent");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("max-width: 100%");
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/align-items:\s*end/);
  });

  it("lets fixed-aspect sparklines shrink inside narrow cards", () => {
    const source = read("app/(embedded)/(seo-pillar)/seo-pillar/components/widgets.tsx");
    expect(source).toContain('maxWidth: "100%"');
  });

  it("discloses raw GSC fallback provenance beside its freshness timestamp", () => {
    const page = read(pagePath);
    const overview = read("app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx");

    expect(page).toContain("gscFreshness={data?.gscFreshness}");
    expect(overview).toContain('gscFreshness?.selectedSource === "rawSnapshot"');
    expect(overview).toContain("fallback snapshot");
  });
});
