# Content Pilot Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators generate AI drafts for approved Content Pilot proposals and publish them directly to Shopify via Admin API from a dedicated draft review page.

**Architecture:** Draft lifecycle is tracked on `ContentProposal` via new `draftStatus` / `draftContent` fields. A new `generate-draft` route calls OpenRouter and stores the result. A new `publish` route reads `draftContent` and writes to Shopify GraphQL. The draft review page at `/content-pilot/draft/[id]` renders a two-column layout: proposal metadata left, draft preview + publish right.

**Tech Stack:** Next.js 14 App Router · Prisma + PostgreSQL · OpenAI SDK (OpenRouter) · Shopify Admin GraphQL API 2025-01 · Zod · Shopify Polaris

## Global Constraints

- All embedded API routes must call `requireAppAuth(req)` from `lib/auth.ts` first
- OpenRouter: `baseURL: "https://openrouter.ai/api/v1"`, model `process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-6"`, `max_tokens: 4096`
- Shopify GraphQL endpoint: `` `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json` ``
- Shopify auth header: `X-Shopify-Access-Token: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN`
- Use `shopifyFetch<T>` from `lib/shopify-admin.ts` for all Shopify GraphQL calls — do not duplicate the fetch logic
- All Zod validation schemas live in the same file as the function that uses them
- Prisma client: import `{ prisma }` from `lib/db.ts`
- Audit logs: `entityType: "ContentProposal"`, actor from `getSessionUser(req) ?? "operator"`
- No streaming — all AI calls are synchronous, `maxDuration: 60` on routes that call OpenRouter

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `lib/content-pilot/generate-draft.ts` | AI prompt dispatch + Zod validation by proposal type |
| `lib/content-pilot/publish-draft.ts` | Shopify GraphQL mutations by proposal type |
| `app/api/content-pilot/proposals/[id]/route.ts` | GET single proposal (with draft fields) |
| `app/api/content-pilot/proposals/[id]/generate-draft/route.ts` | POST: set generating → call AI → store draft |
| `app/api/content-pilot/proposals/[id]/publish/route.ts` | POST: read draft → write Shopify → mark published |
| `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx` | Draft review UI page |

### Modified files
| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `draftContent`, `draftGeneratedAt`, `draftStatus`, `publishedAt` to `ContentProposal` |
| `app/(embedded)/(content-pilot)/content-pilot/page.tsx` | Add "Generate Draft" / "Review Draft" buttons to approved proposal cards |

---

## Task 1: Prisma — Add Draft Fields to ContentProposal

**Files:**
- Modify: `prisma/schema.prisma`
- Run migration to generate: `prisma/migrations/<timestamp>_content_proposal_draft_fields/migration.sql`

**Interfaces:**
- Produces: `ContentProposal` model with `draftContent: Json?`, `draftGeneratedAt: DateTime?`, `draftStatus: String?`, `publishedAt: DateTime?`

- [ ] **Step 1: Add fields to schema**

In `prisma/schema.prisma`, update the `ContentProposal` model to add four fields after `reviewNote`:

```prisma
model ContentProposal {
  id               String    @id @default(cuid())
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  articleHandle    String?
  proposalType     String
  changeType       String
  priority         String
  impact           String
  effort           String
  title            String
  description      String
  proposedState    Json
  sourceData       Json
  status           String    @default("pending")
  reviewedBy       String?
  reviewedAt       DateTime?
  reviewNote       String?
  draftContent     Json?
  draftGeneratedAt DateTime?
  draftStatus      String?
  publishedAt      DateTime?

  @@index([status])
  @@index([articleHandle])
  @@index([createdAt])
  @@index([draftStatus])
}
```

- [ ] **Step 2: Run migration**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app
npx prisma migrate dev --name content_proposal_draft_fields
```

Expected output: `✓ Generated Prisma Client` with no errors.

- [ ] **Step 3: Verify Prisma client has the new fields**

```bash
npx prisma studio
```

Open `ContentProposal` table — confirm columns `draftContent`, `draftGeneratedAt`, `draftStatus`, `publishedAt` are present. Close Prisma Studio.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(content-pilot): add draft fields to ContentProposal schema"
```

---

## Task 2: GET /api/content-pilot/proposals/[id]

**Files:**
- Create: `app/api/content-pilot/proposals/[id]/route.ts`

