# Auto Pilot Growth Brief Use Case

## Summary

Build the next useful capability as a **native Auto Pilot Shopify embedded app page**, not in the storefront theme and not primarily inside the Odysseus iframe.

The use case: **Growth Brief** — one operator page that tells Sean what to do next across SEO, content, competitor intelligence, product images, and Meta ads.

Auto Pilot already has the pieces: SEO data, Content Pilot, Market Intelligence, Store Tasks, image tooling, ad recommendations, jobs, audit logs, and Shopify Admin access. The value is not another subsystem. The value is one prioritized operating view.

## Key Changes

- Add a native Polaris page in Auto Pilot:
  - Recommended route: `/growth-brief`
  - Navigation label: `Growth Brief`
  - Place it near `Insights Pilot` or make it the first operational summary page.

- Add one read-only API:
  - Recommended route: `/api/growth-brief`
  - It should aggregate existing data only.
  - No new database schema for v1.
  - No AI call required for v1 unless Odysseus summary text is later added.

- Growth Brief should show five sections:
  - **SEO:** CTR gaps, declining pages, missing meta/schema, stale pages.
  - **Content:** article refreshes, topic-cluster gaps, internal-link opportunities, draft proposals.
  - **Competitors:** competitor ads, price movement, shopping visibility, keyword gaps.
  - **Images:** missing alt text, product image issues, generated alt suggestions waiting for review.
  - **Meta Ads:** pending recommendations, creative fatigue, execution queue state.

- The page should end with:
  - `Needs Attention`
  - `Ready to Approve`
  - `Low Risk / Quick Wins`
  - `No Immediate Action` when clean.

- Use existing objects first:
  - `Opportunity`
  - `StoreTask`
  - `ContentProposal`
  - `Recommendation`
  - `MarketInsight`
  - `ArticleRecord`
  - `InternalLinkEdge`
  - image data from `/api/images`
  - ad data/recommendations from existing Ad Pilot APIs

- Odysseus role:
  - Odysseus is the reasoning/drafting workspace.
  - The native Auto Pilot page is the control surface.
  - V1 can link out to `/odysseus` for deeper drafting, but should not depend on the iframe to render the main brief.

- Shopify theme role:
  - Theme is only the execution target after approval.
  - Do not put strategy UI or competitor analysis in the storefront/theme.

- Knowledge base role:
  - Do not make the knowledge base the operational dashboard.
  - Later, add `auto-pilot` as a reviewed code-system if needed.
  - For now, the knowledge base can remain out of the Growth Brief execution path.

## Test Plan

- Run Auto Pilot typecheck/tests for touched files.
- Verify `/growth-brief` loads inside the embedded Shopify app layout with Polaris navigation.
- Verify `/api/growth-brief` works with existing App Bridge auth.
- Verify the page shows:
  - current SEO opportunities
  - content proposals/tasks
  - competitor insights
  - image alt-text status
  - ad recommendations
- Verify empty states are useful:
  - no SEO issues
  - no competitor insights
  - no pending recommendations
  - no image issues
- Verify no external writes happen from the summary page.
- Verify no `.env`, credentials, `.claude/`, or `node_modules/` are staged or committed.

## Assumptions

- Primary surface: **Native Auto Pilot Shopify plugin page**.
- Odysseus remains internal tooling/workspace, not the main operator UI for this feature.
- V1 should maximize visible product value with existing data, not add schemas or automation.
- No storefront/theme changes are needed for the first version.
- If secret-looking files exist in `shopify-theme/scripts`, they must be excluded/redacted before any future ingestion or export.
