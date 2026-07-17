# Governed P0 Redirect and Legacy-Link Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add narrowly governed redirect-update, redirect-delete, and legacy-link-replacement execution, activate a two-rule strategy amendment, and complete the current P0 SEO phase only after verified Shopify state.

**Architecture:** Extend the existing typed Topical Map Store Task pipeline rather than adding a new execution path. Projection derives exact actions only from the active compiled rules plus fresh Shopify observations; the existing approval hash, live-execution flag, target lock, stale-state revalidation, receipt, and audit lifecycle remain mandatory. A deterministic package-amendment script changes only the two recipe-hub redirect rules from conditional manual gates to resolved delete instructions.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/PostgreSQL, Zod, Vitest, Shopify Admin GraphQL API 2026-01, existing topical-map package compiler/validator.

## Global Constraints

- Never send a Shopify mutation unless `EXECUTE_APPROVED_LIVE_ENABLED=true` and the linked Recommendation is `approved` or `override_approved`.
- Keep all database access through `import { prisma } from "@/lib/db"`.
- Keep `AUTOPILOT_API_KEY` server-side.
- Preserve exact active strategy identity, approved proposed-state hash, stale-state revalidation, target locking, verified receipts, and audit logs.
- Manual-gated rules remain non-executable; the two deletes become eligible only after the scoped revision is validated, imported, and activated.
- Do not add generic redirect CRUD, arbitrary URL replacement, AI mutation decisions, content rewriting, canonical/indexation writes, navigation/theme writes, publication changes, or unrelated refactors.
- Do not redirect either unpublished duplicate or any published candidate-duplicate article.
- Run one implementation review and one final verification pass; do not add repeated review loops.

---

### Task 1: Strict Action Types and Pure Link Replacement

**Files:**
- Modify: `lib/store-tasks/topical-map.ts`
- Create: `lib/store-tasks/replace-internal-links.ts`
- Modify: `__tests__/lib/store-tasks/topical-map.test.ts`
- Create: `__tests__/lib/store-tasks/replace-internal-links.test.ts`

**Interfaces:**
- Produces:
  - `TopicalMapStoreAction` with `redirect_update`, `redirect_delete`, and `internal_link_replace`.
  - `replaceExactInternalLinkTargets(bodyHtml, replacements)` returning `{ bodyHtml, changed }`.
  - strict source/proposed schemas carrying exact redirect IDs and exact old/new link targets.
- Consumes: `normalizeGovernedUrl()` and the existing proposed-state hash.

- [ ] **Step 1: Write failing schema tests**

Add tests proving these exact shapes parse and missing before-state fields fail:

```ts
const updateSource = {
  source: "topical-map",
  strategyVersionId: "v2",
  packageSha256: "a".repeat(64),
  ruleIds: ["redirect:one"],
  ruleDomains: ["redirects"],
  sourceReferences: [{ kind: "rule", id: "redirect:one" }],
  generationProvenance: "deterministic",
  targetType: "redirect",
  targetUrl: "/old",
  action: "redirect_update",
  redirectId: "gid://shopify/UrlRedirect/1",
  observedRedirectTarget: "/middle",
  redirectTarget: "/final",
  observedAt: "2026-07-18T00:00:00.000Z",
  observedStateHash: "b".repeat(64),
  executable: true,
  resolutionStatus: "resolved",
};

expect(TopicalMapStoreTaskSourceSchema.parse(updateSource)).toEqual(updateSource);
expect(TopicalMapStoreTaskProposedSchema.parse({
  action: "redirect_update",
  before: { id: updateSource.redirectId, target: "/middle" },
  after: { target: "/final" },
})).toBeTruthy();
expect(() => TopicalMapStoreTaskProposedSchema.parse({
  action: "redirect_delete",
  before: { target: "/tagged/red-rice" },
  after: { state: "absent" },
})).toThrow();
```

- [ ] **Step 2: Write failing replacement tests**

