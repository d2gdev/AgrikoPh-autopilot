# Grouped Topical-map Internal Links Design

## Goal

Generate and execute one governed Shopify update per source resource when the active topical map requires multiple internal links from that resource.

## Root cause

`lib/store-tasks/topical-map.ts` currently projects every internal-link rule into a separate candidate. The task dedupe identity includes each candidate's rule IDs, so 25 rules from `/pages/red-rice-recipes` become 25 tasks with the same observed Shopify state. The first successful write changes that state and correctly makes the other 24 tasks stale. The generated HTML also appends one standalone paragraph per task, which would produce poor page structure even without the state conflict.

## Design

Before Shopify observation and task persistence, group internal-link candidates by normalized source URL and action. A group carries the sorted union of every rule ID and a sorted list of unique `{ toUrl, anchor }` links. It produces one `internal_link` task, one proposed-state hash, one Recommendation, and one Shopify mutation.

The executable source schema replaces the singular `linkTargetUrl` and `linkAnchor` fields with a non-empty `links` array. Each entry contains one normalized governed destination and its anchor. The source retains every rule ID and source reference; the current 25-reference ceiling already fits the red-rice group.

For a group containing one link, append the existing compact linked paragraph. For a group containing multiple links, append one semantic section:

```html
<section class="ag-related-recipes" aria-labelledby="ag-related-recipes-title">
  <h2 id="ag-related-recipes-title">Explore More Red Rice Recipes</h2>
  <ul>...</ul>
</section>
```

The heading is selected deterministically from the source URL: the red-rice recipe hub receives the exact heading above; other grouped sources receive `Explore Related Resources`. Links are escaped, normalized, unique, and sorted by destination. Existing destinations are omitted before grouping, and no empty task is created.

## Obsolete task handling

After the grouped task is persisted, synchronization identifies older pending or failed executable topical-map internal-link tasks for the same strategy, target URL, and action whose dedupe key differs. It dismisses them with completion note `Superseded by grouped topical-map internal-link task <id>` and writes one audit record per superseded task. Approved, override-approved, executing, completed, or already dismissed work is never rewritten.

The client interface gains a bounded `findMany` query and `updateMany`/audit transaction support for this cleanup. Cleanup occurs only after the replacement task and Recommendation exist.

## Production execution

Deploy the verified runtime, synchronize against the active revision-3 package, and require exactly four pending executable grouped tasks for the scoped URLs: the turmeric collection, two turmeric products, and red-rice recipe page. Inspect their exact before/after payloads, approve them through the existing authenticated route, run the guarded executor, and verify Shopify state, rendered pages, Recommendation/StoreTask terminal states, minimal receipts, and audits.

## Safety boundaries

- Preserve the active package hash, strategy version, all rule IDs, source references, observed state hash, and proposed-state hash.
- Preserve exact operator approval, live gate, permission, active-rule, stale-state, target-lock, Shopify response, and audit safeguards.
- Do not execute redirects, canonicals, indexation, publishing-state changes, Meta changes, or unrelated Shopify mutations.
- Do not bypass the authenticated approval route or guarded executor.
- A failure on one resource does not authorize replaying or altering another resource.

## Verification

TDD must demonstrate grouping, deterministic markup and identity, omission of already-present links, supersession boundaries, frozen-approval preservation, and one mutation per grouped resource. Run focused tests, the full Vitest suite, application and test typechecks, lint, production build, Prisma verification, guarded PostgreSQL integration, diff checks, deploy parity, PM2/public health, production task counts, Shopify render checks, and audit receipt checks.
