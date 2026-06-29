# Agriko SEO & Information Architecture Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the structural SEO and information-architecture problems on agrikoph.com (Shopify) — broken/duplicate handles, missing rice Product schema, keyword cannibalization, collection sprawl, naming inconsistency — and build the missing turmeric content cluster, without re-pointing the ~65 recipe CTAs that already work.

**Architecture:** Changes land in three systems: (1) **Shopify admin** (product titles/handles, collection settings, URL redirects, metafields), (2) the **Shopify theme** at `/mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme` (Product JSON-LD snippet for the two rice products, recipe-template footer link fix), and (3) **content production** (blog consolidation + new turmeric articles). Each task is independently shippable and independently verifiable via HTTP status checks, Google's Rich Results Test, and Search Console.

**Tech Stack:** Shopify (Online Store 2.0), Liquid, JSON-LD structured data, Shopify URL Redirects, Google Search Console, Google Rich Results Test.

## Global Constraints

- **English-only content.** All AI-generated and published copy must be in English (per project rule). The `beras coklat organik` post violates this — Task 9.
- **"5-in-1" is the canonical form** of the blend name everywhere — never `5n1` or `5N1` in display copy or new slugs.
- **Weight unit format:** lowercase, no trailing period, consistent multiplication sign — `3kg`, `500g`, `180g`, `450g`, `20g × 10`. Never `3 Kg.`, `3Kg`, `3 KG`.
- **Canonical rice handles stay `philippines-organic-black-rice` and `philippines-organic-red-rice`** — verified in use by ~65 recipe CTAs. Do NOT migrate to cleaner handles.
- **No fake review markup.** `aggregateRating` JSON-LD must reflect *real* stored review counts/values. If the "4.9 / 128 reviews" shown on the rice pages is not backed by real review records, do NOT emit `aggregateRating` (Google manual-action risk).
- **301, never delete.** Every retired URL gets a 301 to its canonical replacement (except the wrong-market post, which is `noindex` + rewrite or 410 — Task 9).
- **One H1 per page, and H1 = human-readable product/page name** (not the SEO `<title>` string).

---

## Reference Appendices (full content used by tasks)

### Appendix A — Product JSON-LD for the two rice pages (Task 2)

Currently `philippines-organic-black-rice` and `philippines-organic-red-rice` emit **only** BreadcrumbList JSON-LD — they are the only 2 of 13 products with no Product/Offer/AggregateRating schema. All other products already render full Product schema, so the theme almost certainly has a working snippet that these two are being excluded from (a conditional, an app coverage gap, or a per-product metafield flag). **Investigate why before adding a parallel snippet** (Task 2, Step 1) to avoid double-emitting Product schema.

**A.1 — Liquid snippet (preferred — drop into the product template so values stay dynamic).** Save as `snippets/product-jsonld.liquid` (or reuse the existing one if found) and render it on the product template:

```liquid
{%- comment -%} snippets/product-jsonld.liquid — emits Product schema for the current product {%- endcomment -%}
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": {{ product.title | json }},
  "image": [
    {%- for image in product.images limit: 3 -%}
      {{ image | image_url: width: 1200 | prepend: "https:" | json }}{%- unless forloop.last -%},{%- endunless -%}
    {%- endfor -%}
  ],
  "description": {{ product.description | strip_html | truncatewords: 50 | json }},
  "sku": {{ product.selected_or_first_available_variant.sku | json }},
  "brand": { "@type": "Brand", "name": "Agriko" },
  "url": {{ shop.url | append: product.url | json }},
  "offers": {
    "@type": "Offer",
    "priceCurrency": {{ shop.currency | json }},
    "price": "{{ product.price | divided_by: 100.0 }}",
    "availability": "{% if product.available %}https://schema.org/InStock{% else %}https://schema.org/OutOfStock{% endif %}",
    "url": {{ shop.url | append: product.url | json }},
    "priceValidUntil": "{{ 'now' | date: '%Y' | plus: 1 }}-12-31"
  }
  {%- assign rc = product.metafields.reviews.rating_count -%}
  {%- assign ra = product.metafields.reviews.rating -%}
  {%- if rc and rc != blank and rc != 0 -%},
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "{{ ra }}",
    "reviewCount": "{{ rc }}"
  }
  {%- endif -%}
}
</script>
```

> The `aggregateRating` block self-suppresses when no real review metafield exists — satisfying the "no fake review markup" constraint. Adjust the metafield namespace/keys (`reviews.rating_count`, `reviews.rating`) to whatever the store's review app actually writes (Judge.me, Shopify Product Reviews, etc. — confirm in Step 1).

