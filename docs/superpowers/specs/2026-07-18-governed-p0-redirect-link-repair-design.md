# Governed P0 Redirect and Legacy-Link Repair Design

## Goal

Complete the active topical map's “Remove Proven P0 Defects” phase without bypassing strategy authority, operator approval, stale-state checks, rollback evidence, or Shopify verification.

The bounded outcome is:

- four existing redirect chains point directly to their mapped final targets;
- the two stale recipe-hub redirect records are removed while the live pages remain the owners;
- every currently rendered link to the seven identified legacy redirect sources is replaced with its mapped final target when the active internal-link matrix provides a unique exact source-to-final-target edge;
- no published candidate-duplicate article is redirected;
- the SEO follow-up task closes only after a fresh crawl and persisted receipts prove every obligation.

## Existing Evidence and Constraint

The active revision-3 package already gives exact resolved authority for these four updates:

- `/products/5-in-1-turmeric-tea` → `/products/5-in-1-turmeric-tea-powder`;
- `/product/5n1-turmeric-tea-blend` → `/products/5-in-1-turmeric-tea-powder`;
- `/blog/rice-nutrition-breakdown-complete-guide-journal` → `/blogs/news/rice-nutrition-breakdown`;
- `/collections/frontpage-archive` → `/collections/shop-all`.

The two recipe-hub redirect rules are different. They are still `manual_gate`, even though their source text says to retain the live pages provisionally and remove the stale redirect records unless a dossier chooses the tag archives. Existing non-negotiables require manual gates to fail closed during task generation, approval, and final execution revalidation.

The internal-link CSV describes the desired exact `from_url → to_url` graph, but most rows do not carry a separate machine-readable legacy URL. A safe replacement therefore requires the intersection of three independently observed facts:

1. a currently rendered link targets a known redirect source;
2. an active resolved redirect maps that source to one exact final target;
3. the active internal-link matrix contains the exact current-page → final-target edge.

If that intersection is missing or ambiguous, the item stays advisory. The executor never guesses a replacement from prose.

## Approaches Considered

### 1. Manual Shopify edits

Fastest, but rejected. It would bypass the Recommendation lifecycle, exact approved-byte freeze, stale-state protection, execution lock, and durable receipt.

### 2. Treat all current advisories as executable

Rejected. It would silently weaken `manual_gate`, make prose interpretation executable, and grant generic mutation authority to unrelated redirect conflicts.

### 3. Bounded governed actions with a two-rule strategy amendment

Selected. Extend the existing governed Store Task path with exact redirect update, redirect delete, and legacy-link replacement actions. Keep generation deterministic and limited to active typed rules plus current Shopify observations. Prepare a minimal strategy-package revision that resolves only the two recipe-hub deletion rules; validate and activate it through the existing audited package lifecycle before those delete tasks can exist.

## Architecture

### 1. Typed actions

Add three exact actions alongside the existing create-only redirect and additive-link actions:

- `redirect_update`;
- `redirect_delete`;
- `internal_link_replace`.

Each action has a strict Zod source schema and proposed-state schema. Redirect actions persist the observed Shopify redirect ID, source, target, and state hash. Link replacements persist the exact resource identity, exact old and new targets, unchanged anchor text, before body HTML, after body HTML, observation timestamp, resource `updatedAt`, and state hash.

No action accepts an arbitrary patch object.

### 2. Redirect projection

A current redirect becomes `redirect_update` only when:

- exactly one active redirect rule matches the normalized source;
- its policy is resolved with no unsatisfied condition;
- its required action explicitly requests a one-hop replacement;
- the observed redirect ID and target match the active package's configured state;
- the observed target differs from the final target.

A current redirect becomes `redirect_delete` only when:

- exactly one active redirect rule matches the source;
- the rule is resolved, not `manual_gate` or `activation_blocking`;
- the typed required action explicitly says to remove the redirect while retaining the live resource;
- the live page returns `200` and is observed as the exact governed owner;
- the redirect ID and target match the package and current Shopify state.

All other redirect conflicts remain advisory.

### 3. Minimal strategy revision for the recipe hubs

Prepare a new immutable package revision derived from the active revision-3 package. Change only the two recipe-hub redirect rules:

- preserve `/pages/black-rice-recipes` as the live owner and explicitly delete redirect ID `495706833122`;
- preserve `/pages/red-rice-recipes` as the live owner and explicitly delete redirect ID `495706865890`.

The source CSV, strict compilation contract, manifest hashes, and activation authorization must agree. The existing whole-package validator must pass with zero issues. Import does not activate the revision. Activation uses the existing authenticated, audited pointer transition and is required before delete Store Tasks can be generated.

No other rule, URL ownership decision, evidence gate, content decision, canonical rule, indexation rule, or schedule obligation changes.

### 4. Legacy-link replacement projection

Scan Shopify-governed editable HTML for exact `href` destinations. Include products, collections, pages, and exact blog articles identified by `(blogHandle, handle)`. Theme navigation, template code, menus, and non-HTML fields remain outside this action.

For each observed legacy link, generate a replacement only when:

