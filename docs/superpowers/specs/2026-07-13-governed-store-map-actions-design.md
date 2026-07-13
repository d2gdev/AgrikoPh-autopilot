# Governed Store Map Actions Design

## Goal

Make the active topical map actionable for Shopify products, collections, Online Store pages, the homepage, and blog indexes without autonomous publishing. An operator must be able to inspect an exact proposed change, approve it, confirm it, and apply supported changes from Store Pilot.

## Scope

The first release supports:

- product and collection SEO title, meta description, and description HTML updates;
- Online Store page title/body updates plus SEO title and description through the existing `global.title_tag` and `global.description_tag` metafields;
- required internal-link insertion into product, collection, and page HTML;
- exact topical-map identity and rule provenance on every Store Task;
- read-only advisory tasks for homepage and blog-index work, because Shopify does not expose their theme-controlled body layout through the product, collection, page, blog, or article resource mutations;
- explicit approval and a second confirmation before every supported Shopify write.

This release does not execute redirects, canonicalization, indexation, theme-template edits, navigation edits, price changes, product status changes, handles, or publishing-state changes. Blog articles continue through Content Pilot and are not duplicated in Store Pilot.

## Architecture

### 1. Shopify observation boundary

A focused server module reads only the governed non-blog URLs from Shopify Admin GraphQL. It resolves normalized URLs to Shopify GIDs and captures:

- target type and ID;
- handle and URL;
- title;
- SEO title and description where supported;
- editable HTML/body;
- `updatedAt` when the resource exposes it;
- a SHA-256 hash of the editable state;
- normalized internal-link destinations found in the body.

The observation is read-only. Missing, ambiguous, failed, or future-dated observations fail closed and cannot produce an executable task.

### 2. Map-bound task generation

SEO analysis keeps the existing 92 blog actions unchanged. For each active-map non-blog content decision or required internal link, it compares the exact current Shopify observation with the projected rule.

An executable Store Task is created only when the map contains enough exact direction to construct a bounded change. Its `sourceData` stores:

- active strategy version ID and package SHA-256;
- exact rule IDs and rule domains;
- normalized target URL and Shopify target type;
- observation timestamp and state hash;
- source references already projected by the command center;
- generation provenance.

Its `proposedState` stores only allowlisted fields and exact before/after values. AI may draft SEO copy through the existing failover client, but the result must pass a strict Zod schema and length limits before persistence. AI failure produces an advisory task, never an executable placeholder.

Tasks use a deterministic dedupe key derived from strategy identity, rule IDs, target URL, action type, and proposed-state hash. Regeneration updates a still-pending matching task but never reopens completed or dismissed work silently.

### 3. Approval and execution state machine

Map tasks use these states:

```text
pending -> approved -> applying -> completed
   |          |           |
   +------> dismissed      +-> failed
```

- `pending`: generated and awaiting operator review.
- `approved`: the operator approved the exact proposed state.
- `applying`: claimed atomically by one request.
- `completed`: Shopify returned the expected updated fields and an audit receipt was stored.
- `failed`: no success is claimed; the task retains a safe error message and can be reviewed again.
- `dismissed`: closed without a write.

Approval and Apply are separate UI actions. Apply opens a confirmation modal that shows the exact current-to-proposed fields. The apply route requires `CONTENT_PUBLISH`, `EXECUTE_APPROVED_LIVE_ENABLED=true`, an `approved` task, and the active strategy to match the stored identity.

Immediately before mutation, the server refetches the exact Shopify object and compares its state hash with the task observation. Any changed object, active strategy, rule set, or proposed field returns `409` and performs no write. The request atomically claims the task before the external call, prevents duplicate execution, and records an audit entry for success or failure.

### 4. Shopify mutation boundary

The existing `shopifyFetch` transport remains the only Shopify Admin boundary. Focused functions implement allowlisted mutations:

- `productUpdate`: `seo`, `descriptionHtml`;
- `collectionUpdate`: `seo`, `descriptionHtml`;
- `pageUpdate`: `title`, `body`, and the two SEO metafields;
- internal links: update only the relevant HTML/body field after server-side insertion and sanitization.

The configured production schema was inspected read-only on 2026-07-13. It exposes `seo` and `descriptionHtml` on `ProductUpdateInput` and `CollectionInput`; `PageUpdateInput` exposes `body`, `title`, and `metafields`. Homepage and blog-index layout remain theme-controlled and advisory-only.

Every mutation checks Shopify `userErrors`. A transport error, user error, missing returned object, or post-write mismatch is a failed application, not completion.

### 5. Store Pilot UI

Store Pilot gains map-specific task filters and clear capability labels:

- `Ready to review` for executable pending tasks;
- `Approved` for tasks ready to apply;
- `Advisory only` for homepage/blog-index or insufficiently exact rules;
- `Failed` with a retry/review path;
- existing completed and dismissed history.

Each row expands to show strategy version, rule IDs, evidence timestamp, target URL, exact before/after fields, and why a task is advisory. Approve, Apply, and Dismiss use confirmation dialogs and surface API failures. “Complete” is not shown for executable map tasks; only a verified Shopify response can complete them.

## Security and governance

- Every embedded route calls `await requireAppAuth(req)` first.
- Approval requires `CONTENT_REVIEW`; Apply requires `CONTENT_PUBLISH`.
- All database access uses `import { prisma } from "@/lib/db"`.
- `AUTOPILOT_API_KEY` stays server-side.
- No task bypasses `EXECUTE_APPROVED_LIVE_ENABLED=true`.
- No background job or analysis request applies a Shopify mutation.
- Strategy identity, exact rules, observation state, task status, permission, and environment gate are revalidated at execution time.
- Existing blog Content Proposals and their approval/publishing path remain unchanged.

## Error handling

- Unsupported target or mutation: advisory task with an explicit reason.
- Missing Shopify object or incomplete observation: suppressed; no executable task.
- Invalid AI output: advisory task; no guessed copy.
- Strategy/rule/state mismatch: `409`, no Shopify write, task returned to review with conflict detail.
- Shopify user/transport error: task becomes `failed`, safe message stored, audit failure recorded.
- Duplicate Apply: only one atomic claim succeeds; later calls return `409`.
- Successful write with unexpected returned state: failed verification, never marked completed.

## Testing and acceptance

Automated coverage must prove:

- mixed target observation and URL/GID resolution;
- strict supported-field schemas and copy limits;
- exact strategy/rule/state provenance and deterministic dedupe;
- unsupported homepage/blog-index tasks remain advisory;
- approval and Apply permissions, environment gate, and auth ordering;
- stale strategy, altered rule, changed Shopify state, duplicate Apply, and Shopify user errors perform zero writes or never claim completion;
- successful product, collection, page, and internal-link mutations store audit receipts and complete exactly once;
- existing 92 blog actions and Content Pilot promotion remain unchanged;
- Store Pilot exposes the exact before/after review and confirmation flow.

Production acceptance requires matching local/origin/server commits, an active build produced after that commit, PM2 online after the build, public health `ok`, authenticated task generation, one explicitly approved test action applied and verified against Shopify, zero unrelated Shopify/Meta writes, and a durable audit receipt. The operator chooses the acceptance action in the UI; deployment itself does not approve or execute one.