**A.2 — Static reference (exact values, for validation only).** These are the values currently displayed on-page; use them to sanity-check the rendered output:

```json
// Black Rice — https://agrikoph.com/products/philippines-organic-black-rice
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "Organic Black Rice",
  "brand": { "@type": "Brand", "name": "Agriko" },
  "url": "https://agrikoph.com/products/philippines-organic-black-rice",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "PHP",
    "price": "540.00",
    "availability": "https://schema.org/InStock"
  }
  // + "aggregateRating": { "ratingValue": "4.9", "reviewCount": "128" }  ← ONLY if real
}
```
```json
// Red Rice — https://agrikoph.com/products/philippines-organic-red-rice
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "Organic Red Rice",
  "brand": { "@type": "Brand", "name": "Agriko" },
  "url": "https://agrikoph.com/products/philippines-organic-red-rice",
  "offers": { "@type": "Offer", "priceCurrency": "PHP", "price": "540.00", "availability": "https://schema.org/InStock" }
  // + aggregateRating ONLY if real
}
```

### Appendix B — Canonical / 301 Redirect Map (Task 3, 7, 8, 9)

Create these in **Shopify admin → Online Store → Navigation → URL Redirects** (or via the Admin API `urlRedirect` resource). Revised from the original audit: rice **handles stay `philippines-organic-*`** because the recipe CTAs already point there.

| # | From (retire) | To (canonical) | Type | Reason | Status today |
|---|---|---|---|---|---|
| R1 | `/products/red-rice` | `/products/philippines-organic-red-rice` | 301 | Dead link in rice posts | **404 (broken)** |
| R2 | `/products/black-rice` | `/products/philippines-organic-black-rice` | 301 | Duplicate handle serving same product | Resolves (200) |
| R3 | `/products/organic-red-rice` | `/products/philippines-organic-red-rice` | 301 | Stray handle referenced in `/pages/guide-to-organic-rice` | Verify (may 404) |
| R4 | `/products/organic-black-rice` | `/products/philippines-organic-black-rice` | 301 | Stray handle | Verify |
| R5 | `/collections/filipino-organic-rice` | `/collections/organic-rice` | 301 | Near-duplicate, reuses boilerplate desc, 2 same SKUs | 200 |
| R6 | `/blogs/news/red-rice-from-the-philippines-benefits-cooking-tips-and-where-to-buy` | `/blogs/news/red-rice-philippines` | 301 | Near-duplicate "red rice philippines" intent | 200 |
| R7 | `/pages/guide-to-organic-rice` | `/blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide` | 301 | Duplicate "benefits/types" guide; keep the exact-match-title blog as pillar | 200 |
| R8 | `/blogs/news/why-choose-beras-coklat-organik-your-guide-to-organic-brown-rice` | (see Task 9) | noindex→rewrite **or** 410 | Wrong-market (Indonesian/Malay), violates English-only rule | 200 |

**Canonical owners after consolidation (keep, do NOT redirect):**
- "organic rice philippines" → `/blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide` (pillar)
- "where to buy organic rice philippines" → `/blogs/news/where-to-buy-organic-rice-in-the-philippines` (distinct transactional intent; link *up* to pillar)
- "black rice philippines" → `/blogs/news/black-rice-philippines` (money page)
- "best black rice brands philippines" → `/blogs/news/how-to-choose-the-best-black-rice-brands-in-the-philippines` (comparison intent; link up)
- "red rice philippines" → `/blogs/news/red-rice-philippines` (money page)
- "black rice vs red rice" → `/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice` (comparison; links to both money pages)
- Commercial → `/collections/organic-rice`

### Appendix C — Product naming standardization map (Task 5)