**Interfaces:**
- Produces: `GET /api/content-pilot/proposals/:id` → `{ proposal: ContentProposal }` (all fields including draft fields) or `{ error }` 404/500

- [ ] **Step 1: Create the route file**

```typescript
// app/api/content-pilot/proposals/[id]/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const proposal = await prisma.contentProposal.findUnique({
      where: { id: params.id },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ proposal });
  } catch (err) {
    console.error("[content-pilot/proposals/get] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test with curl**

Start the dev server (`npm run dev`) and run:

```bash
# Replace <ID> with any existing ContentProposal id from the DB
curl -s http://localhost:3000/api/content-pilot/proposals/<ID> \
  -H "Authorization: Bearer test" | jq .
```

Expected: 401 Unauthorized (auth guard works — correct, the route requires App Bridge JWT).

- [ ] **Step 3: Commit**

```bash
git add app/api/content-pilot/proposals/[id]/route.ts
git commit -m "feat(content-pilot): GET /api/content-pilot/proposals/[id]"
```

---

## Task 3: AI Draft Generation Logic

**Files:**
- Create: `lib/content-pilot/generate-draft.ts`

**Interfaces:**
- Consumes: `ContentProposal` (from Prisma), `BlogArticle` from `lib/shopify-admin.ts`
- Produces: `generateDraft(proposal: ContentProposal, article: BlogArticle | null): Promise<DraftContent>`
- `DraftContent` type (union):
  ```typescript
  type SeoFixDraft = { metaTitle: string; metaDescription: string };
  type InternalLinkDraft = { suggestedParagraph: string; anchorText: string; targetHandle: string };
  type BodyHtmlDraft = { bodyHtml: string };
  type NewContentDraft = { title: string; bodyHtml: string; tags: string[]; metaDescription: string };
  export type DraftContent = SeoFixDraft | InternalLinkDraft | BodyHtmlDraft | NewContentDraft;
  ```

- [ ] **Step 1: Create the file**

```typescript
// lib/content-pilot/generate-draft.ts
import OpenAI from "openai";
import { z } from "zod";
import type { ContentProposal } from "@prisma/client";
import type { BlogArticle } from "@/lib/shopify-admin";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://agrikoph.com",
    "X-Title": "Agriko Autopilot",
  },
});

// ── Output types ──────────────────────────────────────────────────────────────

export type SeoFixDraft = { metaTitle: string; metaDescription: string };
export type InternalLinkDraft = { suggestedParagraph: string; anchorText: string; targetHandle: string };
export type BodyHtmlDraft = { bodyHtml: string };
export type NewContentDraft = { title: string; bodyHtml: string; tags: string[]; metaDescription: string };
export type DraftContent = SeoFixDraft | InternalLinkDraft | BodyHtmlDraft | NewContentDraft;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const SeoFixSchema = z.object({
  metaTitle: z.string().min(1),
  metaDescription: z.string().min(1),
});

const InternalLinkSchema = z.object({
  suggestedParagraph: z.string().min(1),
  anchorText: z.string().min(1),
  targetHandle: z.string().min(1),
});

const BodyHtmlSchema = z.object({
  bodyHtml: z.string().min(1),
});

