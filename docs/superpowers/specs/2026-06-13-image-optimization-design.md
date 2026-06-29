# Image Optimization — Design Spec
**Date:** 2026-06-13  
**Project:** autopilot-app (seoai-3 Shopify embedded app)  
**Scope:** Add Image Optimization page (alt text audit + Claude generation) as a 6th screen

---

## Problem

The seoai-3 Shopify app and the autopilot-app are two separate Shopify embedded apps. The user must switch between them. The goal is one app with everything. Image Optimization (alt text) is the missing feature needed to make autopilot-app the complete replacement for seoai-3.

---

## Approach

Standalone `/images` page added to the existing autopilot-app. Option 1 selected.

---

## Architecture

```
app/(embedded)/images/page.tsx     ← Polaris UI page
app/api/images/route.ts            ← GET / POST / PUT handlers
lib/shopify-admin.ts               ← Shopify Admin GraphQL helpers
app/(embedded)/layout.tsx          ← nav: add "Images" between SEO and Settings
```

---

## Data Model

No new DB tables. All data comes from Shopify Admin API in real time.

Image record (runtime only):
```ts
{
  imageId: string       // Shopify media image GID
  productId: string     // Shopify product GID
  productTitle: string
  imageUrl: string      // CDN URL for thumbnail display
  altText: string | null
}
```

---

## API Routes — `app/api/images/route.ts`

### GET `/api/images`
- Calls `fetchProductImages()` from `lib/shopify-admin.ts`
- Returns `{ images: ImageRecord[], total: number, missingAltText: number }`

### POST `/api/images`
Body: `{ imageId, productId, imageUrl, productTitle }`  
- Calls OpenRouter (model from `OPENROUTER_MODEL` env) with:
  - System: "You are an SEO copywriter for Agriko (agrikoph.com), a Philippine health food brand. Write concise, keyword-rich alt text."
  - User: "Product: {productTitle}\nImage URL: {imageUrl}\nWrite alt text under 125 characters. Reply with ONLY the alt text, no quotes, no explanation."
- Returns `{ altText: string }`

### PUT `/api/images`
Body: `{ imageId, productId, altText }`  
- Calls `updateImageAltText(productId, imageId, altText)` from `lib/shopify-admin.ts`
- Writes to `auditLog`: actor=user, action=image_alt_text_updated, entityType=product_image, entityId=imageId
- Returns `{ ok: true }`

---

## Shopify Admin GraphQL — `lib/shopify-admin.ts`

### `fetchProductImages()`
GraphQL query — products with images, paginated (first 250 products, first 10 images each):
```graphql
{
  products(first: 250) {
    edges {
      node {
        id
        title
        media(first: 10) {
          edges {
            node {
              ... on MediaImage {
                id
                image { url altText }
              }
            }
          }
        }
      }
    }
  }
}
```
Uses `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN`.

### `updateImageAltText(productId, imageId, altText)`
GraphQL mutation — `productUpdateMedia`:
```graphql
mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
  productUpdateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id image { altText } } }
    userErrors { field message }
  }
}
```

---

## UI — `app/(embedded)/images/page.tsx`

- Polaris `Page` title "Image Optimization"
- **Stats banner** (InlineStack of Cards): "X total images", "Y missing alt text"
- **Page primaryAction**: "Generate All Missing" button — loops through all images with null/empty altText, calls POST sequentially, auto-applies
- **DataTable** columns: Product, Image (Thumbnail component), Alt Text, Actions
- Per-row state:
  - `generating: Set<imageId>` — shows spinner on Generate button
  - `applying: Set<imageId>` — shows spinner on Apply button  
  - `suggestions: Record<imageId, string>` — holds Claude suggestion before Apply
- If `suggestions[id]` exists: show editable TextField + Apply button
- If `altText` present: show text (truncated to 60 chars) + success Badge
- If `altText` empty/null: show `—` + critical Badge + Generate button
- Toast on Apply success/failure

---

## Navigation

`app/(embedded)/layout.tsx` — add to Navigation.Section items:
```ts
{ label: "Images", url: "/images", matches: pathname.startsWith("/images") }
```
Position: between SEO and Settings.

---

## Error Handling

- GraphQL errors → toast "Failed to load images"
- Claude failure per row → that row shows "Failed — retry" badge, Generate button re-enabled
- Shopify mutation userErrors → toast with Shopify's error message
- No silent failures

---

## Env Vars Required (all already set in `.env` on the Linode host)

- `SHOPIFY_STORE_DOMAIN` ✓
- `SHOPIFY_ADMIN_ACCESS_TOKEN` ✓
- `OPENROUTER_API_KEY` ✓
- `OPENROUTER_MODEL` ✓

---

## Verification

1. Images tab appears in nav alongside Dashboard, Recommendations, Campaigns, SEO, Settings
2. Page loads showing all product images with stats banner
3. Images with missing alt text show `—` badge + Generate button
4. Click Generate → Claude returns alt text suggestion in ~2s
5. Click Apply → Shopify product image alt text updates, audit log entry created
6. "Generate All Missing" runs through all missing images end-to-end
7. All existing tabs still work (no regressions)
8. After deploy, update seoai-3 App URL in Shopify Dev Dashboard to autopilot-app URL → one app in Shopify admin