| Canonical handle (unchanged) | Current H1 | New H1 / product title | Notes |
|---|---|---|---|
| `5-in-1-turmeric-tea-powder` | Organic 5-in-1 Turmeric Tea Powder Blend | **Organic 5-in-1 Turmeric Tea Blend** | drop redundant "Powder" |
| `cacao-with-5n1-with-turmeric-blend` | Cacao with 5-in-1 with Turmeric Blend | **Organic 5-in-1 Turmeric Cacao Blend** | fix double "with" |
| `roasted-black-rice` | Roasted Black Rice with 5-in-1 Tea Powder Blend | **Roasted Black Rice 5-in-1 Tea Blend** | shorten; disambiguate from grain |
| `turmeric-tea-powder-blend` | Turmeric Tea Powder Blend | **Organic Turmeric Tea Blend** | add "Organic", drop "Powder" |
| `ginger-tea-powder-blend` | Ginger Tea Powder Blend | **Organic Ginger Tea Blend** | add "Organic", drop "Powder" |
| `pure-turmeric` | Pure Turmeric | **Pure Turmeric Powder** | match Blue Ternate |
| `pure-ginger` | Pure Ginger | **Pure Ginger Powder** | match Blue Ternate |
| `pure-blue-ternate-powder` | Pure Blue Ternate Powder | *(unchanged)* | reference pattern |
| `5n1-power-shot` | 5-in-1 Power Shot | **Organic 5-in-1 Power Shot** | one "5-in-1" form |
| `philippines-organic-black-rice` | Organic Black Rice | **Organic Black Rice – 3kg** | unit format |
| `philippines-organic-red-rice` | Organic Red Rice | **Organic Red Rice – 3kg** | unit format |
| `agribata-kids-cereal-mix` | Agribata Kids Cereal Mix | *(unchanged)* | sub-brand line |
| `organic-pure-honey` | Organic Pure Honey | *(unchanged)* | reference pattern |

### Appendix D — Turmeric Content Cluster Briefs (Task 11)

**Pillar (exists, keep):** `/blogs/news/turmeric-complete-benefits` (~2,650 words). Every brief below links **up** to this pillar and **out** to the relevant product(s). Money products: `5-in-1-turmeric-tea-powder` (₱325, flagship, 187 reviews) and `pure-turmeric` (₱250).

**D1 — Golden Milk (Turmeric Latte) Recipe**
- **URL:** `/blogs/recipes/turmeric-golden-milk-latte`
- **Target keyword:** "golden milk recipe" / "turmeric latte" (PH)
- **Intent:** Informational → product
- **`<title>`:** `Golden Milk Recipe: Filipino Turmeric Latte | Agriko`
- **H1:** Golden Milk: A Warm Turmeric Latte Recipe
- **Word count:** 900–1,200
- **H2 outline:** What is golden milk · Ingredients (link Pure Turmeric Powder + 5-in-1 Tea) · Step-by-step · Dairy-free variation · Benefits (link pillar) · FAQ
- **Internal links:** up → `turmeric-complete-benefits`; out → `pure-turmeric`, `5-in-1-turmeric-tea-powder`
- **Schema:** Recipe + (optional) FAQPage
- **CTA:** "Shop Agriko 5-in-1 Turmeric Tea →" → `/products/5-in-1-turmeric-tea-powder`

**D2 — Salabat & Turmeric Tea: The Filipino Wellness Drink**
- **URL:** `/blogs/news/turmeric-tea-benefits-philippines`
- **Target keyword:** "turmeric tea benefits" (commercial-informational)
- **`<title>`:** `Turmeric Tea Benefits: A Filipino Wellness Guide | Agriko`
- **H1:** Turmeric Tea Benefits: Why Filipinos Are Brewing Daily
- **Word count:** 1,400–1,800
- **H2 outline:** What's in a cup · 7 evidence-based benefits · Salabat vs turmeric tea · How to brew · 5-in-1 blend explained (link product) · Safety/dosage (link D4) · FAQ
- **Internal links:** up → pillar; sibling → D1, D3, D4; out → `5-in-1-turmeric-tea-powder`, `turmeric-tea-powder-blend`, `ginger-tea-powder-blend`
- **Schema:** Article + FAQPage
- **CTA:** primary money-page CTA → `/products/5-in-1-turmeric-tea-powder`

**D3 — Turmeric vs Ginger: Which Should You Take?**
- **URL:** `/blogs/news/turmeric-vs-ginger`
- **Target keyword:** "turmeric vs ginger"
- **`<title>`:** `Turmeric vs Ginger: Benefits, Uses & Which to Choose | Agriko`
- **H1:** Turmeric vs Ginger: How They Compare
- **Word count:** 1,200–1,500
- **H2 outline:** Quick comparison table · Active compounds (curcumin vs gingerol) · Benefits head-to-head · Can you take both (→ 5-in-1) · How to use each · FAQ
- **Internal links:** up → pillar; out → `pure-turmeric`, `pure-ginger`, `5-in-1-turmeric-tea-powder`
- **Schema:** Article + FAQPage
- **CTA:** "Get both in one cup — Shop 5-in-1 →"