Cover relative and same-host absolute `href` values, attribute/anchor preservation, repeated exact targets, and no changes to text, external hosts, query-different URLs, or unrelated attributes:

```ts
const input = '<p><a class="cta" href="/products/black-rice">Black rice</a></p>';
expect(replaceExactInternalLinkTargets(input, [{
  fromUrl: "/products/black-rice",
  toUrl: "/products/philippines-organic-black-rice",
}])).toEqual({
  bodyHtml: '<p><a class="cta" href="/products/philippines-organic-black-rice">Black rice</a></p>',
  changed: 1,
});
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- __tests__/lib/store-tasks/replace-internal-links.test.ts __tests__/lib/store-tasks/topical-map.test.ts
```

Expected: failures because the actions and helper do not exist.

- [ ] **Step 4: Implement the minimal strict schemas and helper**

Use a parsed HTML attribute replacement, not global string replacement. Normalize only the `href` comparison and replace only the quoted attribute value:

```ts
export type ExactInternalLinkReplacement = { fromUrl: string; toUrl: string };

export function replaceExactInternalLinkTargets(
  bodyHtml: string,
  replacements: readonly ExactInternalLinkReplacement[],
): { bodyHtml: string; changed: number } {
  const bySource = new Map(replacements.map((item) => [
    normalizeHref(item.fromUrl),
    normalizeHref(item.toUrl),
  ]));
  let changed = 0;
  const next = bodyHtml.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)(\2)/gi,
    (match, prefix: string, quote: string, href: string, suffix: string) => {
      const normalized = safeNormalizeInternalHref(href);
      const replacement = normalized ? bySource.get(normalized) : undefined;
      if (!replacement) return match;
      changed += 1;
      return `${prefix}${quote}${replacement}${suffix}`;
    },
  );
  return { bodyHtml: next, changed };
}
```

Keep the 50,000-byte body limit and strict `.strict()` schemas.

- [ ] **Step 5: Run GREEN tests and commit**

Run the Task 1 tests again; expected: pass.

Commit:

```bash
git add lib/store-tasks/topical-map.ts lib/store-tasks/replace-internal-links.ts __tests__/lib/store-tasks/topical-map.test.ts __tests__/lib/store-tasks/replace-internal-links.test.ts
git commit -m "feat(seo): type governed P0 repair actions"
```

---

### Task 2: Shopify Redirect and Exact Article Adapters

**Files:**
- Modify: `lib/shopify-governed-resources.ts`
- Modify: `lib/shopify-admin.ts`
- Modify: `__tests__/lib/shopify-governed-resources.test.ts`

**Interfaces:**
- Produces:
  - `updateGovernedRedirect(current, target): Promise<GovernedRedirect>`.
  - `deleteGovernedRedirect(current): Promise<{ id: string; source: string; previousTarget: string; verifiedAt: Date }>`.
  - article support in `resolveGovernedStoreUrl`, `fetchGovernedStoreResources`, `fetchGovernedStoreResource`, and `applyGovernedStoreResourceChange`.
- Consumes: existing `shopifyFetch`, `fetchBlogArticles`, and `articleUpdate`.

- [ ] **Step 1: Write failing adapter tests**

Assert exact mutation names, variables, `userErrors`, and read-back:

```ts
mockShopifyFetch
  .mockResolvedValueOnce({
    urlRedirectUpdate: {
      urlRedirect: { id: "gid://shopify/UrlRedirect/1", path: "/old", target: "/final" },
      userErrors: [],
    },
  });

await expect(updateGovernedRedirect(currentRedirect, "/final")).resolves.toMatchObject({
  id: currentRedirect.id,
  source: "/old",
  target: "/final",
});
expect(mockShopifyFetch).toHaveBeenCalledWith(
  expect.stringContaining("urlRedirectUpdate"),
  { id: currentRedirect.id, urlRedirect: { path: "/old", target: "/final" } },
);
```

Add delete success/error tests and an article observation/update test using `/blogs/recipes/shared` that proves `(blogHandle, handle)` is preserved.

