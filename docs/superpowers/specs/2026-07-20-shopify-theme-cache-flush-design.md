# Shopify Theme Page-Cache Flush Design

## Goal

Make the already-approved Git theme source visible on the rendered storefront
without rolling back source improvements or requiring Cloudflare authority.
Success requires the affected article to render exactly one H1 from
`article-types-of-organic-rice.liquid`, while the homepage, robots sitemap, and
production application remain healthy.

## Observed Failure

Shopify Admin read-back matches theme commit
`8ff4626583861e70a542a2b51f67989429d52ea3` for the complete four-file
dependency set:

- `sections/main-article.liquid`
- `sections/main-home.liquid`
- `templates/robots.txt.liquid`
- `snippets/article-types-of-organic-rice.liquid`

The public response nevertheless renders the prior article implementation. Its
headers identify main theme `160524763362`, `CF-Cache-Status: DYNAMIC`, and a
Shopify `page_cache` ETag. The remaining mismatch is therefore inside Shopify's
rendered page cache, not Git, the Admin asset store, or Cloudflare.

## Considered Approaches

1. Wait for Shopify's page cache to expire. This has the smallest mutation
   surface but no deterministic completion time, and it leaves the production
   regression open.
2. Change or re-push the parent Liquid section. A real parent-section change
   was already applied and did not invalidate the rendered page cache, so
   another source mutation would add drift without addressing the proven
   boundary.
3. Duplicate the exact current main theme, verify the duplicate, and publish
   it. Existing store history and the theme repository identify this as the
   Shopify-side page-cache flush. It is deterministic and leaves the former
   main theme available as rollback.

Approach 3 is approved.

## Governed Action

Add the Shopify recommendation action
`flush_shopify_theme_page_cache`. It is not a generic theme publisher.

The approved payload contains:

- the exact current main-theme ID;
- the Git source commit;
- the four fixed asset keys and their approved SHA-256 hashes;
- a unique, bounded duplicate-theme name.

The payload cannot accept caller-selected asset keys, an arbitrary destination
theme, or arbitrary theme content.

## Execution Flow

1. Require recommendation status `executing` and
   `EXECUTE_APPROVED_LIVE_ENABLED=true`.
2. Re-discover exactly one main theme and require it to be either:
   - the approved source theme; or
   - the already-published verified duplicate from an interrupted/idempotent
     execution.
3. Re-read the four fixed source assets and require every hash to match the
   approved payload.
4. Duplicate the source with Shopify `themeDuplicate`.
5. Poll the duplicate until `processing=false`.
6. Read the four assets from the duplicate and require every hash to match
   before publishing.
7. Publish only that verified duplicate with `themePublish`.
8. Re-discover exactly one main theme, require it to be the duplicate, and
   verify the four hashes again.
9. Store a bounded receipt containing the old and new theme IDs, source commit,
   hashes, duplicate name, and verification time. Never store theme bytes in
   the receipt.

The previous main theme remains unpublished and available for a separately
approved rollback. The action never deletes a theme.

## Interruption and Error Handling

- A duplicate or processing failure occurs before publish and leaves the
  approved source theme live.
- A hash mismatch on the duplicate fails closed before publish.
- The deterministic duplicate name and audit evidence allow an interrupted
  execution to reuse or re-observe one exact duplicate instead of creating
  another.
- If the verified duplicate is already main, execution returns an idempotent
  receipt.
- Multiple matching duplicates, a changed source main theme, changed source
  hashes, or a changed post-publish main theme fail closed and require
  reconciliation.
- No automatic rollback is attempted after publish; the former theme is
  retained so rollback remains an explicit governed operator decision.

## Verification

Automated tests must cover:

- exact payload construction without a Shopify mutation;
- stale source-theme and source-hash rejection;
- duplicate processing polling;
- pre-publish duplicate hash verification;
- publish and post-publish main-theme verification;
- mismatch failure before publish;
- idempotent already-published recovery;
- executor routing and audit receipt persistence.

Production acceptance requires:

- approved Recommendation and execution JobRun receipts;
- new main-theme ID and four exact Admin hashes;
- affected article: HTTP 200, exactly one H1, one `ag-tor-story`, one
  `ag-tor-title`, and no legacy `<article id="top">`;
- homepage: HTTP 200 and exactly one H1;
- robots: one absolute sitemap directive and no relative sitemap directive;
- matching local, origin, and production Autopilot commits;
- active build ID, online PM2 process with no unstable restarts, and public
  health `ok`.

