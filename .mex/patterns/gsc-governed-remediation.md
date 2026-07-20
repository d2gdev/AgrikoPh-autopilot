---
name: gsc-governed-remediation
description: Auditing and remediating Google Search Console findings across Autopilot, Shopify, and Google without bypassing approval or evidence gates.
triggers:
  - "search console audit"
  - "GSC remediation"
  - "URL inspection"
  - "request indexing"
  - "GSC sitemap"
edges:
  - target: "../context/data-pipeline.md"
    condition: when changing Search Analytics ingestion, snapshots, or totals
  - target: "topical-map-strategy-package.md"
    condition: when a GSC finding requires governed redirects or SEO tasks
  - target: "deploy.md"
    condition: when deploying Autopilot changes
last_updated: 2026-07-20T08:52:00+08:00
---

# Governed GSC Remediation

## Context

Use both the Search Console API and authenticated UI. The API is authoritative
for Search Analytics, sitemap read-back, and URL Inspection; Request Indexing
and ownership-token removal remain UI operations. Shopify writes must still
flow through approved Recommendations and the live executor.

## Steps

1. Record an approval-ready issue list before any mutation. Inspect every
   displayed Search Console finding, including Settings subreports such as
   robots.txt.
2. Compare Search Analytics only across exact inclusive, non-overlapping
   windows. Use a dimensionless response for property totals and dimensioned
   rows only for query/page evidence.
3. For theme findings, read the live Admin asset first, lock the observed hash,
   queue a narrow Recommendation, approve it in the authenticated UI, and
   execute through the guarded executor. Retain before/after hashes and rollback
   bytes.
4. For redirects, amend the immutable topical-map package, validate/import/
   activate it, synchronize Store Tasks, approve exact Recommendations, then
   verify both Shopify receipts and public 301→200 behavior.
5. Submit sitemaps through the API and read them back. Use Request Indexing only
   for approved priority URLs until Google stops the session on quota.
6. Re-inspect URLs after requests. Report `Submitted and indexed` only when URL
   Inspection says exactly that.
7. Reconcile the authenticated Autopilot UI, its persisted records, Google API
   responses, rendered storefront, PM2/build commit, and public health before
   reporting outcomes.

## Gotchas

- Google Search Analytics dates are inclusive; subtracting 28 days creates a
  29-day window.
- Query/page totals omit anonymized traffic and must not power property cards.
- Search Console can show cached crawl evidence after the live source changes.
  A cache-bypass storefront response proves source deployment, not canonical
  cache propagation or Google reprocessing.
- Shopify redirects may return a relative `Location`; compare the resolved path,
  not only an absolute string.
- Sitemap submission success does not mean the submitted URLs are indexed.
- URL Inspection API reads and Request Indexing UI quota are separate.
- Merchant verification alone is insufficient proof that a DNS ownership token
  is unused by Google Workspace.
- A local dirty theme file may overlap a newly discovered finding. Preserve it
  and request approval rather than overwriting it.
- Do not assume Shopify Liquid objects render identically in `robots.txt`.
  On this store both `{{ shop.url }}` and `{{ group.sitemap }}` produced a
  relative sitemap directive. Capture the published asset hash, use the literal
  canonical absolute URL in the exact approved transform, and pin the source
  repository with a regression test.
- Search Console's Request recrawl action can finish its request task without
  immediately replacing the report snapshot. Record the request task ID and
  keep Google confirmation open until the row's checked time advances and its
  critical issue count changes.

## Verify

- [ ] Exact current/prior dates, direct API totals, persisted snapshot, and UI
      cards agree.
- [ ] Every live Shopify mutation has approved Recommendation and execution
      receipts.
- [ ] Redirect sources return exact 301 destinations and targets return 200.
- [ ] Root sitemap API read-back is present, non-pending, and error-free.
- [ ] Each indexing request is classified as accepted, quota-blocked, or later
      indexed.
- [ ] Authenticated Search Console and Autopilot UI findings are individually
      reconciled.
- [ ] Production commit, build ID, PM2 status, and public health are recorded.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` Current Project State.
- [ ] Update `context/data-pipeline.md` if the GSC ingestion contract changed.
- [ ] Record new unapproved findings separately from the approved remediation.
