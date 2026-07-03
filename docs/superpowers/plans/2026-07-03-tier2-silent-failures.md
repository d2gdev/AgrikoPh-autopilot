# Tier 2 — Silent Failures & Broken Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the silent failure modes from audit items 4–6: fetch errors that render as "—", the dead-end alt-text loop, and the ad-approvals 100-record cap.

**Architecture:** Pure additive UI-state changes on four pages (error state + critical Banner with Retry), one new Shopify write path (alt-text apply via `productUpdateMedia`, which forces `fetchProductImages` onto the `media` connection so IDs are MediaImage GIDs), and a paginated loader for ad-approvals using the offset/limit/total the API already returns.

**Tech Stack:** Next.js 14 App Router, Polaris, Prisma, Shopify Admin GraphQL 2025-01, Vitest.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"` — never instantiate PrismaClient.
- Every embedded API route: `await requireAppAuth(req)` first statement.
- The alt-text apply is an operator-initiated write (like Content Pilot publish), NOT a recommendation execution — it is not gated on `EXECUTE_APPROVED_LIVE_ENABLED`, but every apply MUST create an `auditLog` row.
- Shopify Admin API version is pinned to 2025-01 in `lib/shopify-admin.ts` — do not change it.
- Existing UI conventions: errors are Polaris `Banner tone="critical"`; per-page `responseError(res, fallback)` helper pattern (see `app/(embedded)/(ad-pilot)/recommendations/page.tsx:54`).
- Frontend pages have no component tests in this repo; frontend tasks are verified by `npx tsc --noEmit`, `npm test`, `npm run build`. API/lib changes get Vitest route-level tests in `__tests__/api/`.
- Run GROW (update `.mex/ROUTER.md`) after the final task.

## Scope decisions (locked)

- **Item 5:** Full apply path — per-row "Apply" writes alt text to Shopify via `productUpdateMedia`, plus copy affordance and untruncated text. Rationale: suggestions with no apply path is a broken loop, and the app already writes to Shopify (blog publish) behind operator clicks.
- **Item 6:** Keep client-side bucketing (it depends on `actor`, awkward server-side), but page through ALL records (cap 1000) and show an explicit truncation banner when capped. The API already supports `offset`/`limit` and returns `total` — no backend change.

---

### Task 1: Insights page — surface fetch failures with Retry

**Files:**
- Modify: `app/(embedded)/(insights)/insights/page.tsx`

**Interfaces:**
- Consumes: existing `authFetch`, `getCache`/`setCache`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Refactor the effect into a retryable `loadAll` and add error state**

Replace the imports line `import { useState, useEffect } from "react";` with:

```tsx
import { useState, useEffect, useCallback } from "react";
```

Add `Banner` to the Polaris import list.

Add state after the `storeLoading` state declaration:

```tsx
const [loadError, setLoadError] = useState<string | null>(null);
```

Replace the entire `useEffect` (lines 48–94) with:

```tsx
const loadAll = useCallback(() => {
  setLoadError(null);
  const fail = () => setLoadError("Some data failed to load. Metrics showing “—” may be stale or missing.");

  authFetch("/api/jobs/status")
    .then((r) => { if (!r.ok) throw new Error(`jobs/status ${r.status}`); return r.json(); })
    .then((d) => { setCache("/api/jobs/status", d); setJobStatus(d); })
    .catch(fail);

  setAdLoading(true);
  authFetch("/api/campaigns")
    .then((r) => { if (!r.ok) throw new Error(`campaigns ${r.status}`); return r.json(); })
    .then((d) => {
      const cams = d.campaigns ?? [];
      const active = cams.filter((c: { status: string }) => c.status === "ACTIVE").length;
      const metrics = [
        { label: "Total Campaigns", value: String(cams.length) },
        { label: "Active", value: String(active) },
      ];
      setCache("/api/campaigns:insights-metrics", metrics);
      setAdMetrics(metrics);
    })
    .catch(fail)
    .finally(() => setAdLoading(false));

  setSeoLoading(true);
  authFetch("/api/seo")
    .then((r) => { if (!r.ok) throw new Error(`seo ${r.status}`); return r.json(); })
    .then((d) => {
      const clicks = (d.topQueries ?? []).reduce((s: number, q: { clicks: number }) => s + (q.clicks ?? 0), 0);
      const pages = (d.topPages ?? []).length;
      const metrics = [
        { label: "Total Clicks", value: clicks.toLocaleString() },
        { label: "Top Pages", value: String(pages) },
      ];
      setCache("/api/seo:insights-metrics", metrics);
      setSeoMetrics(metrics);
    })
    .catch(fail)
    .finally(() => setSeoLoading(false));

  setStoreLoading(true);
  authFetch("/api/images")
    .then((r) => { if (!r.ok) throw new Error(`images ${r.status}`); return r.json(); })
    .then((d) => {
      const pct = d.total > 0 ? Math.round(((d.total - d.missingAltText) / d.total) * 100) : 0;
      const metrics = [
        { label: "Total Images", value: String(d.total ?? 0) },
        { label: "Alt Text Coverage", value: `${pct}%` },
      ];
      setCache("/api/images:insights-metrics", metrics);
      setStoreMetrics(metrics);
    })
    .catch(fail)
    .finally(() => setStoreLoading(false));
}, [authFetch]);

useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Render the banner**

Immediately inside `<Layout>` (before the System Status section) add:

```tsx
{loadError && (
  <Layout.Section>
    <Banner
      tone="critical"
      title="Failed to load some metrics"
      action={{ content: "Retry", onAction: loadAll }}
      onDismiss={() => setLoadError(null)}
    >
      <Text as="p">{loadError}</Text>
    </Banner>
  </Layout.Section>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add "app/(embedded)/(insights)/insights/page.tsx"
git commit -m "fix(insights): surface fetch failures with retry banner instead of silent em-dashes"
```

---

### Task 2: Ad Pilot page — surface fetch failures with Retry

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/ad-pilot/page.tsx`

- [ ] **Step 1: Add retryable load + error state**

Change the React import to include `useCallback`, add `Banner` to the Polaris import. Add state after `loading`:

```tsx
const [loadError, setLoadError] = useState<string | null>(null);
```

Replace the `useEffect` (lines 39–50) with:

```tsx
const load = useCallback(() => {
  setLoading(true);
  setLoadError(null);
  Promise.all([
    authFetch("/api/campaigns").then((r) => { if (!r.ok) throw new Error(`Campaigns failed (${r.status})`); return r.json(); }),
    authFetch("/api/jobs/status").then((r) => { if (!r.ok) throw new Error(`Job status failed (${r.status})`); return r.json(); }),
  ]).then(([camData, jData]) => {
    setCache("/api/campaigns", camData.campaigns ?? []);
    setCache("/api/jobs/status", jData);
    setCampaigns(camData.campaigns ?? []);
    setJobStatus(jData);
  }).catch((err: Error) => {
    setLoadError(err.message || "Failed to load Ad Pilot data");
  }).finally(() => setLoading(false));
}, [authFetch]);

useEffect(() => { load(); }, [load]);
```

- [ ] **Step 2: Render the banner** — first child inside `<Layout>`:

```tsx
{loadError && (
  <Layout.Section>
    <Banner
      tone="critical"
      title="Failed to load Ad Pilot data"
      action={{ content: "Retry", onAction: load }}
      onDismiss={() => setLoadError(null)}
    >
      <Text as="p">{loadError}</Text>
    </Banner>
  </Layout.Section>
)}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(embedded)/(ad-pilot)/ad-pilot/page.tsx"
git commit -m "fix(ad-pilot): retry banner on fetch failure instead of silent empty stats"
```

---

### Task 3: Settings page — guardrails/credentials/connector-health load failures

**Files:**
- Modify: `app/(embedded)/settings/page.tsx`

The killer here: a failed `/api/settings` load leaves `guardrailsLoaded=false`, permanently disabling Save with no explanation. Credentials and connector-health loads end in `.catch(() => {})`.

- [ ] **Step 1: Add error state + retryable guardrails load**

Add state after `keyToDelete`:

```tsx
const [loadError, setLoadError] = useState<string | null>(null);
```

Replace the guardrails `useEffect` (lines 67–71) with:

```tsx
const loadGuardrails = useCallback(() => {
  authFetch("/api/settings")
    .then((r) => { if (!r.ok) throw new Error(`Settings failed to load (${r.status})`); return r.json(); })
    .then((d) => { setGuardrails(d.guardrails ?? []); setGuardrailsLoaded(true); })
    .catch((err: Error) => setLoadError(err.message || "Settings failed to load"));
}, [authFetch]);

useEffect(() => { loadGuardrails(); }, [loadGuardrails]);
```

- [ ] **Step 2: Stop swallowing credentials/connector-health load failures**

In `loadCredentials`, replace `.catch(() => {})` with:

```tsx
.catch(() => setLoadError("Credentials failed to load"));
```

and add an ok-check to its first `.then`:

```tsx
.then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
```

Same for `loadConnectorHealth`: ok-check plus

```tsx
.catch(() => setLoadError("Connector health failed to load"));
```

- [ ] **Step 3: Render the banner with a retry-all action** — after the `saveError` banner block:

```tsx
{loadError && (
  <Layout.Section>
    <Banner
      tone="critical"
      title="Failed to load settings"
      action={{ content: "Retry", onAction: () => { setLoadError(null); loadGuardrails(); loadCredentials(); loadConnectorHealth(true); } }}
      onDismiss={() => setLoadError(null)}
    >
      <Text as="p">{loadError} — the Save button stays disabled until settings load.</Text>
    </Banner>
  </Layout.Section>
)}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → no errors. Then `npm test` → all pass (settings route tests exist).

- [ ] **Step 5: Commit**

```bash
git add "app/(embedded)/settings/page.tsx"
git commit -m "fix(settings): retry banner when guardrails/credentials/health fail to load"
```

---

### Task 4: Images page — load failure banner

**Files:**
- Modify: `app/(embedded)/(store-pilot)/images/page.tsx`

- [ ] **Step 1: Add retryable load + error state**

Add `Banner` to Polaris imports. Add state after `bulkRunning`:

```tsx
const [loadError, setLoadError] = useState<string | null>(null);
```

Replace the `useEffect` (lines 47–52) with:

```tsx
const loadImages = useCallback((refresh = false) => {
  setLoading(true);
  setLoadError(null);
  authFetch(refresh ? `${IMAGES_CACHE_KEY}?refresh=1` : IMAGES_CACHE_KEY)
    .then((r) => { if (!r.ok) throw new Error(`Images failed to load (${r.status})`); return r.json(); })
    .then((d) => { setCache(IMAGES_CACHE_KEY, d); setData(d); })
    .catch((err: Error) => setLoadError(err.message || "Images failed to load"))
    .finally(() => setLoading(false));
}, [authFetch]);

useEffect(() => { loadImages(); }, [loadImages]);
```

- [ ] **Step 2: Render banner** — first child inside `<Layout>`:

```tsx
{loadError && (
  <Layout.Section>
    <Banner
      tone="critical"
      title="Failed to load images"
      action={{ content: "Retry", onAction: () => loadImages() }}
      onDismiss={() => setLoadError(null)}
    >
      <Text as="p">{loadError}</Text>
    </Banner>
  </Layout.Section>
)}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(embedded)/(store-pilot)/images/page.tsx"
git commit -m "fix(images): retry banner on load failure"
```

---

### Task 5: Alt-text apply path — backend (lib + PATCH route + tests)

**Files:**
- Modify: `lib/shopify-admin.ts` (fetchProductImages → media connection; new `updateProductMediaAlt`)
- Modify: `app/api/images/route.ts` (new PATCH handler; bust module cache on write)
- Test: `__tests__/api/images-apply.test.ts`

**Interfaces:**
- Produces: `updateProductMediaAlt(productId: string, mediaId: string, alt: string): Promise<{ id: string; alt: string | null }>` (throws on `mediaUserErrors`); `PATCH /api/images` accepting `{ imageId, productId, altText }`, returning `{ ok: true, imageId, altText }`. Task 6's frontend calls this PATCH.
- CRITICAL: alt-text mutations require **MediaImage** GIDs; `products.images` returns ProductImage GIDs. So `fetchProductImages` switches to the `media` connection. The `ProductImage` interface shape is unchanged — `imageId` simply becomes a MediaImage GID (it is treated as opaque by all existing consumers: the images page uses it as a React key and echoes it to POST /api/images which also treats it as opaque).

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/images-apply.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockUpdateAlt = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({ auditLog: { create: vi.fn().mockResolvedValue({}) } }));

vi.mock("@/lib/shopify-admin", () => ({
  fetchProductImages: vi.fn().mockResolvedValue([]),
  updateProductMediaAlt: mockUpdateAlt,
}));
vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
  getSessionShop: vi.fn().mockResolvedValue("agrikoph.myshopify.com"),
  getSessionUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ai/client", () => ({ getAiClient: vi.fn() }));

import { PATCH } from "@/app/api/images/route";

function request(body: unknown) {
  return new Request("http://test.local/api/images", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID = {
  imageId: "gid://shopify/MediaImage/123",
  productId: "gid://shopify/Product/456",
  altText: "Agriko turmeric tea blend in resealable pouch",
};

describe("PATCH /api/images (apply alt text)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockUpdateAlt.mockResolvedValue({ id: VALID.imageId, alt: VALID.altText });
  });

  it("applies alt text to Shopify and audit-logs the write", async () => {
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(200);
    expect(mockUpdateAlt).toHaveBeenCalledWith(VALID.productId, VALID.imageId, VALID.altText);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "image_alt_text_applied",
        entityId: VALID.imageId,
      }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, imageId: VALID.imageId });
  });

  it("rejects non-Shopify GIDs", async () => {
    const res = await PATCH(request({ ...VALID, productId: "456" }));
    expect(res.status).toBe(400);
    expect(mockUpdateAlt).not.toHaveBeenCalled();
  });

  it("rejects empty or over-length alt text", async () => {
    expect((await PATCH(request({ ...VALID, altText: "  " }))).status).toBe(400);
    expect((await PATCH(request({ ...VALID, altText: "x".repeat(126) }))).status).toBe(400);
  });

  it("returns 502 when Shopify rejects the mutation", async () => {
    mockUpdateAlt.mockRejectedValueOnce(new Error("Media not found"));
    const res = await PATCH(request(VALID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Media not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/images-apply.test.ts`
Expected: FAIL — `PATCH` is not exported from the route.

- [ ] **Step 3: Switch fetchProductImages to the media connection**

In `lib/shopify-admin.ts`, replace `ProductImagesResponse` and the query inside `fetchProductImages` (interface `ProductImage` is unchanged):

```ts
type ProductImagesResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        title: string;
        media: {
          edges: Array<{
            node: { id?: string; alt?: string | null; image?: { url: string } | null };
          }>;
        };
      };
    }>;
  };
};
```

```ts
const query = `
  query ProductMediaImages($after: String) {
    products(first: 100, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          media(first: 250) {
            edges {
              node {
                ... on MediaImage {
                  id
                  alt
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
```

And the inner loop becomes (non-image media yields empty nodes from the inline fragment — skip them; images still processing have no url yet — skip those too):

```ts
for (const { node: product } of data.products.edges) {
  for (const { node: media } of product.media.edges) {
    if (!media.id || !media.image?.url) continue;
    images.push({
      imageId: media.id,
      productId: product.id,
      productTitle: product.title,
      imageUrl: media.image.url,
      altText: media.alt?.trim() ? media.alt : null,
    });
  }
}
```

- [ ] **Step 4: Add updateProductMediaAlt to lib/shopify-admin.ts** (after `fetchProductImages`):

```ts
export async function updateProductMediaAlt(
  productId: string,
  mediaId: string,
  alt: string
): Promise<{ id: string; alt: string | null }> {
  const mutation = `
    mutation UpdateImageAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media {
          id
          alt
        }
        mediaUserErrors {
          field
          message
        }
      }
    }
  `;
  const data = await shopifyFetch<{
    productUpdateMedia: {
      media: Array<{ id: string; alt: string | null }> | null;
      mediaUserErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, { productId, media: [{ id: mediaId, alt }] });

  const errors = data.productUpdateMedia.mediaUserErrors;
  if (errors?.length) throw new Error(errors[0]!.message);
  const media = data.productUpdateMedia.media?.[0];
  if (!media) throw new Error("Shopify returned no media in productUpdateMedia response");
  return media;
}
```

- [ ] **Step 5: Add the PATCH handler to app/api/images/route.ts**

Add imports: `updateProductMediaAlt` to the existing `@/lib/shopify-admin` import, and `import { prisma } from "@/lib/db";`.

Add after the POST handler:

```ts
const ApplyAltTextInput = z.object({
  imageId: z.string().startsWith("gid://shopify/").max(100),
  productId: z.string().startsWith("gid://shopify/Product/").max(100),
  altText: z.string().trim().min(1).max(125),
});

export async function PATCH(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  const actor = await getSessionShop(req) ?? await getSessionUser(req) ?? "embedded-app";
  if (!checkRateLimit(`alttext-apply:${actor}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded — max 30 alt-text applies per minute" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = ApplyAltTextInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { imageId, productId, altText } = parsed.data;

  try {
    const media = await updateProductMediaAlt(productId, imageId, altText);
    imagesCache = null; // the stored payload predates this write

    await prisma.auditLog.create({
      data: {
        actor,
        action: "image_alt_text_applied",
        entityType: "product_image",
        entityId: imageId,
        after: { productId, altText },
      },
    }).catch((err) => console.error("[images] apply audit failed:", err));

    return NextResponse.json({ ok: true, imageId, altText: media.alt ?? altText });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Shopify update failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run __tests__/api/images-apply.test.ts` → 4 pass. Then `npm test` → all pass. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/shopify-admin.ts app/api/images/route.ts __tests__/api/images-apply.test.ts
git commit -m "feat(images): alt-text apply path — media-based image fetch + productUpdateMedia PATCH with audit log"
```

---

### Task 6: Alt-text apply path — frontend (full text, copy, Apply)

**Files:**
- Modify: `app/(embedded)/(store-pilot)/images/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/images` with `{ imageId, productId, altText }` from Task 5.

- [ ] **Step 1: Add apply state + handler**

Add state after `loadError` (from Task 4):

```tsx
const [applying, setApplying] = useState<Set<string>>(new Set());
```

Add handlers after `generateAllMissing`:

```tsx
const applyAlt = useCallback(async (img: ImageRow, altText: string) => {
  setApplying((p) => new Set(p).add(img.imageId));
  try {
    const res = await authFetch("/api/images", {
      method: "PATCH",
      body: JSON.stringify({ imageId: img.imageId, productId: img.productId, altText }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((d as { error?: string }).error ?? `Apply failed (${res.status})`);
    setData((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        images: prev.images.map((i) => i.imageId === img.imageId ? { ...i, altText } : i),
        missingAltText: Math.max(0, prev.missingAltText - (img.altText ? 0 : 1)),
      };
      setCache(IMAGES_CACHE_KEY, next);
      return next;
    });
    setSuggestions((p) => { const n = { ...p }; delete n[img.imageId]; return n; });
    setToast({ message: "Alt text applied to Shopify" });
  } catch (e) {
    setToast({ message: e instanceof Error ? e.message : "Apply failed", error: true });
  } finally {
    setApplying((p) => { const n = new Set(p); n.delete(img.imageId); return n; });
  }
}, [authFetch]);

const copyAlt = useCallback(async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    setToast({ message: "Copied to clipboard" });
  } catch {
    setToast({ message: "Copy failed — select the text manually", error: true });
  }
}, []);
```

- [ ] **Step 2: Replace the truncated suggestion cell and action cell**

Replace the `altTextCell` suggestion branch (`) : suggestion ? (...)`) with full text:

```tsx
) : suggestion ? (
  <Text as="span" variant="bodySm">{suggestion}</Text>
) : img.altText ? (
```

(also drop the `.slice(0, 40)` truncation on the existing-alt branch — show `{img.altText}` in full).

Replace the `actionCell` definition with:

```tsx
const isApplying = applying.has(img.imageId);
const actionCell = suggestion ? (
  <InlineStack gap="150">
    <Button size="slim" variant="primary" loading={isApplying} onClick={() => applyAlt(img, suggestion)}>
      Apply
    </Button>
    <Button size="slim" onClick={() => copyAlt(suggestion)}>Copy</Button>
    <Button size="slim" variant="plain" loading={generating.has(img.imageId)} onClick={() => generate(img)}>
      Regenerate
    </Button>
  </InlineStack>
) : img.altText && !hasError ? (
  <></>
) : (
  <Button size="slim" onClick={() => generate(img)} loading={isGenerating}>
    {hasError ? "Retry" : "Generate"}
  </Button>
);
```

- [ ] **Step 3: Fix the bulk toast copy** — in `generateAllMissing`, replace the final toast message with:

```tsx
setToast({ message: "Suggestions generated — review and click Apply to write them to Shopify" });
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors. `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(embedded)/(store-pilot)/images/page.tsx"
git commit -m "feat(images): full-text suggestions with Apply-to-Shopify and Copy actions"
```

---

### Task 7: Ad-approvals — paginate past the 100-record cap + truncation notice

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/ad-approvals/page.tsx`

The GET route already supports `offset`/`limit` (max 100) and returns `total` (`app/api/ad-approvals/route.ts:23,49`). Client-side bucketing stays (it filters on `actor`); we page through everything up to a hard cap.

- [ ] **Step 1: Replace load() with a paginated loader**

Add state after `unread`:

```tsx
const [truncatedTotal, setTruncatedTotal] = useState<number | null>(null);
```

Replace the `load` callback (lines 90–104) with:

```tsx
const PAGE_LIMIT = 100;
const MAX_RECORDS = 1000;

const load = useCallback(async () => {
  setLoading(true);
  setLoadError(null);
  setTruncatedTotal(null);
  try {
    const all: Approval[] = [];
    let total = 0;
    let actorId = "";
    let offset = 0;
    do {
      const r = await authFetch(`/api/ad-approvals?limit=${PAGE_LIMIT}&offset=${offset}`);
      if (!r.ok) throw new Error(await responseError(r, "Failed to load approvals"));
      const d = await r.json();
      all.push(...(d.approvals ?? []));
      total = d.total ?? all.length;
      actorId = d.actor ?? "";
      offset += PAGE_LIMIT;
    } while (all.length < total && offset < MAX_RECORDS);
    setApprovals(all);
    setActor(actorId);
    if (all.length < total) setTruncatedTotal(total);
  } catch (err) {
    setLoadError(err instanceof Error ? err.message : String(err));
  } finally {
    setLoading(false);
  }
}, [authFetch]);
```

- [ ] **Step 2: Render the truncation notice** — after the `loadError` banner:

```tsx
{truncatedTotal !== null && (
  <Banner tone="warning" title="List truncated">
    <Text as="p">
      Showing the {approvals.length} most recently updated of {truncatedTotal} approvals — older items are not listed in any tab.
    </Text>
  </Banner>
)}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → no errors. `npm test` → all pass (`ad-approvals-submit.test.ts` unaffected). `npm run build` → clean.

- [ ] **Step 4: Commit + GROW**

```bash
git add "app/(embedded)/(ad-pilot)/ad-approvals/page.tsx"
git commit -m "fix(ad-approvals): page past the silent 100-record cap and show truncation notice"
```

Then update `.mex/ROUTER.md` Current Project State with a Tier-2 line (retry banners on insights/ad-pilot/settings/images; alt-text apply path live via productUpdateMedia with audit logging and MediaImage-GID fetch; ad-approvals paginates to 1000 with truncation banner), bump `last_updated`, and commit:

```bash
git add .mex/ROUTER.md
git commit -m "docs(mex): record Tier 2 silent-failure fixes"
```

---

## Follow-up plans (not in this document)

- **Plan 2 — Tiers 3+4 (items 7–12):** shared UI helpers first (item 10: one `statusTone`, one `timeAgo`, `formatPhp`, empty-state, StatCard adoption), then skeletons (11), sort/filter (12), nav consolidation (7: single `NAV_ITEMS` module drives both Frame nav and App Bridge NavMenu — decision: Frame nav is the source of truth), SEO dedup (8: `/seo` becomes a redirect to `/seo-pillar`; nav label "SEO" moves to the pillar dashboard), dashboard inbox-first (9).
- **Plan 3 — Tiers 5+6 (items 13–17):** ad-approvals stepper/timeline, draft editor guard + merge-over-original fix, Odysseus iframe hardening (env-var required, "not configured" fallback), monolith splits, a11y/theming pass.

## Self-review notes

- Spec coverage: item 4 → Tasks 1–4 (all four cited files); item 5 → Tasks 5–6 (apply path + full text + copy); item 6 → Task 7 (pagination + notice). ✔
- Type consistency: `updateProductMediaAlt(productId, mediaId, alt)` defined in Task 5 Step 4 matches Task 5 Step 5's call and the test's assertion order. `loadImages` defined in Task 4 is not referenced by Task 6 (which only adds handlers). ✔
- The `productUpdateMedia` mutation shape was verified against shopify.dev docs via the shopify-admin skill's doc search (validator script itself is broken in the plugin cache — ENOENT on its schema file — noted; mutation matches the documented example verbatim).