- [ ] **Step 2: Run RED tests**

Run:

```bash
npm test -- __tests__/lib/shopify-governed-resources.test.ts
```

Expected: failures for missing update/delete functions and unsupported article resources.

- [ ] **Step 3: Implement URL redirect mutations**

Use Shopify Admin GraphQL 2026-01:

```graphql
mutation UpdateGovernedUrlRedirect($id: ID!, $urlRedirect: UrlRedirectInput!) {
  urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
    urlRedirect { id path target }
    userErrors { field message }
  }
}

mutation DeleteGovernedUrlRedirect($id: ID!) {
  urlRedirectDelete(id: $id) {
    deletedUrlRedirectId
    userErrors { field message }
  }
}
```

Normalize returned paths, reject mismatches, and verify deletion by refetching the exact source.

- [ ] **Step 4: Implement exact article observation and update**

Extend the governed target:

```ts
export type GovernedStoreTargetType = "product" | "collection" | "page" | "article";
```

Resolve only `/blogs/<blogHandle>/<handle>`. Fetch the exact article from the existing indexed Shopify article list, store `blogHandle` and `handle`, hash `id`, URL, body, and `updatedAt`, and update only `body` through:

```graphql
mutation UpdateGovernedArticle($id: ID!, $article: ArticleUpdateInput!) {
  articleUpdate(id: $id, article: $article) {
    article { id handle body updatedAt blog { handle } }
    userErrors { code field message }
  }
}
```

- [ ] **Step 5: Run GREEN tests and commit**

Run the Task 2 tests; expected: pass.

Commit:

```bash
git add lib/shopify-governed-resources.ts lib/shopify-admin.ts __tests__/lib/shopify-governed-resources.test.ts
git commit -m "feat(shopify): add governed redirect and article adapters"
```

---

### Task 3: Deterministic Projection and Recommendation Generation

**Files:**
- Modify: `lib/store-tasks/topical-map.ts`
- Modify: `lib/topical-map/action-eligibility.ts`
- Modify: `__tests__/lib/store-tasks/topical-map.test.ts`
- Create: `__tests__/lib/topical-map/action-eligibility.test.ts`

**Interfaces:**
- Produces executable Store Tasks only from exact resolved map rules and fresh observations.
- Produces one grouped `internal_link_replace` task per source resource.
- Consumes Task 1 schemas/helper and Task 2 observations.

- [ ] **Step 1: Write failing redirect projection tests**

Create fixtures proving:

- resolved `replace with one-hop target` + observed different target → `redirect_update`;
- exact matching redirect → unchanged;
- unresolved/manual gate → advisory;
- resolved explicit `retain live page as owner; remove redirect record` + live page observation → `redirect_delete`;
- generic conflicts remain advisory.

Assert the exact before/after states and observed redirect ID/hash.

- [ ] **Step 2: Write failing link-intersection tests**

Build a fixture with:

```ts
redirects: [{
  source: "/products/black-rice",
  configuredTarget: "/products/philippines-organic-black-rice",
  finalTarget: "/products/philippines-organic-black-rice",
  requiredAction: "retain unless source is still internally linked",
  policy: resolvedPolicy,
  ruleIds: ["redirect:black"],
}],
internalLinks: [{
  fromUrl: "/blogs/news/source",
  toUrl: "/products/philippines-organic-black-rice",
  currentBodyState: "legacy source present",
  requiredAction: "replace legacy target with this current URL",
  recommendedAnchor: "organic black rice",
  policy: resolvedPolicy,
  ruleIds: ["link:black"],
}],
```

