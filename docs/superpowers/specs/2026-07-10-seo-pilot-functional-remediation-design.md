# SEO Pilot Functional Remediation Design

## Goal

Fix all ten confirmed SEO Pilot audit findings without broadening the product surface, changing the operator-approval lifecycle, or executing any live Shopify or advertising mutations.

## Scope

The remediation covers the SEO Pilot UI, `/api/seo/**` routes, the SEO-to-Content-Pilot proposal handoff, GSC/GA4 comparison metadata, tracked-keyword persistence, and the repository lint gate. Content Pilot behavior is in scope only where SEO-created proposals depend on it.

The confirmed findings are:

1. Existing-page opportunities can lose landing-page attribution and become net-new content.
2. Proposal dedupe differs by creation path and is not concurrency-safe.
3. Thin-content findings can suppress a separate missing-meta fix.
4. Missing-H1 detection uses total heading count and produces false negatives.
5. A failed core SEO request is cached and rendered as valid data.
6. Analysis and decomposition bypass AI failover and reasoning-content handling.
7. Prior-period data is calculated while its timestamp is always reported as absent.
8. `npm run lint` opens interactive setup instead of linting.
9. Strategy-tab tracked state is not hydrated from persisted keywords.
10. Concurrent null-location keyword inserts can create duplicates.

## Architecture

Use shared domain logic plus database-backed idempotency. Keep the existing route and UI boundaries, but move classification and logical-key decisions into pure helpers that every creation path consumes. Do not rewrite the SEO Pilot or introduce a new framework-level service layer.

The main boundaries are:

- opportunity attribution and classification;
- canonical Content Proposal identity and atomic creation;
- analysis/health signal derivation;
- AI completion reliability and structured-output validation;
- client load-state hydration;
- comparison-window metadata;
- null-safe keyword identity;
- deterministic verification tooling.

## Opportunity Attribution and Classification

Opportunity calculation must consume the complete available query-page mapping set. Presentation limits may be applied only after every returned opportunity has had a chance to resolve its best landing page.

A pure shared classifier will consume the opportunity type, resolved landing page, and canonical `ArticleRecord` match, then return one of:

- `seo-fix` for an existing blog page with `low_ctr` or `high_impression_no_click`;
- `content-refresh` for an existing blog page with `striking_distance`;
- `new-content` only when the query has no covered existing page;
- a typed `nonBlogExistingPage` skip when GSC points to an existing non-blog page;
- a typed `missingArticle` skip when a claimed blog article cannot be resolved server-side.

Client-supplied article titles, handles, and word counts remain untrusted hints. Canonical article title, handle, and word count come from `ArticleRecord` before proposal creation.

## Proposal Identity and Atomic Creation

All SEO-related proposal creation paths will use `contentProposalDedupeKey()` semantics, including:

- `/api/seo/promote`;
- `/api/seo/gaps/promote`;
- `/api/seo/recommendations/decompose`;
- `/api/content-pilot/proposals/manual` when called by SEO Strategy;
- existing generator and opportunity-routing paths.

`ContentProposal` will gain a persisted `dedupeKey`. New rows must populate it from the canonical logical identity. The database will enforce uniqueness for creation-blocking identities so two concurrent requests cannot create the same active or terminal idea.

The migration will be staged:

1. add nullable `dedupeKey`;
2. backfill all existing proposals deterministically;
3. preserve every terminal operator decision;
4. resolve only safe duplicate pending rows, retaining the earliest row;
5. assign stable history-specific keys where multiple terminal historical rows share one canonical identity;
6. make the field required and unique.

Create-or-return-existing helpers will translate a unique-key conflict into a successful dedupe result. They must never turn a rejected, published, approved, or otherwise operator-decided proposal back into pending work.

Distinct structured actions remain distinct:

- separate internal-link destinations;
- separate SEO issues/target queries where both actions are valid;
- missing-meta and thin-content work on the same article;
- new-content topics discriminated by normalized target keyword/query.

## Analysis and Health Accuracy

Programmatic analysis will key findings by structured identity rather than title prefixes. An article that is both thin and missing metadata will yield both findings because the resulting proposal types modify different Shopify fields.

Missing-H1 detection will prefer H1-specific evidence already stored in `seoData`:

1. explicit `missing-h1` issue;
2. numeric `h1Count`;
3. a conservative fallback only when H1-specific evidence is unavailable.

Total `headingCount` remains useful for general structure checks but cannot prove that an H1 exists.

Article and GSC safety limits will be deterministic and disclosed. API responses will include truncation metadata when a hard limit prevents full-corpus analysis. UI copy will distinguish a complete clean result from a partial result.

## AI Reliability