**D4 — How Much Turmeric Per Day? Dosage & Safety**
- **URL:** `/blogs/news/turmeric-dosage-safety`
- **Target keyword:** "how much turmeric per day" / "turmeric dosage"
- **`<title>`:** `How Much Turmeric Per Day? Dosage & Safety Guide | Agriko`
- **H1:** How Much Turmeric Per Day? A Practical Dosage Guide
- **Word count:** 1,200–1,600
- **H2 outline:** Recommended daily amounts · Curcumin vs turmeric powder · Who should be cautious · Side effects & interactions · Best time to take · FAQ (FAQ schema — strong rich-result target)
- **Internal links:** up → pillar; out → `pure-turmeric`, `5-in-1-turmeric-tea-powder`
- **Schema:** Article + FAQPage
- **CTA:** → `/products/pure-turmeric`

**D5 — Turmeric for Inflammation & Joint Comfort**
- **URL:** `/blogs/news/turmeric-for-inflammation`
- **Target keyword:** "turmeric for inflammation" / "turmeric for joint pain"
- **`<title>`:** `Turmeric for Inflammation: What the Evidence Says | Agriko`
- **H1:** Turmeric for Inflammation: Uses, Evidence, and How to Take It
- **Word count:** 1,400–1,800
- **H2 outline:** How curcumin works · Evidence summary (cite studies, no medical claims) · Daily routines · Pairing with ginger/black pepper · Forms (tea vs powder vs shot — link 3 products) · Safety (→ D4) · FAQ
- **Internal links:** up → pillar; sibling → D4, D3; out → `5-in-1-turmeric-tea-powder`, `pure-turmeric`, `5n1-power-shot`
- **Schema:** Article + FAQPage
- **CTA:** → `/products/5n1-power-shot`

**Cluster wiring rule:** the pillar (`turmeric-complete-benefits`) gets a "Turmeric Guides" module linking down to D1–D5; each Dx links back up to the pillar and laterally to ≥2 siblings. Mirrors the rice cluster's working pattern.

---

## Task 1: Fix the broken `/products/red-rice` 404 and stray-handle redirects

**Files:**
- Modify (Shopify admin): Online Store → Navigation → URL Redirects
- Reference: Appendix B (R1–R4)

**Interfaces:**
- Produces: working 301s for all alternate rice handles → canonical `philippines-organic-*`. Tasks 11/recipe-fix rely on canonical handles resolving 200.

- [ ] **Step 1: Confirm current status of each alternate handle**

Run (from any shell):
```bash
for u in red-rice black-rice organic-red-rice organic-black-rice; do \
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "https://agrikoph.com/products/$u"; done
```
Expected: `red-rice -> 404`, `black-rice -> 200`; note actual codes for `organic-red-rice`/`organic-black-rice`.

- [ ] **Step 2: Create redirects R1–R4** in Shopify admin → Online Store → Navigation → URL Redirects ("Create URL redirect"), using the From/To pairs in Appendix B. Only create R3/R4 if Step 1 showed they exist or 404.

- [ ] **Step 3: Verify each redirect returns 301 to the canonical target**

Run:
```bash
for u in red-rice black-rice organic-red-rice organic-black-rice; do \
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://agrikoph.com/products/$u"; done
```
Expected: each prints `301 https://agrikoph.com/products/philippines-organic-(black|red)-rice`.

- [ ] **Step 4: Update the two in-content links that point to dead handles.** In Shopify admin → Content, edit `/pages/guide-to-organic-rice` and the blog post `red-rice-philippines`; change anchors pointing to `/products/red-rice` and `/products/organic-red-rice` to `/products/philippines-organic-red-rice` (and black equivalents). Save.

- [ ] **Step 5: Re-verify the edited pages contain no link to a 404**

Run:
```bash
curl -s https://agrikoph.com/pages/guide-to-organic-rice | grep -oE '/products/[a-z-]+' | sort -u
```
Expected: only `philippines-organic-*` rice handles appear (no bare `red-rice`/`organic-red-rice`).

---

## Task 2: Add Product JSON-LD to the two rice products

**Files:**
- Modify: `/mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme/` — product template + `snippets/product-jsonld.liquid` (Appendix A.1)
- Reference: Appendix A

**Interfaces:**
- Produces: valid Product + Offer (+ optional AggregateRating) JSON-LD on both rice product pages, matching the schema the other 11 products already emit.

- [ ] **Step 1: Find why the 2 rice products lack Product schema.** Search the theme for existing Product JSON-LD and any conditional/metafield gating it:
```bash
cd /mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme
rtk grep -rn "application/ld+json" sections snippets templates
rtk grep -rn "\"@type\": *\"Product\"\|'Product'" sections snippets templates
```
Expected: locate the snippet/section emitting Product schema for the other products. Determine the gating condition (product type, tag, metafield, or an app block the rice products miss).