Observe `/blogs/news/source` with a body linking to `/products/black-rice`. Expect one executable replacement task containing both rule IDs. Remove the matrix edge and expect advisory/no executable task.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- __tests__/lib/store-tasks/topical-map.test.ts __tests__/lib/topical-map/action-eligibility.test.ts
```

Expected: failures because conflict projection and replacement eligibility are unsupported.

- [ ] **Step 4: Implement exact eligibility and grouping**

Add pure explicit-instruction classifiers:

```ts
export function topicalMapRedirectRequiresUpdate(requiredAction?: string): boolean {
  return /\breplace with one-hop target\b/i.test(requiredAction ?? "");
}

export function topicalMapRedirectRequiresDelete(requiredAction?: string): boolean {
  return /\bretain live page as (?:the )?owner\b.*\bremove redirect record\b/i.test(requiredAction ?? "");
}

export function topicalMapInternalLinkRequiresReplacement(requiredAction?: string): boolean {
  return /\breplace\b.*\b(?:legacy )?target\b/i.test(requiredAction ?? "");
}
```

Generate replacements only from the three-way intersection defined in the spec. Group by exact source resource, preserve anchor text, and persist both redirect and internal-link rule IDs.

- [ ] **Step 5: Run GREEN tests and commit**

Run the Task 3 tests; expected: pass.

Commit:

```bash
git add lib/store-tasks/topical-map.ts lib/topical-map/action-eligibility.ts __tests__/lib/store-tasks/topical-map.test.ts __tests__/lib/topical-map/action-eligibility.test.ts
git commit -m "feat(seo): project exact P0 repair tasks"
```

---

### Task 4: Approval, Execution, Recovery, DTO, and UI

**Files:**
- Modify: `lib/store-tasks/apply-topical-map.ts`
- Modify: `lib/store-tasks/dto.ts`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx`
- Modify: `__tests__/lib/store-tasks/apply-topical-map.test.ts`
- Modify: `__tests__/lib/store-tasks/dto.test.ts`
- Modify: `__tests__/components/store-pilot-map-actions.test.tsx`

**Interfaces:**
- Consumes the exact Task 1–3 schemas/actions.
- Produces verified receipts through the existing `execute-approved` transaction.

- [ ] **Step 1: Write failing execution tests**

For each new action, prove:

- approved hash mismatch sends zero Shopify mutations;
- strategy/rule change sends zero mutations;
- redirect ID/target/hash change sends zero mutations;
- body state change sends zero mutations;
- successful mutation returns a verified receipt;
- uncertain response with matching read-back recovers success;
- uncertain response without matching read-back throws `SHOPIFY_VERIFICATION_UNCERTAIN`;
- reobservation recognizes already-applied exact state.

- [ ] **Step 2: Write failing DTO/UI tests**

Assert bounded details and labels:

```ts
expect(screen.getByText("Update redirect target")).toBeInTheDocument();
expect(screen.getByText("Delete stale redirect")).toBeInTheDocument();
expect(screen.getByText("Replace legacy internal links")).toBeInTheDocument();
```

Ensure raw full body HTML remains detail-only and never enters list DTOs.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/lib/store-tasks/dto.test.ts __tests__/components/store-pilot-map-actions.test.tsx
```

Expected: failures for unsupported actions and labels.

- [ ] **Step 4: Implement final revalidation and dispatch**

Extend `stillGoverned`, `dispatchClaimedTopicalMapStoreTask`, and `reobserveTopicalMapReceipt`. For redirects compare exact source, Shopify ID, observed target, state hash, final target, resolved policy, and explicit instruction before mutation. For link replacement, recompute the after-body from the freshly observed current body and exact persisted replacement list; require it to equal the approved `after.bodyHtml`.

Return receipts containing:

```ts
{
  taskId,
  recommendationId,
  targetId,
  targetUrl,
  targetType,
  strategyVersionId,
  packageSha256,
  ruleIds,
  action,
  changedFields,
  proposedStateHash,
  shopifyReturnedStateHash,
  verifiedAt,
}
```

- [ ] **Step 5: Implement bounded DTO/UI support**

Reuse the existing Apply/Dismiss confirmation flow. Add only action labels and exact redirect/link evidence; do not add a new route or screen.

- [ ] **Step 6: Run GREEN tests and commit**

Run the Task 4 tests; expected: pass.

Commit:

```bash
git add lib/store-tasks/apply-topical-map.ts lib/store-tasks/dto.ts app/'(embedded)'/'(store-pilot)'/store-pilot/components/MapTaskDetails.tsx __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/lib/store-tasks/dto.test.ts __tests__/components/store-pilot-map-actions.test.tsx
git commit -m "feat(seo): execute governed P0 repairs"
```

---

### Task 5: Two-Rule Strategy Package Amendment

**Files:**
- Modify: `lib/topical-map/contract.ts`
- Modify: `__tests__/lib/topical-map/contract.test.ts`
- Create: `/home/sean/Agriko/shopify-theme/scripts/build-p0-topical-map-amendment.mjs`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/strategy-package-manifest.json`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-2026-07-12.md`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-evidence-2026-07-12.md`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-url-inventory-2026-07-12.csv`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-internal-links-2026-07-12.csv`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-redirect-inventory-2026-07-18.csv`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-18/agriko-topical-map-compilation-contract-2026-07-18.json`

