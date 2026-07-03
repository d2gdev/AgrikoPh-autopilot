# Phase 2 — SEO Meta Write-Back to Shopify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps in SEO meta write-back: a product-SEO write capability, hard length caps at the Shopify write boundary, a distinct audit action and correct UI labeling for seo-fix applies, and a documented, verified end-to-end loop.

**Architecture — scope correction from fact-finding (read this first):** The roadmap's premise ("On-Page Health flags meta problems and Content Pilot drafts seo-fix fixes, but nothing writes them to the store") is **stale**. The article write-back loop already exists end-to-end: On-Page Health promotes findings via `POST /api/seo/promote` (Zod + rate-limit + dedup) → seo-fix `ContentProposal` → AI draft (`generate-draft.ts`, `SeoFixDraft {metaTitle, metaDescription}`) → operator-clicked `POST /api/content-pilot/proposals/[id]/publish` (draft-status locking, idempotent seo-fix retry, audit log, post-publish re-index) → `publishSeoFix()` in `lib/content-pilot/publish-draft.ts:248` writes `global.title_tag`/`description_tag` metafields via `metafieldsSet` (ArticleUpdateInput has no `seo` field — the roadmap's `updateArticleSeo` already exists under this name). Therefore this phase does **NOT** build the roadmap's `apply-seo` route (it would duplicate the publish route's locking/audit/retry machinery) and does **NOT** build `updateArticleSeo`. What it builds is the genuine delta listed in the tasks.

**Tech Stack:** Next.js 14 App Router, Polaris, Prisma/PostgreSQL, Shopify Admin GraphQL **2025-01** (`shopifyFetch` in `lib/shopify-admin.ts` pins this), Zod, Vitest.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing in this phase touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, `GOOGLE_ADS_*` env vars, or skill 46. If any step appears to require it, stop and surface to the operator.
- Live Shopify writes remain **operator-clicked only** (the existing publish route pattern — the click is the approval; always audit-logged; not gated on `EXECUTE_APPROVED_LIVE_ENABLED`). This phase adds no autonomous write path.
- No Prisma migration. Additive code only.
- Mutation shapes were verified via the shopify-plugin doc search (the local validator is broken — `ENOENT supported-versions-schema.json`, matching the roadmap's note): `SEOInput = { title: String, description: String }`; `seo` exists on both `ProductInput` and `ProductUpdateInput`; `productByHandle(handle:)` is valid on 2025-01 (deprecated on newer versions in favor of `productByIdentifier` — irrelevant at this pin).
- All DB access via `import { prisma } from "@/lib/db"`. Embedded API routes start with `await requireAppAuth(req)`.
- Verify gate at the end: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean.
- After the phase: update `.mex/ROUTER.md`, commit + push to main. **No deploy checkpoint** — the next 🚀 in the master roadmap is after Phase 4; these changes ride along then (or earlier if the operator asks).

---

### Task 1: `updateProductSeo` in `lib/shopify-admin.ts`

**Files:**
- Modify: `lib/shopify-admin.ts`
- Test: `__tests__/lib/shopify-admin.test.ts`

**Interfaces:**
- Produces: `updateProductSeo(productId: string, seo: { title?: string; description?: string }): Promise<{ id: string; seo: { title: string | null; description: string | null } }>` — the roadmap-locked product write capability. **Deliberately not wired to any route or UI in this phase**: fact-finding found zero producers of product-targeted seo-fix proposals (every producer in `generate-proposals.ts` and `/api/seo/promote` sets `articleHandle`). The function exists so a future product-audit producer has a tested write path; wiring it blind now would be dead UI.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/shopify-admin.test.ts` (reuse the file's existing `vi.mock("@/lib/config/resolver")` + `global.fetch` mock setup — read the existing `describe("shopifyFetch")` block first and mirror its beforeEach):

```typescript
describe("updateProductSeo", () => {
  beforeEach(() => {
    vi.mocked(getSecret).mockImplementation(async (key: string) => {
      if (key === "SHOPIFY_STORE_DOMAIN") return "test.myshopify.com";
      if (key === "SHOPIFY_ADMIN_ACCESS_TOKEN") return "admin-token";
      throw new Error(`Unexpected key ${key}`);
    });
  });

  it("sends productUpdate with the seo input and returns the updated seo", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: { id: "gid://shopify/Product/1", seo: { title: "T", description: "D" } },
            userErrors: [],
          },
        },
      }),
    }) as unknown as typeof fetch;

    const result = await updateProductSeo("gid://shopify/Product/1", { title: "T", description: "D" });
    expect(result.seo.title).toBe("T");
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables.product).toEqual({ id: "gid://shopify/Product/1", seo: { title: "T", description: "D" } });
  });

  it("throws on userErrors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { productUpdate: { product: null, userErrors: [{ field: ["seo"], message: "Title too long" }] } },
      }),
    }) as unknown as typeof fetch;

    await expect(updateProductSeo("gid://shopify/Product/1", { title: "x" })).rejects.toThrow("Title too long");
  });
});
```

Add `updateProductSeo` to the file's import from `@/lib/shopify-admin`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/shopify-admin.test.ts`
Expected: FAIL — `updateProductSeo` is not exported.