- [ ] **Step 2: Decide patch site.** If an existing theme snippet emits it → remove the condition excluding rice (preferred). If schema comes from an app that doesn't cover these SKUs → add `snippets/product-jsonld.liquid` from Appendix A.1 and render it on the product template **only when the product has no app-injected Product schema** (avoid double emission).

- [ ] **Step 3: Confirm the review metafield namespace/keys.** Identify what the review app writes:
```bash
rtk grep -rn "rating\|reviews\." sections snippets templates | rtk grep -i "metafield"
```
Set the `aggregateRating` metafield keys in the snippet accordingly. If no real review metafield exists, leave the `aggregateRating` block (it self-suppresses) — do not hardcode 4.9/128.

- [ ] **Step 4: Implement** — apply the chosen patch from Appendix A.1.

- [ ] **Step 5: Validate rendered JSON-LD on a theme preview.** Push to a preview/unpublished theme, then run Google Rich Results Test on the preview URLs for both rice products.
Expected: "Product snippets" detected, **0 errors**; price `540.00 PHP`, availability InStock; `aggregateRating` present only if real.

- [ ] **Step 6: Publish and verify live**
```bash
curl -s https://agrikoph.com/products/philippines-organic-black-rice | grep -c '"@type": *"Product"'
curl -s https://agrikoph.com/products/philippines-organic-red-rice  | grep -c '"@type": *"Product"'
```
Expected: each `>= 1`.

- [ ] **Step 7: Request re-indexing** for both URLs in Google Search Console (URL Inspection → Request Indexing).

---

## Task 3: Consolidate the cannibalized "organic rice" cluster

**Files:**
- Modify (Shopify admin): Content → Pages, Blog posts; Navigation → URL Redirects
- Reference: Appendix B (R5–R7)

**Interfaces:**
- Consumes: canonical owners list in Appendix B.
- Produces: one canonical asset per head term; losers 301'd.

- [ ] **Step 1: Pre-capture rankings** for "organic rice philippines", "where to buy organic rice philippines" (Search Console → Performance → Query filter), so post-change impact is measurable. Record current impressions/clicks/avg position.

- [ ] **Step 2: Merge the duplicate guide.** Copy any unique content from `/pages/guide-to-organic-rice` into the pillar blog `organic-rice-philippines-benefits-varieties-complete-nutrition-guide`, then create redirect R7. Verify:
```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://agrikoph.com/pages/guide-to-organic-rice
```
Expected: `301 .../blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide`.

- [ ] **Step 3: Differentiate `where-to-buy` intent.** Edit `where-to-buy-organic-rice-in-the-philippines` so it is clearly transactional (retailers, store list, "shop online" CTA) and links *up* to the pillar with anchor "organic rice benefits & varieties". Keep it indexed.

- [ ] **Step 4: Add a self-referencing canonical** on the pillar and `where-to-buy` posts (Shopify theme renders `<link rel="canonical">` by default — confirm each points to itself):
```bash
curl -s https://agrikoph.com/blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide | grep -i 'rel="canonical"'
```
Expected: canonical = the page's own URL.

- [ ] **Step 5: Verify no internal links still point to the retired guide path**
```bash
curl -s https://agrikoph.com/collections/organic-rice | grep -c '/pages/guide-to-organic-rice'
```
Expected: `0` (update any that remain to the pillar URL).

---

## Task 4: Consolidate red-rice & black-rice cannibalization

**Files:**
- Modify (Shopify admin): Blog posts; Navigation → URL Redirects
- Reference: Appendix B (R6) + canonical owners list

**Interfaces:**
- Produces: single money page per "red/black rice philippines"; comparison posts retargeted and linked up.

- [ ] **Step 1: 301 the duplicate red-rice article** — create redirect R6 (`red-rice-from-the-philippines-...` → `red-rice-philippines`). Before redirecting, port any unique cooking-tips content into `red-rice-philippines`. Verify:
```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://agrikoph.com/blogs/news/red-rice-from-the-philippines-benefits-cooking-tips-and-where-to-buy"
```
Expected: `301 .../blogs/news/red-rice-philippines`.

- [ ] **Step 2: Retarget the "best black rice brands" post.** Edit `how-to-choose-the-best-black-rice-brands-in-the-philippines` so its angle is explicitly *buying/comparison* ("how to choose", criteria, brand comparison incl. Agriko) rather than re-defining "black rice philippines". Add an up-link to `black-rice-philippines` (anchor "best organic black rice in the Philippines").

