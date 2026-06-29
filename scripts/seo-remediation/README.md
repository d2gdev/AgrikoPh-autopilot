# Agriko SEO/IA Remediation — Runbook

Execution artifacts for the plan at
`docs/superpowers/plans/2026-06-24-agriko-seo-ia-remediation.md`.

**You run these; nothing here auto-applies.** Every script is **DRY-RUN by
default** and only mutates the live store when you pass `APPLY=1`.

---

## How the scripts reach the store

They call the app's `lib/shopify-admin.ts` (`shopifyFetch`), which resolves the
live Admin token **DB-first** and auto-refreshes on 401. That token lives in the
**prod DB**, so these scripts must run **on the prod server**, not locally
(the local `.env` token is stale → 401).

```bash
# 1) Get this code onto prod (your normal deploy, or a plain git pull on the box)
#    Must include scripts/seo-remediation/ AND scripts/seo-remediation/content/
ssh autopilot-prod
cd /opt/autopilot
git pull            # or however /opt/autopilot is updated

# 2) Every script: preview first (DRY), then apply
npx tsx scripts/seo-remediation/01-redirects.ts          # DRY preview
APPLY=1 npx tsx scripts/seo-remediation/01-redirects.ts  # apply for real
```

If `npx tsx` isn't found on prod, use `node_modules/.bin/tsx` or `npm exec tsx`.

---

## Order of operations

Run top-to-bottom. Tiers are by reversibility. Re-running any script is safe
(all are idempotent — they skip work already done).

### Tier 0 — Theme (deploy + validate before the data changes)
Branch `seo/rice-schema-cluster` in the **theme repo**
(`cinema/shopify-theme`) covers plan Tasks 2/7/8:
- Rice PDPs now emit Product+Offer JSON-LD (root cause: rice uses bespoke
  `product.rice-*` templates and the global `product-rich-snippet` wasn't
  passed `product:`). Fake `aggregateRating`/reviews removed (gated on real
  review metafields).
- Recipe "Keep Reading" link fixed.
- `<meta robots noindex,follow>` honored when `collection`/`article` metafield
  `seo.hidden` is truthy — this is what **04-collections.ts** sets.

**Do:** deploy that branch to the live theme (your normal theme push), then
validate both rice PDPs in Google Rich Results Test — expect Product detected,
**0 errors**, and **no** aggregateRating (rice has no real reviews):
- https://agrikoph.com/products/philippines-organic-black-rice
- https://agrikoph.com/products/philippines-organic-red-rice

> Deploy theme **before** Tier 2 collection noindex so the `seo.hidden` meta is
> honored when those collections get the metafield.

### Tier 1 — Redirects (fully reversible)
```bash
npx tsx        scripts/seo-remediation/01-redirects.ts
APPLY=1 npx tsx scripts/seo-remediation/01-redirects.ts
```
Creates R1–R7 (fixes the `/products/red-rice` 404, consolidates duplicates).
**Verify:**
```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://agrikoph.com/products/red-rice
# expect: 301 https://agrikoph.com/products/philippines-organic-red-rice
```
**Rollback:** delete the redirect(s) in Admin → Online Store → Navigation → URL Redirects.

### Tier 1 — Product renames (reversible)
```bash
npx tsx        scripts/seo-remediation/03-product-renames.ts
APPLY=1 npx tsx scripts/seo-remediation/03-product-renames.ts
```
Titles only; **handles never change** (script hard-asserts this). Appendix C names.
**Rollback:** re-run with old titles, or edit in Admin.

### Tier 2 — Collections (descriptions/SEO/noindex; some need manual follow-up)
```bash
npx tsx        scripts/seo-remediation/04-collections.ts
APPLY=1 npx tsx scripts/seo-remediation/04-collections.ts
```
Sets unique descriptions + SEO title/meta on keepers, sets `seo.hidden=true` on
thin/merch collections, and **removes the 2 rice SKUs from padded MANUAL
collections**. ⚠️ For any **AUTOMATED (smart)** collection it can't edit members
— it prints `MANUAL ACTION NEEDED: collection <h> is automated; adjust its
rules to exclude rice`. Do those by hand in Admin. Also apply redirect R5
(`filipino-organic-rice → organic-rice`) — included in 01-redirects.

### Tier 3 — Content (publishes new posts)
Content bodies are in `content/*.html` (must be on prod).
```bash
# 5 turmeric cluster posts (set const PUBLISH=false in the file first if you want drafts)
npx tsx        scripts/seo-remediation/05-blog-posts.ts
APPLY=1 npx tsx scripts/seo-remediation/05-blog-posts.ts

# rewrite the wrong-market "beras coklat organik" post → organic-brown-rice-philippines + 301
npx tsx        scripts/seo-remediation/06-beras-post.ts
APPLY=1 npx tsx scripts/seo-remediation/06-beras-post.ts
```
SEO title/description are written as the article `global.title_tag` /
`global.description_tag` metafields (the theme already reads these).
**Rollback:** unpublish/delete the articles in Admin; 06's handle change is
covered by the redirect it creates.

### Tier 4 — Search Console (manual, after the above is live)
1. Resubmit `https://agrikoph.com/sitemap.xml`.
2. URL-inspect → Request Indexing for: both rice PDPs, the 6 new/updated posts,
   and the consolidated pillars.
3. Record a baseline for: organic/black/red rice philippines, where-to-buy,
   turmeric tea benefits (Performance → Query filter) to measure impact.

---

## Source of truth
- `_data.ts` — all redirects, renames, collection specs, post metadata (edit here).
- `_lib.ts` — shared client/helpers (`APPLY`, `gql`, `assertNoUserErrors`, …).
- `content/*.html` — article bodies.

## Manual follow-ups the scripts can't do
- Adjust **automated** collection rules to drop rice padding (04 flags which).
- Differentiate `/blogs/news/where-to-buy-organic-rice...` as transactional and
  de-brand the `black-rice-philippines` / `red-rice-philippines` H1s (plan Task 4
  steps 2–3) — these are in-content edits, do in Admin.
- Port any unique copy from `/pages/guide-to-organic-rice` into the pillar
  before R7 takes it offline (plan Task 3 step 2).
