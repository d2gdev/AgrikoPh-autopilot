# Finish P0 Legacy-Link Cleanup Implementation Plan

> **Execution:** Use `superpowers:executing-plans` inline. `sol medium` is the sole orchestrator. Do not use subagents or additional model reviews.

**Goal:** Finish the already-scoped legacy-link cleanup, deploy it once, verify it once, and close SEO task `cmrpedh9l0002s6sbjp34ywyq`.

**Approach:** Preserve the six redirect repairs already live. Deploy the nine prepared theme href corrections and process eight exact Shopify article-body href replacements through the existing approved Store Task executor. No Autopilot application code changes are required.

## Severe Constraints

- Touch only the files, URLs, and records explicitly named below.
- Do not redesign, rewrite copy, change anchors, titles, metadata, schema, navigation structure, CSS, JavaScript behavior, products, publication state, redirects, canonicals, or indexation.
- Do not modify any Autopilot runtime source, Prisma schema, migration, dependency, API route, or UI.
- Do not create generic tooling. One narrow package generator and one narrow theme push script are the maximum new operational files.
- Do not use direct SQL or direct Shopify article mutation. Article changes must use pending Store Tasks linked to approved Recommendations and `EXECUTE_APPROVED_LIVE_ENABLED=true`.
- Do not alter the six completed redirect tasks or their Shopify records.
- Do not run the full Autopilot test suite or repeat equivalent tests. Run each required gate once.
- Do not perform multiple review passes. Use one allowlist diff check before deployment and one production verification afterward.
- Do not retry a failed mutation blindly. On any identity, hash, observation, permission, or verification mismatch, stop and report the exact blocker.
- Do not force Shopify cache refreshes, duplicate themes, republish content, or perform destructive recovery actions.
- No subagents, parallel implementers, speculative improvements, or follow-up cleanup.

## Exact Allowlist

### Theme href edits already prepared

1. `sections/rich-text.liquid`: `/collections/all` → `/collections/shop-all`
2. `snippets/article-lagundi-editorial.liquid`: all-products route → `/collections/shop-all`
3. `snippets/article-future-organic-farming.liquid`: all-products route → `/collections/shop-all`
4. `snippets/article-types-of-organic-rice.liquid`: all-products route → `/collections/shop-all`
5. `snippets/article-water-conservation-farming.liquid`: all-products route → `/collections/shop-all`
6. `snippets/article-creating-herbal-blends.liquid`: `/collections/herbal-powders` → `/collections/pure-powders`
7. `snippets/article-creating-herbal-blends.liquid`: `/blogs/news/turmeric-complete-benefits` → `/blogs/news/turmeric-complete-guide`
8. `snippets/article-ginger-digestive-health-editorial.liquid`: `/blogs/news/turmeric-complete-benefits` → `/blogs/news/turmeric-complete-guide`
9. `snippets/blog-discovery-dynamic.liquid`: `/blogs/news/where-to-buy-organic-rice` → `/blogs/news/where-to-buy-organic-rice-in-the-philippines`

Allowed supporting files:

- Existing focused test: `tests/seo-p0-legacy-link-sources.test.mjs`
- One narrow Admin API push script: `scripts/push-p0-legacy-link-cleanup.mjs`

### Shopify article-body replacements

Replace exactly one `href="/blogs/news/turmeric-complete-benefits"` with `href="/blogs/news/turmeric-complete-guide"` in each article:

1. `/blogs/news/creating-your-own-herbal-blends`
2. `/blogs/news/ginger-for-digestive-health`
3. `/blogs/news/herbal-tea-recipes-for-every-occasion`
4. `/blogs/news/pito-pito-tea-philippines`
5. `/blogs/news/salabat-recipe-how-to-make-traditional-filipino-ginger-tea`
6. `/blogs/news/sambong-herb-philippines`
7. `/blogs/news/turmeric-dosage-safety`
8. `/blogs/news/turmeric-for-inflammation`