- [ ] **Step 3: De-brand the money-page H1s.** Edit `black-rice-philippines` and `red-rice-philippines`: set H1 to a human heading ("Black Rice in the Philippines: Buyer's Guide") — currently the H1 reproduces the full `<title>` including "— Certified Organic Farm-Grown | Agriko". Keep the `<title>` as-is.

- [ ] **Step 4: Ensure both money pages link to the canonical rice product** (not only to turmeric/5-in-1). Confirm:
```bash
curl -s https://agrikoph.com/blogs/news/black-rice-philippines | grep -oE '/products/[a-z-]+' | sort -u
```
Expected: includes `/products/philippines-organic-black-rice`.

- [ ] **Step 5: Verify the comparison post links to both money pages**
```bash
curl -s "https://agrikoph.com/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice" | grep -oE '/blogs/news/(black|red)-rice-philippines' | sort -u
```
Expected: both `black-rice-philippines` and `red-rice-philippines` present.

---

## Task 5: Standardize product naming, H1s, and weight units

**Files:**
- Modify (Shopify admin): Products (title + SEO listing); theme product template only if H1 ≠ `product.title`
- Reference: Appendix C + Global Constraints

**Interfaces:**
- Consumes: naming map (Appendix C).
- Produces: consistent product titles; H1 = product title on all 13; uniform unit format.

- [ ] **Step 1: Confirm the product template renders H1 from `product.title`.**
```bash
cd /mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme
rtk grep -rn "product.title" sections templates | rtk grep -i "h1\|<h1"
```
Expected: H1 outputs `product.title`. If it outputs a separate metafield/SEO string, that's the source of H1 ≠ title — note it; fixing the titles in Step 2 then also fixes H1s.

- [ ] **Step 2: Rename products** per Appendix C in Shopify admin → Products (do NOT change handles; renaming title does not change handle in Shopify). Apply uniform unit format (`3kg`, `500g`, `20g × 10`, `450g`) in titles and variant option labels.

- [ ] **Step 3: Standardize collection product-card labels** that hardcode units (e.g. "Organic Black Rice 3Kg" / "- 3 Kg.") — these come from `product.title`, so Step 2 fixes them. Verify on the homepage:
```bash
curl -s https://agrikoph.com/ | grep -oE 'Organic (Black|Red) Rice[^<]*' | sort -u
```
Expected: only the new `Organic Black Rice – 3kg` / `Organic Red Rice – 3kg` form appears (no `3 Kg.`/`3Kg`/`3 KG`).

- [ ] **Step 4: Verify H1 now equals product title** on a renamed product:
```bash
curl -s https://agrikoph.com/products/5-in-1-turmeric-tea-powder | grep -oE '<h1[^>]*>[^<]*</h1>'
```
Expected: H1 text = "Organic 5-in-1 Turmeric Tea Blend".

---

## Task 6: Rebuild collections — kill padding, add descriptions + titles + meta

**Files:**
- Modify (Shopify admin): Collections (members, title, description, SEO listing, indexability)
- Reference: §8 of the audit + Global Constraints

**Interfaces:**
- Produces: ~5 indexable, well-described collections; thin/merch collections `noindex`; rice padding removed.

- [ ] **Step 1: Remove rice padding** from `organic-blends`, `powders`, `pure-powders`, `kids-cereal`, `organic-honey` — remove the 2 rice SKUs from each (they belong only in `organic-rice`/`shop-all`). For automated collections, fix the rule; for manual, remove the products.

- [ ] **Step 2: Apply redirect R5** (`filipino-organic-rice` → `organic-rice`) from Appendix B and remove `filipino-organic-rice` from navigation. Verify:
```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://agrikoph.com/collections/filipino-organic-rice
```
Expected: `301 .../collections/organic-rice`.

- [ ] **Step 3: Write a unique 50–100 word description + `<title>` + meta description** for each keeper collection: `organic-rice`, `organic-blends` (rename concept to "Herbal Teas & Blends"), `pure-powders`, `organic-honey`, `agribata-kids`. Remove the reused boilerplate string "Small-batch turmeric and rice blends grown without chemicals, made for real Filipino homes." everywhere it appears as a description.

- [ ] **Step 4: Set thin/merchandising collections to `noindex`** — `home-page-featured`, `kids-cereal` (until ≥3 SKUs), `organic-honey` (until ≥3 SKUs), and the overlapping `powders` if merged into `pure-powders`. Use the theme's SEO setting or a `noindex` meta on those collection templates.

