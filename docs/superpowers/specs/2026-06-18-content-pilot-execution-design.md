# Content Pilot — Draft Generation & Publish Design

**Date:** 2026-06-18
**Status:** Approved

---

## Overview

Extend Content Pilot so approved proposals can be executed: a "Generate Draft" button triggers AI content generation, the result is stored in the DB and reviewed on a dedicated draft review page, and a "Publish" button applies the change to Shopify live via the Admin API.

---

## Flow

```
Approved proposal
  → "Generate Draft" button (Proposals tab)
  → POST /api/content-pilot/proposals/[id]/generate-draft
  → AI generates content → stored in DB (draftStatus: ready)
  → Navigate to /content-pilot/draft/[id]
  → User reviews draft
  → "Publish" button
  → POST /api/content-pilot/proposals/[id]/publish
  → Shopify Admin API write (live immediately)
```

---

## Section 1: Data Model

Two new fields on `ContentProposal` (Prisma migration required):

| Field | Type | Purpose |
|---|---|---|
| `draftContent` | `Json?` | AI-generated output, structured by proposal type |
| `draftGeneratedAt` | `DateTime?` | When the draft was generated |
| `draftStatus` | `String?` | `generating` · `ready` · `failed` · `published` |
| `publishedAt` | `DateTime?` | When it was pushed to Shopify |

`status` (pending / approved / rejected) is unchanged. Draft lifecycle is tracked independently via `draftStatus`.

### `draftContent` shape by proposal type

| Proposal type | Shape |
|---|---|
| `seo-fix`, `gsc-quick-win` | `{ metaTitle: string, metaDescription: string }` |
| `internal-link` | `{ suggestedParagraph: string, anchorText: string, targetHandle: string }` |
| `content-refresh`, `thin-content` | `{ bodyHtml: string }` |
| `new-content` | `{ title: string, bodyHtml: string, tags: string[], metaDescription: string }` |

---

## Section 2: API Routes

### `POST /api/content-pilot/proposals/[id]/generate-draft`

- Auth: `requireAppAuth`
- Sets `draftStatus: "generating"` immediately (UI can poll or show spinner)
- Fetches article context: `ArticleRecord` from DB + Shopify Admin API (`body_html`, title, existing metafields)
- Dispatches to `lib/content-pilot/generate-draft.ts` by `proposalType`
- Stores result in `draftContent`, sets `draftStatus: "ready"`, `draftGeneratedAt: now`
- On error: sets `draftStatus: "failed"`
- Synchronous response (maxDuration: 60)
- Returns `{ draftStatus, draftContent }`

### `GET /api/content-pilot/proposals/[id]`

- Auth: `requireAppAuth`
- Returns full proposal including `draftContent` and `draftStatus`
- Used by the draft review page on load

### `POST /api/content-pilot/proposals/[id]/publish`

- Auth: `requireAppAuth`
- Reads `draftContent`, maps to Shopify Admin API call by `proposalType`
- Existing articles: GraphQL `articleUpdate` mutation
- New articles: GraphQL `articleCreate` mutation
- On success: sets `draftStatus: "published"`, `publishedAt: now`, writes audit log
- On Shopify `userErrors`: returns 422, leaves `draftStatus: "ready"` (retryable)
- Returns `{ published: true, shopifyId }`

---

## Section 3: AI Generation Logic

**File:** `lib/content-pilot/generate-draft.ts`

Central export: `generateDraft(proposal, articleContext)` — dispatches by `proposalType`.

### Article context (fetched before AI call)

- `ArticleRecord` from DB: title, wordCount, seoData, topicsData
- Shopify article via Admin API: `body_html`, `published_at`, existing metafields (SEO title tag, description tag)

### Prompts by proposal type

