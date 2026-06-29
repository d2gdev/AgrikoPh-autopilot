---
name: content-pilot
description: Content Pilot — blog article index, proposals, draft generation, publish flow
metadata:
  type: project
---

# Content Pilot

## Models

- `ArticleRecord` — indexed blog articles from Shopify (fetched by `fetch-blog-content`)
- `ContentProposal` — improvement suggestions: `internal_links | new_topic | optimization`
- Three proposal types:
  - `internal_links` — suggest linking between existing articles
  - `new_topic` — suggest new article topic
  - `optimization` — suggest SEO/content improvements to existing article

## Flow

1. `fetch-blog-content` (03:00 UTC) — fetches blog articles via Shopify admin GraphQL → upserts `ArticleRecord`
2. `run-skills` (01:00 UTC) — analyzes articles → creates `ContentProposal` records
3. UI: Content Pilot page shows pending proposals. The **"Approve & Generate Draft"** button (`approve()` in `content-pilot/page.tsx`) POSTs `approve` then immediately chains `generateDraft()` and navigates to the draft editor — one click produces a reviewable draft. (Previously Approve only flipped status and the card vanished from the Pending tab with no deliverable — felt like a no-op.)
4. `/api/content-pilot/proposals/[id]/approve` — marks proposal `approved` (precondition: status `pending`); writes audit log
5. `/api/content-pilot/proposals/[id]/generate-draft` — precondition: status `approved`; sets `draftStatus: generating` → LLM → `ready` (or `failed`). The Approved tab still shows a standalone "Generate Draft" button to retry if this step failed.
6. Draft editor: `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`. Besides preview/regenerate/publish, the page has an **Edit Draft** mode (`DraftEditor` component) that lets operators hand-edit the generated draft before publishing. It renders per-type fields (seo-fix → metaTitle/metaDescription; internal-link → suggestedParagraph/anchorText/targetHandle; new-content → title/metaDescription/tags/bodyHtml; default → bodyHtml) and saves via **`PATCH /api/content-pilot/proposals/[id]`** with `{ draftContent }`. PATCH only allows edits while `draftStatus === "ready"` and validates the payload with `getDraftSchema(proposalType)` from `lib/content-pilot/generate-draft.ts` (same schema the AI generator must satisfy); writes a `draft_edited` audit log. `publishDraft` reads `draftContent`, so edits flow straight to Shopify on publish. The Content Pilot page also has a **Drafts tab** (`DraftsTab` in `content-pilot/page.tsx`, tab index 3) listing every proposal whose `draftStatus` is in (generating/ready/published/failed) — title, type, status badge, generated date, and a Review/View button → `/content-pilot/draft/${id}`. This is the central view for all drafts (previously drafts were only reachable by drilling into approved proposal cards). Tab order is Overview(0)/Proposals(1)/Drafts(2)/Brief(3).
7. `/api/content-pilot/articles/[slug]/route.ts` — publish to Shopify

## Publish metadata

Published articles get `shopifyArticleId`, `publishedHandle`, and trigger auto-reindex via `ArticleRecord` upsert.

## Draft generation (`lib/content-pilot/generate-draft.ts`)

Calls DeepSeek LLM via `lib/ai/client.ts`. Uses article context + proposal type to generate full HTML draft.

## Known issue

Content Pilot E2E verify in prod still pending (was 401ing before Shopify token auto-refresh fix).