- the old destination is an active resolved redirect source;
- that redirect's final target is exact and internal to `agrikoph.com`;
- the internal-link matrix contains one resolved exact edge from the observed source resource to that final target;
- replacing the `href` preserves the existing anchor text and all other attributes and HTML bytes;
- the result is different, bounded, and parseable.

Group all replacements for one source resource into one Store Task and one Shopify mutation. Persist every contributing redirect and internal-link rule ID. Duplicate or ambiguous matches, conditional rules, removal-only rules, external URLs, fragments with different semantics, and resources over the existing HTML limit remain advisory.

The existing additive internal-link behavior remains unchanged.

### 5. Approval, rollback, and execution

Synchronization creates one pending Shopify Recommendation per executable task and links it from the Store Task. The Store Pilot confirmation route approves the exact proposed-state hash. Only `execute-approved`, with `EXECUTE_APPROVED_LIVE_ENABLED=true`, may claim and dispatch it.

Immediately before every write, execution revalidates:

- active strategy version and package hash;
- exact rule IDs and action eligibility;
- approved proposed-state hash;
- current redirect ID/source/target or resource ID/body/state hash;
- one persisted target lock;
- exact before state.

The persisted proposed state is the rollback payload. Each verified receipt includes the Shopify object ID, action, sorted changed fields, before-state hash, after-state hash, strategy identity, rule IDs, and verification timestamp. Redirect rollback uses the inverse exact mutation; body rollback restores the exact approved `before.bodyHtml` only after a fresh state match. Rollback is never automatic after an uncertain network response.

### 6. Shopify boundary

Use the existing `shopifyFetch` transport and current GraphQL Admin API:

- `urlRedirectUpdate` for one-hop target corrections;
- `urlRedirectDelete` for the two resolved stale records;
- existing product, collection, and page update helpers for body changes;
- `articleUpdate` for exact article body changes.

Every mutation checks `userErrors`, refetches the object, and compares exact normalized state. A transport error with an uncertain outcome enters reconciliation; it never claims completion.

### 7. UI

Reuse the current Store Pilot task list, detail drawer, confirmation modal, permissions, and audit history. Add only action-specific labels and exact before/after presentation:

- “Update redirect target”;
- “Delete stale redirect”;
- “Replace legacy internal links”.

No new dashboard, wizard, bulk editor, generic redirect manager, or additional approval screen is introduced.

## Failure Handling

- Strategy, rule, or state changed: fail before mutation with a stale-work result.
- Manual gate remains unresolved: advisory only.
- Exact desired link edge missing: advisory only.
- More than one possible final target or graph edge: advisory only.
- Shopify `userErrors`: failed application with a bounded safe message.
- Request may have succeeded but read-back is unavailable: reconciliation required; no replay and no completion claim.
- One task fails: unrelated tasks are not replayed, altered, or rolled back.
- Verification finds any remaining P0 obligation: keep the phase task open.

## Strict Non-Scope

- No generic redirect CRUD UI or executor.
- No arbitrary URL replacement.
- No AI-generated mutation decisions or copy.
- No canonical, indexation, handle, publication-state, navigation, theme-template, price, product-status, Meta, or Google Ads changes.
- No redirect of either unpublished duplicate or any published candidate-duplicate article.
- No weakening of `manual_gate`, schedule `executionProhibited`, Recommendation approval, `EXECUTE_APPROVED_LIVE_ENABLED`, or final stale-state checks.
- No unrelated refactor, schema redesign, queue redesign, or additional review loop.

## Testing and Acceptance

Implement test-first. Automated coverage must prove:

- strict schemas reject missing IDs, before states, old targets, and arbitrary fields;
- only the four exact resolved conflicts project as redirect updates under the current package;
- the two recipe redirects remain advisory before the scoped revision and become deletes only after the validated resolved rules are active;
- link replacement requires the exact observed-old → redirect-final plus source-resource → final-target matrix intersection;
- article identity is exact by `(blogHandle, handle)`;
- grouping produces one body mutation per resource and preserves anchor text and unrelated HTML;
- approved bytes, strategy, rules, Shopify state, target locks, user errors, and uncertain outcomes fail closed;
- existing redirect creation and additive internal links do not regress;
- task DTOs and UI expose exact bounded action evidence.

Run focused tests, full tests, both typechecks, lint, production build, Prisma freshness, diff checks, and the existing deployment gates once.

Production completion requires:

1. a pre-change export of the six redirect records and every affected resource body;
2. matching local, origin, server, and active-build commits with healthy PM2/public endpoint evidence;
3. the scoped strategy revision validated, imported, and explicitly activated;
4. exact generated Recommendations approved through the governed path;
5. guarded execution with one verified receipt per changed Shopify object;
6. Admin API read-back and storefront crawl showing four one-hop redirects, two absent stale redirect records with both live pages still returning `200`, and zero rendered links to the seven legacy sources;
7. unchanged published/unpublished article allocation and zero unrelated Shopify or Meta writes;
8. completion of the P0 SEO follow-up task only after all seven checks pass.