| Type | Goal | Output fields |
|---|---|---|
| `seo-fix` / `gsc-quick-win` | Rewrite title tag + meta description targeting `proposedState.targetQuery` | `metaTitle`, `metaDescription` |
| `internal-link` | Write a 2–3 sentence paragraph containing a natural link to the target article, suitable for appending to the end of the article body | `suggestedParagraph`, `anchorText`, `targetHandle` |
| `content-refresh` | Refresh full `body_html` — update stale stats/dates, add 1–2 new H2 sections | `bodyHtml` |
| `thin-content` | Expand article to 1,000+ words by appending new H2 sections | `bodyHtml` |
| `new-content` | Write a full 1,200-word article with H2/H3 structure targeting `proposedState.targetKeyword` | `title`, `bodyHtml`, `tags`, `metaDescription` |

All prompts receive full article context and require structured JSON responses. Output validated with Zod before storing.

---

## Section 4: Draft Review Page

**Route:** `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`

### Layout — two columns

**Left (40%)**
- Proposal metadata: priority badge, type, impact/effort badges
- Article handle + description
- "Regenerate Draft" button (re-calls generate-draft, overwrites)
- Back link → Content Pilot

**Right (60%)**
- Draft content preview (rendered by type — see below)
- Status banner: generating spinner / failed message / published confirmation
- "Publish" button with confirm step

### Preview rendering by proposal type

| Type | Rendering |
|---|---|
| `seo-fix` / `gsc-quick-win` | Two labelled text boxes: "Meta Title" and "Meta Description" — current value (subdued) vs proposed value |
| `internal-link` | Suggested paragraph as plain text with anchor highlighted; note showing target article handle |
| `content-refresh` / `thin-content` | Full `body_html` rendered in a scrollable box (full replacement shown, no diff) |
| `new-content` | Title + full `body_html` in a scrollable box |

### Entry point (Proposals tab)

- Approved proposals: show "Generate Draft" button → calls generate-draft → navigates to `/content-pilot/draft/[id]` on completion
- Approved proposals with `draftStatus: "ready"`: button reads "Review Draft" → navigates directly
- Approved proposals with `draftStatus: "generating"`: button disabled with spinner

---

## Section 5: Shopify Publish Logic

**File:** `lib/content-pilot/publish-draft.ts`

### Existing articles

GraphQL `articleUpdate` mutation — only changed fields written:

| Type | Fields written |
|---|---|
| `seo-fix` / `gsc-quick-win` | `metafields` — SEO title tag + description tag (`seo` namespace) |
| `internal-link` | `body_html` — appends `suggestedParagraph` to end of existing body |
| `content-refresh` / `thin-content` | `body_html` — full replacement |

### New articles

GraphQL `articleCreate` mutation on the default blog (blog ID fetched at publish time via `blogList` query — not hardcoded), with `title`, `body_html`, `tags`, `published: true`, and SEO metafields.

### Error handling

- Shopify `userErrors` → 422 response, `draftStatus` left as `ready` (retryable)
- Network/API errors → 500 response, `draftStatus` left as `ready`

### Audit log

On success:
```json
{
  "entityType": "ContentProposal",
  "entityId": "<id>",
  "action": "published",
  "actor": "<session user>",
  "before": { "draftStatus": "ready" },
  "after": { "draftStatus": "published", "shopifyId": "<id>" }
}
```

---

## Files Affected

### New files
- `lib/content-pilot/generate-draft.ts`
- `lib/content-pilot/publish-draft.ts`
- `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`
- `app/api/content-pilot/proposals/[id]/publish/route.ts`
- `app/api/content-pilot/proposals/[id]/route.ts`
- `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`
- `prisma/migrations/<timestamp>_content_proposal_draft_fields/migration.sql`

### Modified files
- `prisma/schema.prisma` — add draft fields to `ContentProposal`
- `app/(embedded)/(content-pilot)/content-pilot/page.tsx` — add "Generate Draft" / "Review Draft" buttons to approved proposal cards

---

## Out of Scope

- Streaming AI generation (synchronous is sufficient for drafts up to 1,200 words within the 60s limit)
- Diff view for content-refresh / thin-content (full replacement preview is enough)
- Scheduling / auto-execution (all execution is manual)
- Rollback after publish (changes go live immediately; rollback is a future concern)