const NewContentSchema = z.object({
  title: z.string().min(1),
  bodyHtml: z.string().min(1),
  tags: z.array(z.string()),
  metaDescription: z.string().min(1),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const text = response.choices[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenRouter returned empty response");
  return text;
}

function parseJson(text: string): unknown {
  // Accept raw JSON or a fenced ```json block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

// ── Prompt builders ───────────────────────────────────────────────────────────

async function generateSeoFix(proposal: ContentProposal, article: BlogArticle | null): Promise<SeoFixDraft> {
  const ps = proposal.proposedState as Record<string, unknown>;
  const targetQuery = ps.targetQuery as string ?? proposal.title;
  const system = `You are an SEO specialist for Agriko (agrikoph.com), a Philippine health food brand.
Return ONLY a JSON object — no explanation, no markdown except the JSON itself:
{ "metaTitle": "...", "metaDescription": "..." }
Rules:
- metaTitle: 50–60 characters, include brand name "Agriko" at the end after a pipe: "Title | Agriko"
- metaDescription: 140–160 characters, include target keyword naturally, end with a soft CTA
- Write for Filipino audience, tone: warm and trustworthy`;

  const user = `Article: "${article?.title ?? proposal.title}"
Current meta title: ${article?.seoTitle ?? "(none)"}
Current meta description: ${article?.seoDescription ?? "(none)"}
Target keyword: "${targetQuery}"
Generate new metaTitle and metaDescription.`;

  const text = await callAI(system, user);
  return SeoFixSchema.parse(parseJson(text));
}

async function generateInternalLink(proposal: ContentProposal, article: BlogArticle | null): Promise<InternalLinkDraft> {
  const ps = proposal.proposedState as Record<string, unknown>;
  const targetHandle = ps.toArticle as string ?? "";
  const anchorHint = ps.suggestedAnchorText as string ?? targetHandle;
  const system = `You are a content editor for Agriko (agrikoph.com), a Philippine health food brand.
Return ONLY a JSON object:
{ "suggestedParagraph": "...", "anchorText": "...", "targetHandle": "..." }
Rules:
- suggestedParagraph: 2–3 sentences that naturally introduce a link to the target article. Use [anchorText](targetHandle) inline link syntax inside the paragraph.
- anchorText: 3–6 words, descriptive, matches the topic of the target article
- targetHandle: the exact handle string provided, unchanged
- Tone: warm, informative, matches existing article voice`;

  const user = `Source article: "${article?.title ?? proposal.title}"
Target article handle: "${targetHandle}"
Suggested anchor text hint: "${anchorHint}"
Write a paragraph to append at the end of the source article that links to the target.`;

  const text = await callAI(system, user);
  const result = InternalLinkSchema.parse(parseJson(text));
  return { ...result, targetHandle: targetHandle || result.targetHandle };
}

async function generateBodyHtml(proposal: ContentProposal, article: BlogArticle | null, mode: "refresh" | "expand"): Promise<BodyHtmlDraft> {
  const system = mode === "refresh"
    ? `You are a content editor for Agriko (agrikoph.com), a Philippine health food brand.
Return ONLY a JSON object:
{ "bodyHtml": "..." }
Rules:
- Refresh the provided article HTML: update any statistics or date references that may be stale, add 1–2 new H2 sections with fresh information, preserve all existing H2 headings and content
- Output complete article HTML (not a diff) — use semantic HTML: <h2>, <h3>, <p>, <ul>, <li>
- Minimum 800 words in the output
- Tone: warm, trustworthy, educational — Filipino health food audience`
    : `You are a content editor for Agriko (agrikoph.com), a Philippine health food brand.
Return ONLY a JSON object:
{ "bodyHtml": "..." }
Rules:
- Expand the provided article HTML to at least 1,000 words by appending 2–3 new H2 sections after the existing content
- Preserve all existing content unchanged — only add new sections at the end
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <li>
- Tone: warm, trustworthy, educational — Filipino health food audience`;

  const user = `Article title: "${article?.title ?? proposal.title}"
Current body HTML:
${article?.bodyHtml ?? "(no content available — write from scratch based on the title)"}`;

  const text = await callAI(system, user);
  return BodyHtmlSchema.parse(parseJson(text));
}

async function generateNewContent(proposal: ContentProposal): Promise<NewContentDraft> {
  const ps = proposal.proposedState as Record<string, unknown>;
  const targetKeyword = ps.targetKeyword as string ?? proposal.title;
  const system = `You are a content writer for Agriko (agrikoph.com), a Philippine health food brand.
Return ONLY a JSON object:
{ "title": "...", "bodyHtml": "...", "tags": [...], "metaDescription": "..." }
Rules:
- title: compelling, includes target keyword, 50–70 characters
- bodyHtml: full article, minimum 1,200 words, H2/H3 structure, semantic HTML (<h2>, <h3>, <p>, <ul>, <li>)
- tags: 3–6 relevant tags as an array of lowercase strings
- metaDescription: 140–160 characters, includes target keyword, soft CTA
- Tone: warm, trustworthy, educational — Filipino health food audience`;

  const user = `Target keyword: "${targetKeyword}"
Write a complete, SEO-optimised blog article for Agriko.`;

  const text = await callAI(system, user);
  return NewContentSchema.parse(parseJson(text));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateDraft(
  proposal: ContentProposal,
  article: BlogArticle | null
): Promise<DraftContent> {
  switch (proposal.proposalType) {
    case "seo-fix":
      return generateSeoFix(proposal, article);
    case "internal-link":
      return generateInternalLink(proposal, article);
    case "content-refresh":
      return generateBodyHtml(proposal, article, "refresh");
    case "new-content":
      return generateNewContent(proposal);
    default:
      // thin-content and any other body proposals → expand
      return generateBodyHtml(proposal, article, "expand");
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/content-pilot/generate-draft.ts
git commit -m "feat(content-pilot): AI draft generation by proposal type"
```

---

## Task 4: POST /api/content-pilot/proposals/[id]/generate-draft

**Files:**
- Create: `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`

**Interfaces:**
- Consumes: `generateDraft` from `lib/content-pilot/generate-draft.ts`, `fetchBlogArticles` from `lib/shopify-admin.ts`
- Produces: `POST /api/content-pilot/proposals/:id/generate-draft` → `{ draftStatus: "ready", draftContent: DraftContent }` or `{ error }`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/content-pilot/proposals/[id]/generate-draft/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateDraft } from "@/lib/content-pilot/generate-draft";
import { fetchBlogArticles } from "@/lib/shopify-admin";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const proposal = await prisma.contentProposal.findUnique({
    where: { id: params.id },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (proposal.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved proposals can generate a draft" },
      { status: 409 }
    );
  }

  // Mark as generating immediately so the UI can show a spinner
  await prisma.contentProposal.update({
    where: { id: params.id },
    data: { draftStatus: "generating", draftContent: undefined },
  });

  try {
    // Fetch article context from Shopify (null for new-content proposals)
    let article = null;
    if (proposal.articleHandle) {
      const articles = await fetchBlogArticles();
      article = articles.find((a) => a.handle === proposal.articleHandle) ?? null;
    }

    const draftContent = await generateDraft(proposal, article);

    const updated = await prisma.contentProposal.update({
      where: { id: params.id },
      data: {
        draftStatus: "ready",
        draftContent: draftContent as object,
        draftGeneratedAt: new Date(),
      },
    });

    return NextResponse.json({
      draftStatus: updated.draftStatus,
      draftContent: updated.draftContent,
    });
  } catch (err) {
    console.error("[content-pilot/generate-draft] error:", err);
    await prisma.contentProposal.update({
      where: { id: params.id },
      data: { draftStatus: "failed" },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/content-pilot/proposals/[id]/generate-draft/route.ts
git commit -m "feat(content-pilot): POST generate-draft route"
```

---

## Task 5: Shopify Publish Logic

**Files:**
- Create: `lib/content-pilot/publish-draft.ts`

**Interfaces:**
- Consumes: `shopifyFetch` (internal to `lib/shopify-admin.ts` — not exported). We need to add a `shopifyFetch` export or duplicate the pattern. **Check `lib/shopify-admin.ts` first** — if `shopifyFetch` is not exported, add `export` to it.
- Produces: `publishDraft(proposal: ContentProposal): Promise<{ shopifyId: string }>` — throws on failure

- [ ] **Step 1: Export shopifyFetch from lib/shopify-admin.ts**

In `lib/shopify-admin.ts`, change:

```typescript
async function shopifyFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
```

to:

```typescript
export async function shopifyFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
```

- [ ] **Step 2: Create publish-draft.ts**

```typescript
// lib/content-pilot/publish-draft.ts
import type { ContentProposal } from "@prisma/client";
import { shopifyFetch } from "@/lib/shopify-admin";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserError { field: string[]; message: string }

interface ArticleUpdateResponse {
  articleUpdate: {
    article: { id: string } | null;
    userErrors: UserError[];
  };
}

interface ArticleCreateResponse {
  articleCreate: {
    article: { id: string } | null;
    userErrors: UserError[];
  };
}

interface BlogListResponse {
  blogs: {
    edges: Array<{ node: { id: string } }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertNoUserErrors(errors: UserError[]): void {
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.map((e) => e.message).join("; ")), { userErrors: errors });
  }
}

async function getArticleGid(handle: string): Promise<string> {
  const data = await shopifyFetch<{ articles: { edges: Array<{ node: { id: string } }> } }>(
    `query ArticleByHandle($query: String!) {
      articles(first: 1, query: $query) {
        edges { node { id } }
      }
    }`,
    { query: `handle:${handle}` }
  );
  const gid = data.articles.edges[0]?.node?.id;
  if (!gid) throw new Error(`Article with handle "${handle}" not found in Shopify`);
  return gid;
}

async function getDefaultBlogId(): Promise<string> {
  const data = await shopifyFetch<BlogListResponse>(
    `query { blogs(first: 1) { edges { node { id } } } }`
  );
  const gid = data.blogs.edges[0]?.node?.id;
  if (!gid) throw new Error("No blog found in Shopify store");
  return gid;
}

// ── Publish handlers ──────────────────────────────────────────────────────────

async function publishSeoFix(
  articleHandle: string,
  draft: { metaTitle: string; metaDescription: string }
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);
  const data = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    {
      id: articleId,
      article: {
        metafields: [
          {
            namespace: "seo",
            key: "title",
            value: draft.metaTitle,
            type: "single_line_text_field",
          },
          {
            namespace: "seo",
            key: "description",
            value: draft.metaDescription,
            type: "multi_line_text_field",
          },
        ],
      },
    }
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
  return data.articleUpdate.article!.id;
}

async function publishInternalLink(
  articleHandle: string,
  draft: { suggestedParagraph: string }
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);

  // Fetch current body
  const current = await shopifyFetch<{ article: { body: string } }>(
    `query ArticleBody($id: ID!) { article(id: $id) { body } }`,
    { id: articleId }
  );
  const existingBody = current.article.body;
  const newBody = existingBody + "\n\n" + `<p>${draft.suggestedParagraph}</p>`;

  const data = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body: newBody } }
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
  return data.articleUpdate.article!.id;
}

async function publishBodyHtml(
  articleHandle: string,
  draft: { bodyHtml: string }
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);
  const data = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body: draft.bodyHtml } }
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
  return data.articleUpdate.article!.id;
}

async function publishNewContent(
  draft: { title: string; bodyHtml: string; tags: string[]; metaDescription: string }
): Promise<string> {
  const blogId = await getDefaultBlogId();
  const data = await shopifyFetch<ArticleCreateResponse>(
    `mutation ArticleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    {
      article: {
        blogId,
        title: draft.title,
        body: draft.bodyHtml,
        tags: draft.tags.join(", "),
        isPublished: true,
        metafields: [
          {
            namespace: "seo",
            key: "description",
            value: draft.metaDescription,
            type: "multi_line_text_field",
          },
        ],
      },
    }
  );
  assertNoUserErrors(data.articleCreate.userErrors);
  return data.articleCreate.article!.id;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function publishDraft(proposal: ContentProposal): Promise<{ shopifyId: string }> {
  if (!proposal.draftContent) throw new Error("No draft content to publish");
  const draft = proposal.draftContent as Record<string, unknown>;

  let shopifyId: string;

  switch (proposal.proposalType) {
    case "seo-fix":
      shopifyId = await publishSeoFix(
        proposal.articleHandle!,
        draft as { metaTitle: string; metaDescription: string }
      );
      break;
    case "internal-link":
      shopifyId = await publishInternalLink(
        proposal.articleHandle!,
        draft as { suggestedParagraph: string }
      );
      break;
    case "new-content":
      shopifyId = await publishNewContent(
        draft as { title: string; bodyHtml: string; tags: string[]; metaDescription: string }
      );
      break;
    default:
      // content-refresh, thin-content
      shopifyId = await publishBodyHtml(
        proposal.articleHandle!,
        draft as { bodyHtml: string }
      );
  }

  return { shopifyId };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/shopify-admin.ts lib/content-pilot/publish-draft.ts
git commit -m "feat(content-pilot): Shopify publish logic by proposal type"
```

---

## Task 6: POST /api/content-pilot/proposals/[id]/publish

**Files:**
- Create: `app/api/content-pilot/proposals/[id]/publish/route.ts`

**Interfaces:**
- Consumes: `publishDraft` from `lib/content-pilot/publish-draft.ts`
- Produces: `POST /api/content-pilot/proposals/:id/publish` → `{ published: true, shopifyId: string }` or `{ error }` (422 for Shopify userErrors, 500 for system errors)

- [ ] **Step 1: Create the route file**

```typescript
// app/api/content-pilot/proposals/[id]/publish/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publishDraft } from "@/lib/content-pilot/publish-draft";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = (await getSessionUser(req)) ?? "operator";

  const proposal = await prisma.contentProposal.findUnique({
    where: { id: params.id },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (proposal.draftStatus !== "ready") {
    return NextResponse.json(
      { error: `Cannot publish — draft status is "${proposal.draftStatus ?? "none"}"` },
      { status: 409 }
    );
  }

  try {
    const { shopifyId } = await publishDraft(proposal);

    await prisma.contentProposal.update({
      where: { id: params.id },
      data: { draftStatus: "published", publishedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "ContentProposal",
        entityId: params.id,
        action: "published",
        actor,
        before: { draftStatus: "ready" },
        after: { draftStatus: "published", shopifyId },
      },
    });

    return NextResponse.json({ published: true, shopifyId });
  } catch (err: unknown) {
    console.error("[content-pilot/publish] error:", err);
    // Shopify userErrors → 422 so the UI can show the Shopify message
    const hasUserErrors =
      err instanceof Error && "userErrors" in err;
    const status = hasUserErrors ? 422 : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/content-pilot/proposals/[id]/publish/route.ts
git commit -m "feat(content-pilot): POST publish route with audit log"
```

---

## Task 7: Draft Review Page

**Files:**
- Create: `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/content-pilot/proposals/:id`, `POST /api/content-pilot/proposals/:id/generate-draft`, `POST /api/content-pilot/proposals/:id/publish`
- Produces: Draft review UI at `/content-pilot/draft/:id`

- [ ] **Step 1: Create the page file**

```typescript
// app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx
"use client";

import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Button,
  Banner,
  Spinner,
  Box,
  Divider,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContentProposal {
  id: string;
  title: string;
  description: string;
  proposalType: string;
  priority: "P1" | "P2" | "P3";
  impact: string;
  effort: string;
  articleHandle: string | null;
  status: string;
  draftStatus: string | null;
  draftContent: Record<string, unknown> | null;
  draftGeneratedAt: string | null;
  publishedAt: string | null;
}

// ── Draft preview components ───────────────────────────────────────────────────

function SeoPreview({ draft }: { draft: { metaTitle: string; metaDescription: string } }) {
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta Title</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.metaTitle}</Text>
        </Box>
        <Text as="p" tone="subdued">{draft.metaTitle.length} characters (target: 50–60)</Text>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta Description</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.metaDescription}</Text>
        </Box>
        <Text as="p" tone="subdued">{draft.metaDescription.length} characters (target: 140–160)</Text>
      </BlockStack>
    </BlockStack>
  );
}

function InternalLinkPreview({ draft }: { draft: { suggestedParagraph: string; anchorText: string; targetHandle: string } }) {
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Paragraph to append</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.suggestedParagraph}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Anchor text</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.anchorText}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Links to</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p" tone="subdued">{draft.targetHandle}</Text>
        </Box>
      </BlockStack>
    </BlockStack>
  );
}

function BodyHtmlPreview({ draft }: { draft: { bodyHtml: string } }) {
  return (
    <BlockStack gap="200">
      <Text variant="headingSm" as="h4">Article content</Text>
      <Box
        background="bg-surface-secondary"
        padding="400"
        borderRadius="200"
        overflowX="hidden"
      >
        <div
          style={{ maxHeight: "500px", overflowY: "auto", fontSize: "14px", lineHeight: "1.6" }}
          dangerouslySetInnerHTML={{ __html: draft.bodyHtml }}
        />
      </Box>
    </BlockStack>
  );
}

function NewContentPreview({ draft }: { draft: { title: string; bodyHtml: string; tags: string[]; metaDescription: string } }) {
  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Title</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.title}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Meta description</Text>
        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <Text as="p">{draft.metaDescription}</Text>
        </Box>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Tags</Text>
        <InlineStack gap="200">
          {draft.tags.map((t) => <Badge key={t}>{t}</Badge>)}
        </InlineStack>
      </BlockStack>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h4">Article body</Text>
        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
          overflowX="hidden"
        >
          <div
            style={{ maxHeight: "500px", overflowY: "auto", fontSize: "14px", lineHeight: "1.6" }}
            dangerouslySetInnerHTML={{ __html: draft.bodyHtml }}
          />
        </Box>
      </BlockStack>
    </BlockStack>
  );
}

function DraftPreview({ proposal }: { proposal: ContentProposal }) {
  if (!proposal.draftContent) return null;
  const d = proposal.draftContent;

  if (proposal.proposalType === "seo-fix") {
    return <SeoPreview draft={d as { metaTitle: string; metaDescription: string }} />;
  }
  if (proposal.proposalType === "internal-link") {
    return <InternalLinkPreview draft={d as { suggestedParagraph: string; anchorText: string; targetHandle: string }} />;
  }
  if (proposal.proposalType === "new-content") {
    return <NewContentPreview draft={d as { title: string; bodyHtml: string; tags: string[]; metaDescription: string }} />;
  }
  // content-refresh, thin-content, anything else with bodyHtml
  return <BodyHtmlPreview draft={d as { bodyHtml: string }} />;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DraftReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const authFetch = useAuthFetch();
  const [proposal, setProposal] = useState<ContentProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${params.id}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to load proposal"); return; }
      setProposal(d.proposal);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [authFetch, params.id]);

  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    setGenerating(true);
    setError(null);
    setPublishConfirm(false);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${params.id}/generate-draft`, {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Generation failed"); return; }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await authFetch(`/api/content-pilot/proposals/${params.id}/publish`, {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Publish failed"); return; }
      await load();
      setPublishConfirm(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <Page title="Draft Review">
        <Layout>
          <Layout.Section>
            <InlineStack align="center"><Spinner /></InlineStack>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!proposal) {
    return (
      <Page title="Draft Review">
        <Layout>
          <Layout.Section>
            <Banner tone="critical">{error ?? "Proposal not found"}</Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const priorityTone = proposal.priority === "P1" ? "critical" : proposal.priority === "P2" ? "attention" : "info";
  const isPublished = proposal.draftStatus === "published";
  const hasDraft = proposal.draftStatus === "ready";
  const isGenerating = proposal.draftStatus === "generating" || generating;

  return (
    <Page
      title="Draft Review"
      backAction={{ content: "Content Pilot", onAction: () => router.push("/content-pilot") }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
          </Layout.Section>
        )}
        {isPublished && (
          <Layout.Section>
            <Banner tone="success">Published to Shopify on {new Date(proposal.publishedAt!).toLocaleString()}.</Banner>
          </Layout.Section>
        )}

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Proposal</Text>
                <InlineStack gap="200">
                  <Badge tone={priorityTone}>{proposal.priority}</Badge>
                  <Badge>{proposal.proposalType}</Badge>
                </InlineStack>
                <Text variant="headingSm" as="h3">{proposal.title}</Text>
                <Text as="p" tone="subdued">{proposal.description}</Text>
                {proposal.articleHandle && (
                  <Text as="p" tone="subdued">
                    Article: <code>{proposal.articleHandle}</code>
                  </Text>
                )}
                <Divider />
                <InlineStack gap="200">
                  <Badge tone={proposal.impact === "High" ? "success" : proposal.impact === "Medium" ? "attention" : "info"}>
                    {proposal.impact} impact
                  </Badge>
                  <Badge tone={proposal.effort === "Low" ? "success" : proposal.effort === "Medium" ? "attention" : "critical"}>
                    {proposal.effort} effort
                  </Badge>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Actions</Text>
                <Button
                  onClick={regenerate}
                  loading={isGenerating}
                  disabled={isPublished || publishing}
                >
                  {hasDraft ? "Regenerate Draft" : "Generate Draft"}
                </Button>
                {hasDraft && !isPublished && (
                  <>
                    {!publishConfirm ? (
                      <Button
                        variant="primary"
                        onClick={() => setPublishConfirm(true)}
                        disabled={isGenerating}
                      >
                        Publish to Shopify
                      </Button>
                    ) : (
                      <BlockStack gap="200">
                        <Text as="p" tone="caution">This will write changes live to Shopify immediately.</Text>
                        <InlineStack gap="200">
                          <Button variant="primary" tone="critical" onClick={publish} loading={publishing}>
                            Confirm Publish
                          </Button>
                          <Button onClick={() => setPublishConfirm(false)}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </>
                )}
                {proposal.draftGeneratedAt && (
                  <Text as="p" tone="subdued">
                    Draft generated: {new Date(proposal.draftGeneratedAt).toLocaleString()}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Draft Preview</Text>
              {isGenerating && (
                <InlineStack gap="300" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" tone="subdued">Generating draft…</Text>
                </InlineStack>
              )}
              {!isGenerating && !hasDraft && !isPublished && (
                <Text as="p" tone="subdued">
                  No draft yet. Click "Generate Draft" to create one.
                </Text>
              )}
              {(hasDraft || isPublished) && proposal.draftContent && (
                <DraftPreview proposal={proposal} />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(embedded\)/\(content-pilot\)/content-pilot/draft/
git commit -m "feat(content-pilot): draft review page"
```

---

## Task 8: Update Proposals Tab — Generate Draft / Review Draft Buttons

**Files:**
- Modify: `app/(embedded)/(content-pilot)/content-pilot/page.tsx`

**Interfaces:**
- Consumes: `POST /api/content-pilot/proposals/:id/generate-draft`, router navigation to `/content-pilot/draft/:id`

- [ ] **Step 1: Add useRouter import**

At the top of `app/(embedded)/(content-pilot)/content-pilot/page.tsx`, add `useRouter` to the React import block if not already present:

```typescript
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
```

- [ ] **Step 2: Update ContentProposal interface**

In the `ContentProposal` interface at the top of the file, add the draft fields:

```typescript
interface ContentProposal {
  id: string;
  createdAt: string;
  articleHandle: string | null;
  proposalType: string;
  changeType: string;
  priority: "P1" | "P2" | "P3";
  impact: string;
  effort: string;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  draftStatus: string | null;       // add this
  draftGeneratedAt: string | null;  // add this
}
```

- [ ] **Step 3: Add router and generatingDraft state to ProposalsTab**

In the `ProposalsTab` component, add:

```typescript
function ProposalsTab({ authFetch }: { authFetch: ReturnType<typeof useAuthFetch> }) {
  const router = useRouter();
  const [proposals, setProposals] = useState<ContentProposal[]>([]);
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [generatingDraftFor, setGeneratingDraftFor] = useState<string | null>(null); // add this
```

- [ ] **Step 4: Add generateDraft function to ProposalsTab**

Inside `ProposalsTab`, after the `act` function, add:

```typescript
const generateDraft = async (id: string) => {
  setGeneratingDraftFor(id);
  setError(null);
  try {
    const res = await authFetch(`/api/content-pilot/proposals/${id}/generate-draft`, {
      method: "POST",
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "Draft generation failed");
    } else {
      router.push(`/content-pilot/draft/${id}`);
    }
  } catch (e) {
    setError(String(e));
  } finally {
    setGeneratingDraftFor(null);
  }
};
```

- [ ] **Step 5: Add draft buttons to approved proposal cards**

Inside the `proposals.map((p) => ...)` card rendering, after the existing approve/reject buttons block, add a draft action block:

```typescript
{p.status === "approved" && (
  <InlineStack gap="200">
    {p.draftStatus === "ready" || p.draftStatus === "published" ? (
      <Button
        variant="primary"
        size="slim"
        onClick={() => router.push(`/content-pilot/draft/${p.id}`)}
      >
        {p.draftStatus === "published" ? "View Published Draft" : "Review Draft"}
      </Button>
    ) : (
      <Button
        size="slim"
        loading={generatingDraftFor === p.id}
        disabled={p.draftStatus === "generating"}
        onClick={() => generateDraft(p.id)}
      >
        {p.draftStatus === "generating" ? "Generating…" : "Generate Draft"}
      </Button>
    )}
  </InlineStack>
)}
```

- [ ] **Step 6: Commit**

```bash
git add app/\(embedded\)/\(content-pilot\)/content-pilot/page.tsx
git commit -m "feat(content-pilot): generate draft + review draft buttons on proposals tab"
```

---

## Self-Review Checklist

- [x] Spec Section 1 (data model) → Task 1
- [x] Spec Section 2 (API routes) → Tasks 2, 4, 6
- [x] Spec Section 3 (AI generation) → Task 3
- [x] Spec Section 4 (draft review page) → Task 7
- [x] Spec Section 5 (publish logic) → Tasks 5, 6
- [x] Entry point (proposals tab buttons) → Task 8
- [x] `shopifyFetch` export needed → Task 5 Step 1 covers it
- [x] `draftStatus: "generating"` set before AI call → Task 4 covers it
- [x] Audit log on publish → Task 6 covers it
- [x] `userErrors` → 422 response → Task 6 covers it
- [x] `generateDraft` function signature consistent across Tasks 3, 4 → both use `(proposal: ContentProposal, article: BlogArticle | null)`
- [x] `publishDraft` function signature consistent across Tasks 5, 6 → both use `(proposal: ContentProposal)`
- [x] `DraftContent` type defined in Task 3, consumed in Tasks 4, 5 → consistent