**Interfaces:**
- Produces a complete immutable revision-4 package with only two semantic rule changes.
- Consumes the active six artifacts and existing manifest/contract.

- [ ] **Step 1: Write failing contract provenance test**

Replace the fixed authored-date enum with an ISO date constrained not to predate the original evidence:

```ts
expect(parseCompilationContract({
  ...validContract(),
  rules: [{ ...validContract().rules[0], provenance: {
    projection: "exact_redirect_inventory_row",
    authoredAt: "2026-07-18",
  }}],
})).toBeTruthy();
```

Reject malformed dates.

- [ ] **Step 2: Run RED test and implement the minimal schema change**

Run:

```bash
npm test -- __tests__/lib/topical-map/contract.test.ts
```

Expected: fail on `2026-07-18`.

Use `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` for `authoredAt`; run again and expect pass.

- [ ] **Step 3: Write the deterministic amendment script**

The script must:

1. create `docs/seo/packages/2026-07-18/`, copy the four unchanged source artifacts byte-for-byte, and write the changed redirect CSV, contract, and canonical `strategy-package-manifest.json` inside that isolated package root;
2. change only redirect IDs `495706833122` and `495706865890` to required action `retain live page as owner; remove redirect record`;
3. recompute both CSV row fingerprints, rule IDs, coverage IDs, rule source references, source fingerprints, payloads, resolution status `resolved`, and provenance date `2026-07-18`;
4. set contract revision `4` and strategy version `2026-07-18`;
5. update all artifact SHA-256 values, approval timestamp/identity/scope, and package SHA-256;
6. leave `liveExecutionAuthorized:false`, `canonicalIndexationExecutionProhibited:true`, and `task3Authorized:false`;
7. assert exactly two semantic rules changed before writing.

The script exits nonzero if any source hash differs from the active package or if the output differs outside the allowlist.

- [ ] **Step 4: Generate and validate the package locally**

Run:

```bash
node /home/sean/Agriko/shopify-theme/scripts/build-p0-topical-map-amendment.mjs
npm test -- __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/compiler.test.ts __tests__/lib/topical-map/validator.test.ts
```

Expected: all pass; revision 4 contains 1,493 rules, 853 coverage units, zero ambiguities, and only the two intended semantic changes.

- [ ] **Step 5: Commit both repositories**

Autopilot:

```bash
git add lib/topical-map/contract.ts __tests__/lib/topical-map/contract.test.ts
git commit -m "fix(topical-map): accept current provenance dates"
```

Theme:

```bash
git -C /home/sean/Agriko/shopify-theme add scripts/build-p0-topical-map-amendment.mjs docs/seo/packages/2026-07-18
git -C /home/sean/Agriko/shopify-theme commit -m "docs(seo): approve recipe hub redirect cleanup"
```

---