- [ ] **Step 3: Implement**

Add after `updateProductMediaAlt` in `lib/shopify-admin.ts`, mirroring its house style exactly:

```typescript
export async function updateProductSeo(
  productId: string,
  seo: { title?: string; description?: string }
): Promise<{ id: string; seo: { title: string | null; description: string | null } }> {
  const mutation = `
    mutation UpdateProductSeo($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          seo {
            title
            description
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const data = await shopifyFetch<{
    productUpdate: {
      product: { id: string; seo: { title: string | null; description: string | null } } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, { product: { id: productId, seo } });

  const errors = data.productUpdate.userErrors;
  if (errors?.length) throw new Error(errors[0]!.message);
  const product = data.productUpdate.product;
  if (!product) throw new Error("Shopify returned no product in productUpdate response");
  return product;
}
```

(If 2025-01 rejects the `product: ProductUpdateInput` argument at runtime — it shouldn't; the arg exists at this version — fall back to `input: ProductInput` with the same `{ id, seo }` shape, which the doc search confirmed also carries `seo`. Adjust the test's `body.variables` assertion to match whichever form ships.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/shopify-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shopify-admin.ts __tests__/lib/shopify-admin.test.ts
git commit -m "feat(shopify-admin): updateProductSeo via productUpdate seo input"
```

---

### Task 2: Length caps at the write boundary (title ≤ 70, description ≤ 320)

**Files:**
- Modify: `lib/content-pilot/generate-draft.ts` (the `SeoFixDraft` Zod schema, ~lines 22–25)
- Test: `__tests__/lib/content-pilot/publish-draft.test.ts` and any generate-draft test asserting the schema

**Interfaces:**
- Consumes/guards: `getDraftSchema("seo-fix")` — fact-finding confirmed this single schema gates BOTH the AI generation parse and the publish-path parse (publish-draft.test.ts mocks `getDraftSchema`, proving `publishDraft` validates `draftContent` through it). One change covers AI output *and* operator edits. Today it is `min(1)` only — nothing stops a 500-char title reaching Shopify.

- [ ] **Step 1: Confirm the parse site**

Run: `rtk grep -n "getDraftSchema" lib/content-pilot/publish-draft.ts lib/content-pilot/generate-draft.ts` — confirm `publishDraft` (or its callee) parses `draftContent` with `getDraftSchema(proposal.proposalType)` before writing. If publish does NOT re-parse, add the same Zod caps directly inside `publishSeoFix` instead (write-boundary defense is the requirement; the schema is just the preferred single home).

- [ ] **Step 2: Update the failing tests first**

In `__tests__/lib/content-pilot/publish-draft.test.ts`, the seo-fix schema is stubbed inside `vi.mock("@/lib/content-pilot/generate-draft")` — update the stub to match the new caps, and add a test asserting an over-length draft is rejected before any `shopifyFetch` call:

```typescript
        case "seo-fix":
          return z.object({
            metaTitle: z.string().trim().min(1).max(70),
            metaDescription: z.string().trim().min(1).max(320),
          });
```

```typescript
  it("rejects a seo-fix draft whose metaTitle exceeds 70 chars before any Shopify call", async () => {
    const proposal = makeProposal({
      proposalType: "seo-fix",
      draftContent: { metaTitle: "x".repeat(71), metaDescription: "ok description" },
    });
    await expect(publishDraft(proposal)).rejects.toThrow();
    expect(vi.mocked(shopifyFetch)).not.toHaveBeenCalled();
  });
```

(Reuse the file's existing proposal-fixture helper — read the file for its actual name/shape; if it's not called `makeProposal`, adapt. Follow the existing rejection-test style in that file.)

- [ ] **Step 3: Implement in `generate-draft.ts`**

Change the `SeoFixDraft` schema (~lines 22–25):

```typescript
  metaTitle: z.string().trim().min(1).max(70),
  metaDescription: z.string().trim().min(1).max(320),
```

The AI prompt already targets 50–60 / 140–160 chars, so generation is unaffected; the caps exist for operator edits and model drift. Check any generate-draft test asserting the old schema and update it identically.

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run __tests__/lib/content-pilot/publish-draft.test.ts __tests__/lib/content-pilot/ __tests__/api/content-pilot-draft-citations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/content-pilot/generate-draft.ts __tests__/lib/content-pilot/publish-draft.test.ts
git commit -m "feat(content-pilot): hard length caps on seo-fix meta (title<=70, desc<=320) at the write boundary"
```

---

### Task 3: Distinct audit action for seo-fix applies

**Files:**
- Modify: `app/api/content-pilot/proposals/[id]/publish/route.ts`

- [ ] **Step 1: Make the audit action type-specific**

In the publish route's success path (~line 121), the audit log currently writes `action: "published"` for every proposal type. Change to:

```typescript
        action: proposal.proposalType === "seo-fix" ? "seo_meta_applied" : "published",
```

(Use the route's in-scope proposal variable — `fresh` if that's what is in scope at the audit call; read the surrounding lines first. Everything else in the audit row stays identical.)

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit` and `npx vitest run __tests__/api/` — expect clean/green (no existing test asserts the audit action string; if one does, update it to expect the seo-fix variant only for seo-fix fixtures).

```bash
git add "app/api/content-pilot/proposals/[id]/publish/route.ts"
git commit -m "feat(content-pilot): distinct seo_meta_applied audit action for seo-fix publishes"
```

---

### Task 4: "Apply to store" labeling for seo-fix drafts

**Files:**
- Modify: `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`

- [ ] **Step 1: Conditional button label and success copy**

**Read the action area first** (~lines 585–745: the publish handler, the success banner at ~line 644, and the primary button at ~line 719). A seo-fix apply is not a blog publish, and the current copy says "Publish to Shopify" / "Published to Shopify." for it. With the proposal object already in scope, make the copy conditional:

- Button (~line 719): `{proposal?.proposalType === "seo-fix" ? "Apply to store" : "Publish to Shopify"}`
- Success message (~line 644): the seo-fix branch reads `"Applied to store — SEO title and meta description updated."`, other types keep `"Published to Shopify."`
- The existing `publishConfirm` modal stays as the confirm step (roadmap: "existing confirm-modal pattern"); if its body text says "publish", make that string conditional the same way.

No handler/endpoint changes — the button still POSTs to the same publish route.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit` and `npm run build` — expect clean.

```bash
git add "app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx"
git commit -m "feat(content-pilot): seo-fix drafts read Apply to store instead of Publish to Shopify"
```

---

### Task 5: Loop verification, ROUTER doc, final gate

**Files:**
- Modify: `.mex/ROUTER.md`

- [ ] **Step 1: Verify the end-to-end loop statically**

Confirm each hop with targeted greps and record the file:line chain in your report: On-Page Health UI promote (`app/(embedded)/(seo-pillar)/seo-pillar/page.tsx` `promotedOnPage`) → `POST /api/seo/promote` creates the seo-fix `ContentProposal` → `generate-draft.ts` produces `{metaTitle, metaDescription}` (now capped) → publish route locks + calls `publishDraft` → `publishSeoFix` writes `global.title_tag`/`description_tag` via `metafieldsSet` → proposal marked `published` with `seo_meta_applied` audit → `markContentProposalOpportunityResolved` closes the source opportunity. Live acceptance (an operator clicking Apply on one real article draft) is deliberately left to the operator — this phase must not exercise the write itself beyond unit tests.

- [ ] **Step 2: Update `.mex/ROUTER.md`**

Add a bullet to "Current Project State" (and bump `last_updated`):

```
- SEO meta write-back (Phase 2, 2026-07-XX): the article loop was already live (On-Page Health promote → seo-fix proposal → AI draft → operator publish → metafieldsSet global title_tag/description_tag in publishSeoFix); this phase added hard length caps at the write boundary (title ≤70, desc ≤320 in getDraftSchema("seo-fix")), a distinct seo_meta_applied audit action, "Apply to store" UI labeling for seo-fix drafts, and updateProductSeo in lib/shopify-admin.ts (productUpdate seo input — capability only; no product-targeted seo-fix producer exists yet, so it is intentionally unwired). The roadmap's apply-seo route and updateArticleSeo were NOT built — both already existed as the publish route and publishSeoFix respectively.
```

- [ ] **Step 3: Final verification gate**

Run: `npx tsc --noEmit` — no errors.
Run: `npm test` — all green (record counts).
Run: `npm run build` — clean.

- [ ] **Step 4: Commit and push**

```bash
git add .mex/ROUTER.md
git commit -m "docs(mex): record Phase 2 SEO meta write-back scope (delta over existing loop)"
git push origin main
```

No deploy in this phase (next checkpoint is after Phase 4).

---

## Self-review notes

- Roadmap coverage vs reality: `updateProductSeo` → Task 1 (built, unwired, reason documented); `updateArticleSeo` → already exists as `publishSeoFix` (not rebuilt); `apply-seo` route → already exists as the publish route with stronger machinery than the roadmap sketch (locking, idempotent retry, re-index) — not duplicated; Zod caps ≤70/≤320 → Task 2 at the single schema both paths parse; `AuditLog seo_meta_applied` → Task 3; "Apply to store" draft-page action + existing confirm modal → Task 4; loop verify + ROUTER doc → Task 5. Every roadmap bullet is either implemented or explicitly mapped to the existing implementation. ✔
- Mutation verification: local validator broken (ENOENT), per the roadmap's own warning; shapes confirmed via doc search — `SEOInput {title, description}`, `ProductUpdateInput.seo`/`ProductInput.seo`, `productByHandle` valid at the 2025-01 pin. Task 1 carries an explicit fallback if the `product:` argument form is rejected at runtime.
- No placeholders: code steps show real code against symbols read during fact-finding; the four read-before-edit spots (Task 2 Step 1 parse site, Task 2 fixture-helper name, Task 3 in-scope variable, Task 4 action area) are flagged with exactly what to look for.
- Type consistency: `updateProductSeo` return shape matches its test assertions; the capped schema in the test stub matches `generate-draft.ts` verbatim; the audit action string in Task 3 matches the ROUTER doc in Task 5.
- Keyword Planner surface untouched by every task; no migration; no autonomous write path added.