SEO analysis and recommendation decomposition will use `chatCompletionWithFailover()` so connection-level DeepSeek failures can retry through OpenRouter. The shared helper's `content`/`reasoning_content` extraction becomes the only response-text path.

Structured AI output remains Zod-validated before persistence. Empty output, invalid JSON, schema-invalid JSON, provider timeout, provider authentication failure, and connection failure will produce distinct safe errors.

Programmatic gaps may still be returned if the AI narrative portion fails, but the response must explicitly mark the AI portion as failed or partial. It must not persist an empty AI result and claim a complete successful analysis. Decomposition must return a retryable error when no valid structured response can be parsed; a genuine validated empty task array remains a successful no-op.

## Client Loading and State Hydration

The core SEO loader will check `response.ok` before parsing or caching data. A failed refresh will preserve the last valid cached payload and set the section error banner. Error payloads must never replace `SeoData` in the cache.

Persisted keyword rows will hydrate the Strategy tab's tracked-keyword set. Button state will therefore remain correct after reload, while POST remains idempotent for already-tracked keywords.

Proposal action state may continue to be confirmed lazily by create-or-return-existing responses; this remediation does not require eagerly loading the entire Content Pilot queue into SEO Pilot.

## Comparison Metadata

Previous-period query lookup will return its comparison-window metadata together with the rows. `/api/seo` will pass the actual previous capture/window timestamp into `computeTrends()`. The Overview message must agree with the presence or absence of calculated comparison totals.

## Keyword Identity

SEO tracked keywords use normalized keyword, normalized nullable location, and language as their identity. Database uniqueness must treat a null location as one canonical value rather than allowing multiple null-bearing rows.

The migration may use a stored normalized location key or an explicit PostgreSQL nulls-not-distinct index, provided Prisma access remains straightforward and production PostgreSQL compatibility is verified. POST will use an atomic create-or-return-existing flow and preserve reactivation/category updates for an existing row.

## Lint and Verification Tooling

The repository will gain a checked-in, non-interactive ESLint configuration compatible with the installed Next.js version. `npm run lint` must execute the linter directly, return nonzero on violations, and require no prompts. Build scripts may continue separating compilation from lint/typecheck, but the final verification sequence must run all gates explicitly.

## Error Handling and Safety

- Unique-key conflicts are successful dedupe outcomes, not 500 errors.
- Existing non-blog pages and missing articles return typed skip reasons.
- Invalid or partial data is disclosed instead of silently rendered as complete.
- Last valid browser cache survives failed refreshes.
- AI/provider errors expose safe operator-actionable messages without secret values.
- No remediation path approves, generates, schedules, publishes, or executes a proposal automatically.
- Existing Content Pilot approval and publish gates remain unchanged.
- No live Shopify, Meta, or production database action is part of implementation verification.

## Testing

Implementation follows red-green TDD in independently reviewable batches.

Opportunity tests will prove:

- more than 50 query-page pairs retain landing-page attribution;
- existing low-CTR/no-click pages become `seo-fix`;
- existing striking-distance pages become `content-refresh`;
- uncovered queries alone become `new-content`;
- non-blog existing pages are typed skips.

Idempotency tests will prove:

- every SEO/manual path emits the same canonical key for the same idea;
- parallel attempts create one proposal;
- rejected and published decisions block recreation;
- distinct internal-link destinations and structured SEO actions coexist;
- migration backfill preserves terminal history and removes only safe pending duplicates.

Analysis/health tests will prove:

- thin and missing-meta findings coexist for one article;
- title-prefix collisions do not suppress findings;
- H2/H3 without H1 reports missing H1;
- explicit H1 evidence overrides total heading count;
- truncation metadata is accurate.

Reliability/UI tests will prove:

- failed core loads preserve cache and show an error;
- reasoning-only AI responses are accepted;
- connection failures invoke provider failover;
- invalid/empty structured output is retryable or explicitly partial;
- previous comparison timestamps reach the UI;
- persisted keywords hydrate Track button state;
- concurrent null-location keyword inserts yield one row;
- lint runs non-interactively and catches a deliberate violation in an isolated fixture or command-level test.

Final gates are:

1. focused SEO, Content Pilot, migration, and client tests;
2. full `npm test`;
3. `npx tsc --noEmit`;
4. non-interactive `npm run lint`;
5. `npm run build`;
6. `git diff --check` and scope review;
7. project GROW documentation updates.

## Scope Boundaries

- No broad Content Pilot redesign.
- No change to proposal approval or publishing semantics.
- No live Shopify, Meta, or production deployment action.
- No unrelated UI restyling or SEO-strategy expansion.
- No replacement of Prisma, Next.js, Polaris, Vitest, or the existing AI client abstraction.