### Task 6: Full Verification, Deployment, Governed Execution, and Task Closure

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/architecture.md`
- Modify: `.mex/context/decisions.md`
- Modify: `.mex/patterns/strategy-bound-seo-command-center.md`
- Modify: `docs/planning-metrics.csv`
- Modify: `/home/sean/Agriko/shopify-theme/docs/seo/seo-due-task-evidence-2026-07-18.md`
- Modify: `/home/sean/Agriko/shopify-theme/docs/seo/seo-release-annotations.csv`

**Interfaces:**
- Consumes all code/package outputs and existing authenticated import/activation, Store Task approval, executor, and SEO task APIs.
- Produces verified production state and audited completion.

- [ ] **Step 1: Run the full local verification gate**

Run:

```bash
npm test
npm run typecheck
npm run typecheck:test
npm run lint
npm run build
npm run db:generate
npm run verify:prisma-client
git diff --check
```

Expected: zero failures/errors and no generated-client drift.

- [ ] **Step 2: Capture rollback evidence**

Before any live write, export:

- the six exact redirect records;
- every affected Shopify resource ID, URL, body HTML, `updatedAt`, and state hash;
- active strategy version/package hash;
- all pending task/recommendation IDs and proposed-state hashes.

Store bounded evidence in the existing theme `.seo-cache/shopify-backups/` location; do not commit body backups.

- [ ] **Step 3: Push and deploy the verified Autopilot commit**

Use the existing deployment runbook. Require:

- origin commit equals local behavior commit;
- server commit equals origin;
- active build was produced from that commit;
- PM2 restarted after the build with zero unstable restarts;
- public `/api/health` returns `ok`;
- all migrations remain current.

- [ ] **Step 4: Validate, import, and activate revision 4**

Copy the complete generated package directory to the production server-only `TOPICAL_MAP_STRATEGY_ROOT` as one atomic prepared directory, point the configured root at that directory using the existing environment-update/deployment runbook, and use the existing authenticated topical-map package lifecycle. Record:

- validation with six artifacts, 1,493 rules, 853 coverage units, zero issues;
- immutable imported version ID and package SHA-256;
- audited activation actor/reason;
- read-back showing revision 4 as the sole active pointer.

- [ ] **Step 5: Synchronize and inspect exact tasks**

Run the existing Store Task synchronization. Require:

- exactly four `redirect_update` tasks for the named chains;
- exactly two `redirect_delete` tasks for the recipe hubs;
- replacement tasks only for resources satisfying the three-way graph intersection;
- no executable task outside the P0 scope;
- every task linked to one pending Recommendation.

If counts or identities differ, stop before approval.

- [ ] **Step 6: Approve and execute through the governed path**

Approve the exact scoped Store Tasks through the authenticated Apply route, verify the Recommendation statuses are `approved`, and run `execute-approved` with the production live flag. Do not call Shopify directly.

Require one verified receipt per changed object and terminal `executed`/`completed` states.

- [ ] **Step 7: Re-crawl and close only on complete evidence**

Verify:

- four sources have one redirect hop to the exact final targets;
- both recipe pages return direct `200`, self-canonical responses and their redirect IDs are absent;
- zero rendered links target the seven legacy sources;
- `/blogs/news/turmeric-complete-benefits` remains a one-hop redirect to the live guide;
- the two duplicate drafts remain unpublished;
- no unrelated Shopify or Meta object changed.

Only then complete SEO task `cmrpedh9l0002s6sbjp34ywyq` through `/api/seo/tasks/[id]` with version concurrency and an evidence note.

- [ ] **Step 8: Record GROW evidence and commit documentation**

Update the listed GROW files with actual commits, build ID, PM2 time, health, strategy identity, task/recommendation receipts, crawl results, and exact exclusions. Run:

```bash
mex log --type decision "Activated the scoped revision-4 recipe-hub redirect decision and completed only the exact governed P0 redirect/link repairs after approved Shopify execution and crawl verification."
git diff --check
```

Commit documentation separately.