- [ ] **Step 5: Verify each keeper collection now has title + meta description**
```bash
for c in organic-rice organic-blends pure-powders organic-honey; do \
  echo "== $c =="; curl -s "https://agrikoph.com/collections/$c" | grep -oE '<title>[^<]*</title>|name="description" content="[^"]*"'; done
```
Expected: every keeper prints a non-empty `<title>` and a `description` meta; none shows the boilerplate string.

---

## Task 7: Fix templated recipe-footer links (verification-gated)

**Files:**
- Modify: theme recipe/article template (the "Keep Reading" module rendered across ~65 recipe posts)
- Reference: §7 correction

**Interfaces:**
- Consumes: confirmation that the recipe→product CTAs are already correct (verified — they point to `philippines-organic-*`).
- Produces: zero 404s in the shared recipe footer module.

- [ ] **Step 1: Verify the two suspect templated links resolve.**
```bash
for u in /blogs/news/health-benefits-organic-rice /blogs/recipes/black-rice-pilaf-herbs; do \
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "https://agrikoph.com$u"; done
```
Expected: capture real codes. If either is `404`, proceed; if both `200`, skip Steps 2–4 (no fix needed) and record that the footer is clean.

- [ ] **Step 2: Locate the hardcoded links in the theme.**
```bash
cd /mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme
rtk grep -rn "health-benefits-organic-rice\|black-rice-pilaf-herbs" sections snippets templates
```
Expected: find the "Keep Reading" module with these literal hrefs.

- [ ] **Step 3: Correct the slugs** — `health-benefits-organic-rice` → an existing post (`/blogs/news/organic-rice-benefits-why-philippine-organic-rice-is-a-smart-choice` or the pillar); `black-rice-pilaf-herbs` → `black-rice-pilaf-with-herbs`.

- [ ] **Step 4: Re-verify across a sample of recipe posts**
```bash
for u in black-rice-champorado black-rice-poke-bowl red-rice-sinangag; do \
  echo "== $u =="; curl -s "https://agrikoph.com/blogs/recipes/$u" | grep -oE '/blogs/(news|recipes)/[a-z-]+' | sort -u \
  | while read p; do printf '  %s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://agrikoph.com$p"; done; done
```
Expected: every linked path returns `200`.

---

## Task 8: Add collection-level structured data + breadcrumbs

**Files:**
- Modify: theme collection template/snippet (CollectionPage + BreadcrumbList JSON-LD)

**Interfaces:**
- Produces: CollectionPage + BreadcrumbList schema on keeper collections.

- [ ] **Step 1: Check existing collection schema.**
```bash
cd /mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme
rtk grep -rn "BreadcrumbList\|CollectionPage\|ItemList" sections snippets templates
```
Expected: identify whether collections already emit Breadcrumb (products do). Reuse the pattern.

- [ ] **Step 2: Add CollectionPage + BreadcrumbList** to the collection template for indexable collections (Home → Collection breadcrumb trail).

- [ ] **Step 3: Validate** one collection in Google Rich Results Test (preview theme). Expected: Breadcrumb detected, 0 errors.

---

## Task 9: Resolve the wrong-market "beras coklat organik" post

**Files:**
- Modify (Shopify admin): blog post `why-choose-beras-coklat-organik-...`; Navigation → URL Redirects
- Reference: Global Constraints (English-only) + Appendix B (R8)

**Interfaces:**
- Produces: no Indonesian/Malay-targeted page on the PH `.com`.

- [ ] **Step 1: Decide disposition.** Default: **rewrite** to PH-English brown-rice intent ("Organic Brown Rice Philippines: Benefits & Where to Buy") since "organic brown rice philippines" is an uncovered, valuable term (competitors rank, Agriko has no brown-rice page). Alternative: 410 if no brown-rice content/SKU is planned.

- [ ] **Step 2a (rewrite path):** Replace title/H1/body with English brown-rice content; change handle to `/blogs/news/organic-brown-rice-philippines`; create 301 from the old beras handle to the new one.

- [ ] **Step 2b (deindex path):** If not rewriting now, set the post to `noindex` and remove from any navigation/related modules.

- [ ] **Step 3: Verify** the page no longer targets non-English keywords:
```bash
curl -s https://agrikoph.com/blogs/news/why-choose-beras-coklat-organik-your-guide-to-organic-brown-rice | grep -oiE 'beras|merah|hitam'
```
Expected: empty (rewrite) or `301`/`noindex` confirmed.

---

## Task 10: Measurement baseline & post-change monitoring

**Files:**
- External: Google Search Console, Google Analytics

**Interfaces:**
- Consumes: pre-change baselines captured in Tasks 3/4.