Allowed strategy artifacts:

- One deterministic revision-5 package derived from active revision 4.
- Add exactly eight resolved internal-link rows, one for each article above, all targeting `/blogs/news/turmeric-complete-guide` with explicit replacement intent.
- All non-internal-link artifacts and all existing rules must remain byte-for-byte or semantically unchanged.
- Expected totals: 1,501 rules and 861 coverage units.
- One narrow generator: `scripts/build-p0-link-amendment.mjs`.

## Execution

### Task 1: Freeze rollback state

- [ ] Confirm active strategy identity is still revision 4 with package SHA `f4878508d18d3f2619f2eeef3e082ca74b944c67076741c04892cf4853b01768`.
- [ ] Fetch the eight exact article records and require exactly one old href in each.
- [ ] Save their IDs, URLs, complete bodies, `updatedAt`, and state hashes in one timestamped `0600` rollback file under `.seo-cache/shopify-backups/`.
- [ ] Confirm the theme diff contains only the nine allowlisted href edits, the focused test, the existing evidence edit, and the two allowed operational scripts/artifacts. Stop on any other overlap.

### Task 2: Create the eight governed Store Tasks

- [ ] Generate revision 5 once and run the existing package validator once.
- [ ] Require: valid package, zero issues, zero ambiguities, 1,501 rules, 861 coverage units, and exactly eight new internal-link rules.
- [ ] Import and activate revision 5 through the authenticated lifecycle API once.
- [ ] Run topical-map Store Task sync once.
- [ ] Require exactly eight new executable `internal_link_replace` tasks matching the eight article URLs and no other new executable task.
- [ ] Approve and execute those eight tasks sequentially through the authenticated Store Task APIs.
- [ ] Require eight completed tasks, eight verified receipts, and zero failed, blocked, skipped, or superseded executions.

### Task 3: Deploy the nine theme href edits

- [ ] Run `node --test tests/seo-p0-legacy-link-sources.test.mjs` once; require one passing test.
- [ ] Run `git diff --check` once.
- [ ] Use the one-shot Admin API script to push only the eight allowlisted Liquid assets to the configured `SHOPIFY_THEME_ID`.
- [ ] Read those eight assets back once and require their hashes to match the local files.

### Task 4: Verify once and close

- [ ] Run one fresh crawl of the 163 mapped URLs.
- [ ] Require zero rendered links to:
  - `/collections/all`
  - `/collections`
  - `/blogs/news/where-to-buy-organic-rice`
  - `/collections/herbal-powders`
  - `/blogs/news/turmeric-complete-benefits`
  - `/products/black-rice`
  - `/products/organic-red-rice`
- [ ] Re-read the eight Shopify article bodies and require zero old hrefs and exactly one final turmeric-guide href in each.
- [ ] Recheck the four repaired redirects remain one-hop to their exact final targets and both recipe pages remain direct 200/self-canonical.
- [ ] Require Autopilot health `ok`, storefront HTTP 200, and no degraded reasons.
- [ ] Append one SEO release-annotation row and update the existing evidence document with exact receipts, crawl time, rollback path, and verification results.
- [ ] Close task `cmrpedh9l0002s6sbjp34ywyq` only after every preceding requirement passes.
- [ ] Commit and push the allowlisted changes once in each affected repository.

## Rollback

- If an article execution fails after any successful article update, restore only the successfully changed articles from the rollback file through the same guarded execution boundary.
- If theme read-back mismatches, restore only the eight pushed assets from the preceding Git commit through the Admin API.
- Never roll back the six completed redirect repairs unless their independent verification fails.

## Completion Boundary

Complete means: eight article bodies corrected, eight theme assets deployed, the 163-URL crawl has zero legacy-link hits, the six existing redirect outcomes remain correct, both services are healthy, evidence is recorded, and the P0 SEO task is closed. Anything less remains explicitly incomplete.
