# SEO + Schema Report: Red Rice vs Black Rice

Analyzed: 2026-06-25T17:50:35Z
URL: https://agrikoph.com/blogs/news/red-rice-vs-black-rice-which-organic-grain-is-healthier-for-filipinos

## Score Card

Overall Score: 84/100

On-page SEO: 88/100
Content quality: 82/100
Technical: 82/100
Schema: 78/100
Images: 72/100

## What Is Already Working

- HTTP 200, indexable robots, self-referencing canonical, and `content-language: en-PH`.
- Strong search intent match for "red rice vs black rice", "black rice vs red rice", and Filipino organic rice comparison queries.
- One clear H1: "Red Rice vs Black Rice: Which Organic Grain Is Healthier for Filipinos?"
- Title and meta description are present and relevant.
- Open Graph and Twitter card tags are present.
- Existing `BlogPosting` and `BreadcrumbList` JSON-LD are parseable.
- The article includes direct internal links to both rice product pages and related rice articles.

## Priority Fixes

### High

1. Fix mismatched read-time and word-count signals.
   - Visible page says "1 min read".
   - Current `BlogPosting.wordCount` says `258`.
   - Parsed article section is about `859` words.
   - Recommended: update visible read time to `4 min read`, set `wordCount` to `859`, and keep `timeRequired` as `PT4M`.

2. Replace null/empty schema fields.
   - Current `BlogPosting.isPartOf.name` is `null`.
   - Current `BlogPosting.keywords` is an empty array.
   - Recommended: use `"Agriko Journal"` for the blog name and add meaningful keywords.

3. Add stable `@id` values and connect schema nodes with `@graph`.
   - Current schema is valid but lightly connected.
   - Recommended: use one JSON-LD graph with `Organization`, `WebSite`, `WebPage`, `BlogPosting`, and `BreadcrumbList`.

4. Add `inLanguage`, `about`, and `mentions`.
   - This helps disambiguate the page as an English Philippines article about organic red rice, organic black rice, whole grains, antioxidants, and Filipino farming.
   - Mention the two rice product pages by URL and product name without adding hidden offers to the article.

### Medium

5. Improve topical depth for nutrition intent.
   Add a concise comparison subsection covering:
   - Calories per cooked 100g serving range
   - Fiber range
   - Protein range
   - GI caveat: varies by variety, processing, portion, and cooking method
   - Antioxidant pigment difference: anthocyanins vs proanthocyanidins

6. Add expert review or source note.
   The page makes nutrition claims. Add an "Reviewed by" or "Sources" line if Agriko has a qualified reviewer, agronomist, nutritionist, or cited external source.

7. Add jump links near the top.
   The article has useful sections with IDs. Add a compact table of contents:
   - Short answer
   - Side-by-side comparison
   - Nutrition
   - Cooking
   - Why Philippine-grown organic rice matters

8. Add stronger internal links to cluster pages.
   Current related links are good. Add in-body contextual links to:
   - `/collections/organic-rice`
   - `/blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide`
   - `/blogs/news/red-rice-philippines`
   - `/blogs/news/organic-black-rice-philippines-nutritious-local-whole-grain`
   - `/pages/red-rice-recipes`
   - `/pages/black-rice-recipes`

### Low

9. Tighten the title length.
   Current title is 64 characters: "Red Rice vs Black Rice: Which Is Healthier? | Agriko Philippines"
   Better option: "Red Rice vs Black Rice: Which Is Healthier? | Agriko PH"

10. Improve OG image.
    Current OG image is a 640x640 PNG at about 771 KB.
    Recommended: a page-specific 1200x630 WebP/JPEG under 200 KB showing red rice and black rice side by side.

11. Add `decoding="async"` to lazy related-article images and footer logo where the theme allows it.

## Product Page Schema Issue Found While Checking Linked Targets

The linked rice PDPs currently expose `Product` schema, but they also expose `HowTo` and `FAQPage` JSON-LD:

- https://agrikoph.com/products/philippines-organic-red-rice
- https://agrikoph.com/products/philippines-organic-black-rice

Recommended:

- Remove `HowTo` JSON-LD from product pages.
- Remove `FAQPage` JSON-LD unless the site qualifies for Google's restricted FAQ rich result use cases.
- Keep Product + Offer schema, but only keep `aggregateRating` and `review` if those reviews are real, visible, and collected through a legitimate review flow.

## Ready-To-Use Files

Use `docs/seo-red-rice-vs-black-rice-generated-schema.json` as the recommended replacement/additional JSON-LD graph for this article page.

Implementation note: structured data should be in the initial server-rendered HTML, not injected after load.