- [ ] **Step 1: Submit the updated sitemap** in GSC (Sitemaps → resubmit `sitemap.xml`).

- [ ] **Step 2: Create a GSC Performance comparison view** for the head terms touched (organic/black/red rice philippines, where to buy, turmeric tea benefits). Record date of changes as the annotation.

- [ ] **Step 3: Confirm Coverage has no new 404s/redirect errors** 7–14 days post-change (GSC → Pages → Why pages aren't indexed).
Expected: redirected URLs move to "Page with redirect"; no "Not found (404)" for rice handles.

---

## Task 11: Build the turmeric content cluster

**Files:**
- Create (Shopify admin → Content → Blog posts): D1–D5 from Appendix D
- Modify: pillar `turmeric-complete-benefits` (add "Turmeric Guides" link module)

**Interfaces:**
- Consumes: briefs D1–D5 (Appendix D), canonical product handles.
- Produces: pillar + 5 supporting posts, fully interlinked, each linking to ≥1 turmeric product.

- [ ] **Step 1: Draft D2 first** (`turmeric-tea-benefits-philippines`) — highest commercial value; follow the brief exactly (title, H1, outline, internal links, FAQ schema, money-page CTA to `5-in-1-turmeric-tea-powder`).

- [ ] **Step 2: Draft D4** (`turmeric-dosage-safety`) — strongest FAQ rich-result target.

- [ ] **Step 3: Draft D1, D3, D5** per briefs.

- [ ] **Step 4: Add the "Turmeric Guides" module to the pillar** linking down to D1–D5; ensure each Dx links up to the pillar and to ≥2 siblings (mirror the rice cluster wiring).

- [ ] **Step 5: Verify cluster wiring and product links** for each new post:
```bash
for u in turmeric-tea-benefits-philippines turmeric-dosage-safety turmeric-vs-ginger turmeric-for-inflammation; do \
  echo "== $u =="; curl -s "https://agrikoph.com/blogs/news/$u" | grep -oE '/products/[a-z0-9-]+|/blogs/news/turmeric[a-z-]*' | sort -u; done
curl -s https://agrikoph.com/blogs/recipes/turmeric-golden-milk-latte | grep -oE '/products/[a-z0-9-]+' | sort -u
```
Expected: each post links up to `turmeric-complete-benefits`, laterally to siblings, and out to the briefed product(s).

- [ ] **Step 6: Validate FAQ/Recipe schema** for D1, D2, D4 in Google Rich Results Test. Expected: FAQ (and Recipe for D1) detected, 0 errors.

- [ ] **Step 7: Request indexing** for all new URLs in GSC.

---

## Self-Review

**Spec coverage** (against the 10 audit deliverables + 4 explicit asks):
- Product naming → Task 5 + Appendix C ✓
- URL structure / handles → Tasks 1, 3, 4, 6 + Appendix B ✓
- Content pillars / topical authority → Task 11 + Appendix D (turmeric); rice cluster consolidation Tasks 3–4 ✓
- Keyword cannibalization → Tasks 3, 4 ✓
- Collection/category SEO → Task 6 ✓
- Internal linking → Tasks 1, 4, 7 (recipe-link verification done; correction recorded) ✓
- E-commerce SEO / schema → Tasks 2, 8 + Appendix A ✓
- Competitive gap (brown rice, sizes) → Task 9 (brown rice); 1kg/2kg SKUs and bundles are **catalog/merchandising decisions deferred** (noted below) ✓
- 90-day roadmap → task ordering maps to Quick Wins (1,2,9) / Medium (3,4,5,6) / High (8,10,11) ✓
- **Explicit asks:** Product JSON-LD → Appendix A ✓ · 301 redirect map → Appendix B ✓ · Turmeric briefs → Appendix D ✓ · Recipe-link verification → done (Task 7 Step 1 gates the only remaining fix) ✓

**Deferred (out of scope for this plan — require merchandising/catalog decisions, not SEO edits):** adding 1kg/2kg rice trial SKUs, bundles/gift-set collection, store-locator city pages, low-GI/diabetic rice pillar. These are flagged in the audit's High-Impact section and should become a separate plan once Agriko confirms catalog changes.

**Placeholder scan:** No TBD/TODO; all redirects, names, slugs, briefs, and JSON-LD are concrete. Verification steps use real `curl`/Rich Results checks.

**Consistency:** Canonical rice handles `philippines-organic-black-rice` / `philippines-organic-red-rice` used uniformly (Appendices A, B; Tasks 1, 2, 4, 7). "5-in-1" form consistent. Product handles never changed (only titles) — consistent across Tasks 1–7.
