# Tiers 3+4 — Consistency & Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit items 10–12 and 7–9: extract shared UI helpers and adopt them everywhere, standardize skeleton loading + last-updated indicators, add sort/filter/search to long lists, close the App Bridge nav drift + add a mobile nav toggle, fold `/seo` into `/seo-pillar`, and lead the dashboard with the Pending Review inbox.

**Architecture:** New `lib/format.ts` (time/currency/label helpers, unit-tested) and `lib/ui/tones.ts` (domain tone mappers) adopted across pages; `components/ui/states.tsx` skeletons adopted on list pages; content-pilot's client-side pills+search+sort pattern copied to four lists; `lib/navigation.ts` stays the single nav source (flags + labels change, plus a TopBar mobile toggle in layout); `/seo`'s AI-brief feature ports into the pillar Overview tab and `/seo` becomes a client redirect; the dashboard's Pending Review JSX block relocates above the stat rows (no state moves needed — verified).

**Tech Stack:** Next.js 14 App Router, Polaris, Vitest.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"`; embedded API routes call `await requireAppAuth(req)` first. (No API changes planned except none — all filtering is client-side, matching content-pilot.)
- Preserve Shopify embedded context on any navigation: always `withShopifyContextUrl(href)` (client) — never bare `router.push("/x")` or server `redirect()`.
- Do not change tone semantics silently where domains differ: recommendations `rejected`→warning and ad-approvals `rejected`→critical are different domains and both stay — dedupe within domains only.
- Standardize `PAUSED`→`warning` (campaigns' existing choice) — Ad Pilot's grey PAUSED changes to warning.
- Verify each task with `npx tsc --noEmit`; run `npm test` after lib changes; `npm run build` at the end.
- Commit after each task; push once at the end; GROW update to `.mex/ROUTER.md` in the final task.

---

### Task 1: `lib/format.ts` + tests (canonical timeAgo, peso/number formatting, actionLabel)

**Files:**
- Create: `lib/format.ts`
- Test: `__tests__/lib/format.test.ts`

**Interfaces (produced, used by Tasks 2–9):**
- `timeAgo(iso: string | null | undefined): string` — null/undefined→`"never"`, NaN→`"unknown"`, `<1m`→`"just now"`, `Xm ago`/`Xh ago`/`Xd ago`, future→`Xm from now`, `>30d`→`"MMM D"` short date (en-PH).
- `formatPhp(value: number, decimals = 2): string` — `₱` + en-PH locale, min/max fraction = decimals.
- `formatMoney(value: number, currency?: string | null): string` — `${currency ?? "₱"}` prefix, en-PH, always 2 decimals.
- `fmtNum(n: number): string` — `1.2M` / `10.5K` / locale (moved verbatim from campaigns page).
- `actionLabel(t: string): string` — the pause_campaign/pause_ad/adjust_budget/enable_campaign map + title-case fallback (moved verbatim from campaigns page).

- [ ] Write `lib/format.ts`:

```ts
// Shared display formatting. One timeAgo, one peso formatter — pages must not hand-roll these.

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const suffix = diff < 0 ? " from now" : " ago";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m${suffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${suffix}`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d${suffix}`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function formatPhp(value: number, decimals = 2): string {
  return "₱" + value.toLocaleString("en-PH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatMoney(value: number, currency?: string | null): string {
  const amount = value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency ? `${currency} ` : "₱"}${amount}`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function actionLabel(t: string): string {
  const map: Record<string, string> = {
    pause_campaign: "Pause Campaign",
    pause_ad: "Pause Ad",
    adjust_budget: "Adjust Budget",
    enable_campaign: "Enable Campaign",
  };
  return map[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] Write `__tests__/lib/format.test.ts` covering: timeAgo null→"never", garbage→"unknown", 30s→"just now", 5m/3h/2d ago, future→"from now", 45d→short date; formatPhp(1234.5)→"₱1,234.50", formatPhp(1234.5,0)→"₱1,235"; formatMoney(120, "USD")→"USD 120.00", formatMoney(120)→"₱120.00"; fmtNum(1_500_000)→"1.5M", fmtNum(12_345)→"12.3K"; actionLabel("pause_ad")→"Pause Ad", actionLabel("some_new_thing")→"Some New Thing". Use `vi.setSystemTime` for timeAgo cases.
- [ ] `npx vitest run __tests__/lib/format.test.ts` → pass. Commit `feat(ui): shared format helpers (timeAgo, formatPhp, formatMoney, fmtNum, actionLabel)`.

### Task 2: `lib/ui/tones.ts` (domain tone mappers, dedupe the verbatim duplicates)

**Files:**
- Create: `lib/ui/tones.ts`

**Interfaces (produced):**

```ts
import type { BadgeProps } from "@shopify/polaris";
export type Tone = BadgeProps["tone"];

// Meta/Google campaign delivery status. PAUSED is warning app-wide (was grey on Ad Pilot).
export function campaignStatusTone(s: string): Tone {
  if (s === "ENABLED" || s === "ACTIVE") return "success";
  if (s === "PAUSED") return "warning";
  if (s === "REMOVED") return "critical";
  return "info";
}

// Ad Approval workflow status (state machine) — dedupes ad-approvals/page.tsx and [id]/page.tsx.
export function adApprovalStatusTone(status: string): Tone {
  if (status === "approved_to_make_kwarta") return "success";
  if (status === "rejected" || status === "cancelled") return "critical";
  if (status === "needs_revision") return "warning";
  if (status === "draft") return undefined;
  return "info";
}

// Recommendation lifecycle status.
export function recommendationStatusTone(s: string): Tone {
  if (s === "executed") return "success";
  if (s === "failed") return "critical";
  if (s === "rejected") return "warning";
  if (s === "override_approved") return "attention";
  if (s === "executing") return "info";
  return undefined;
}

// P0–P3 priority — unifies content-pilot, store-pilot, draft editor.
export function priorityTone(p: string): Tone {
  if (p === "P0" || p === "P1") return "critical";
  if (p === "P2") return "attention";
  return "info";
}

export function severityTone(severity: string): Tone {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}
```

- [ ] Create the file. `npx tsc --noEmit`. Commit `feat(ui): shared domain tone mappers`.

### Task 3: Adopt shared helpers at every duplicated call site

**Files (modify):** `app/(embedded)/(ad-pilot)/recommendations/page.tsx`, `campaigns/page.tsx`, `ad-approvals/page.tsx`, `ad-approvals/[id]/page.tsx`, `ad-pilot/page.tsx`, `(insights)/insights/page.tsx`, `(insights)/growth-brief/page.tsx`, `(social-pilot)/social-pilot/page.tsx`, `(seo-pillar)/seo-pillar/page.tsx`, `app/(embedded)/page.tsx`, `(market-intelligence)/market-intelligence/page.tsx` + `components.tsx`, `(store-pilot)/store-pilot/page.tsx`, `(content-pilot)/content-pilot/draft/[id]/page.tsx`, `components/ui/approve-confirmation-modal.tsx`, `settings/page.tsx`.

Adoption map (delete local copy, import from `@/lib/format` / `@/lib/ui/tones`):
- [ ] `timeAgo`: delete local defs at recommendations:31, campaigns:49, ad-approvals:53, insights:25, seo-pillar:48, dashboard `page.tsx:188`, growth-brief:73 (its null→"unknown" becomes "never" — acceptable), social-pilot:23 (Today/Yesterday becomes Xd ago — consistency wins). market-intelligence `relativeTime` (components.tsx:67): reimplement body as `return value ? timeAgo(value) : "Never";` keeping its export name/signature so its call sites don't churn.
- [ ] `formatPhp`: dashboard `formatPhp` local def (page.tsx:220) → import with `formatPhp(v, 0)` at its 3 call sites; campaigns `fmtPHP` (:63) → `formatPhp(v)`; market-intelligence `money` (page.tsx:97) and `fmt` (components.tsx:332) → `formatMoney(price, currency)`.
- [ ] Market-intelligence bare bid decimals (page.tsx:551–552): wrap in `formatPhp(Number(...) / 1_000_000)`.
- [ ] `fmtNum` + `actionLabel`: delete from campaigns page, import; delete private `actionLabel` in approve-confirmation-modal.tsx, import.
- [ ] Tones: campaigns `statusTone`→`campaignStatusTone`; ad-pilot inline `c.status === "ACTIVE" ? "success" : undefined` (line 57)→`campaignStatusTone(c.status)`; ad-approvals pages' duplicate `statusTone`→`adApprovalStatusTone`; recommendations `statusBadge` keeps its JSX wrapper but sources tones from `recommendationStatusTone`; content-pilot draft `priorityTone` (:596) and store-pilot `PriorityBadge` (:69) source `priorityTone`; market-intelligence components `severityTone` re-exports from lib (`export { severityTone } from "@/lib/ui/tones";` keeping call sites intact).
- [ ] Leave alone (domain-specific, no duplicate): `roasTone`, `guardBadge`, `platformBadge`, `stalenessTone`, `issueTone`, `marketBadge`, content-pilot Score/Impact/Stage badges, growth-brief passthroughs, settings `connectorBadge`, server-side growth-brief route mappers.
- [ ] Verify: `npx tsc --noEmit`, `npm test`, then commit `refactor(ui): adopt shared format + tone helpers, kill 9 timeAgo and duplicate tone mappers`.

### Task 4: Skeletons + last-updated indicators (item 11)

**Files (modify):** recommendations, campaigns, ad-pilot, insights, images, ad-approvals pages.

- [ ] Replace Spinner/"Loading…" loading states with shared skeletons from `@/components/ui/states`:
  - recommendations:~211 list loading → `<Card><ListSkeleton lines={6} /></Card>`
  - campaigns list loading (:~460) → `<Card><ListSkeleton lines={6} /></Card>`; summary row renders only when loaded (unchanged).
  - ad-pilot stat row: when `loading`, render `<StatGridSkeleton count={4} />` instead of "—" tiles; table loading → `<ListSkeleton lines={5} />`.
  - insights pilot cards `Loading…` (:218) → `<ListSkeleton lines={2} />`.
  - images table loading (:~223 Spinner) → `<ListSkeleton lines={6} />`.
  - ad-approvals full-page Spinner (:~218) → `<ListSkeleton lines={6} />`.
- [ ] Last-updated indicators on cache-rendered pages (campaigns already has one): ad-pilot and insights have no fetchedAt in their payloads — skip rather than invent; images payload has `cachedAt` — add `PageData.cachedAt?: string` and render `Updated {timeAgo(data.cachedAt)}` subdued text next to the page title stats when present.
- [ ] Verify `npx tsc --noEmit`; commit `refactor(ui): standardize loading states on shared skeletons; show images cache age`.

### Task 5: Sort/filter/search on long lists (item 12, content-pilot pattern)

**Files (modify):** recommendations, ad-approvals, seo-pillar, images pages.

All client-side over already-loaded arrays (matching content-pilot's chained `.filter().sort()` + `TextField clearButton` + `Select` pattern at content-pilot/page.tsx:1036–1060). Concretely:
- [ ] **Recommendations**: add `searchQuery` TextField + platform `Select` (All/Meta/Google — wire to the API's existing `platform` param so it filters server-side across pages) + sort `Select` (Newest — default / Confidence). Client sort for confidence over loaded rows: `[...recs].sort((a,b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))`. Search filters loaded rows on `targetEntityName`/`skillName`/`rationale`.
- [ ] **Ad-approvals**: search TextField filtering `rows` on `campaignId`/`submitterId` (case-insensitive), applied inside `bucket()`'s result.
- [ ] **SEO pillar — Keywords tab**: search TextField over `keywords` on `keyword`; header-click sort via DataTable `sortable={[true,true,true,true,true,false]}` + `onSort` handler sorting the mapped rows (sort state: `{index, direction}`).
- [ ] **SEO pillar — Opportunities tab**: search TextField over `oppRows` source `data.opportunities` on `query`/`landingPage` + type `Select` built from distinct `type` values. (Column sort already exists via `sortable` prop — verify `onSort` is wired; if the existing `sortable` array has no `onSort`, add one with numeric compare on Impr./Volume/Potential.)
- [ ] **Images**: filter pills (All / Missing alt / Suggested / Set) as slim Buttons + search TextField on `productTitle`.
- [ ] Verify `npx tsc --noEmit`; commit `feat(ui): search/filter/sort on recommendations, ad-approvals, seo tables, images`.

### Task 6: Nav — close the App Bridge drift + mobile toggle (item 7)

**Files (modify):** `lib/navigation.ts`, `app/(embedded)/layout.tsx`.

- [ ] `lib/navigation.ts`: add `appBridge: true` to Content (`/content-pilot`), Social (`/social-pilot`), Competitors (`/market-intelligence`), Unified Report (`/insights`) — label it "Insights" for the flat App Bridge menu context is wrong; keep labels as-is (they render fine). Leave Images/Reports/Growth Brief/Workspace sidebar-only (deliberate subset is fine; the drift items the audit named get covered by their section's primary link). Net App Bridge menu: Dashboard, Campaigns, Recommendations, Ad Approvals, SEO, Content, Social, Competitors, Unified Report, Settings.
- [ ] `app/(embedded)/layout.tsx`: add mobile toggle —

```tsx
const [mobileNavActive, setMobileNavActive] = useState(false);
const toggleMobileNav = useCallback(() => setMobileNavActive((v) => !v), []);
const topBar = <TopBar showNavigationToggle onNavigationToggle={toggleMobileNav} />;
// ...
<Frame
  navigation={nav}
  topBar={topBar}
  showMobileNavigation={mobileNavActive}
  onNavigationDismiss={toggleMobileNav}
>
```

(import `TopBar` from Polaris, `useState`/`useCallback` from react).
- [ ] Verify `npx tsc --noEmit` + `npm run build`; commit `fix(nav): App Bridge menu covers all pilots; mobile nav toggle on Frame`.

### Task 7: Fold `/seo` into `/seo-pillar` (item 8)

**Files:**
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx` (port AI brief), `app/(embedded)/(seo-pillar)/seo/page.tsx` (becomes redirect), `lib/navigation.ts` (drop `/seo` item + its special-case match).

- [ ] Port the AI SEO Brief from `/seo` into the pillar page: copy the brief state (`brief`, `briefLoading`, `briefError`), the `POST /api/seo/brief` handler, the `BriefRenderer` component, and the brief Card verbatim from `seo/page.tsx`; add a "Generate SEO Brief" `secondaryAction` on the pillar Page and render the brief Card at the top of the Overview tab when present.
- [ ] Replace `seo/page.tsx` content with a context-preserving client redirect:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { withShopifyContextUrl } from "@/hooks/use-auth-fetch";

// /seo was a strict subset of /seo-pillar's Overview tab (audit item 8) — folded in 2026-07.
export default function SeoRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace(withShopifyContextUrl("/seo-pillar")); }, [router]);
  return null;
}
```

- [ ] `lib/navigation.ts`: SEO Pilot section becomes a single item `{ label: "SEO", href: "/seo-pillar", match: "prefix", appBridge: true }`; delete the `/seo` special-case line in `matchesNavigationItem` (note: `/seo-pillar` moves from `match: "exact"` to `"prefix"` — `startsWith("/seo-pillar")` needs no special case). Remove the now-dead "SEO Details" secondaryAction on the pillar page (it pointed at `/seo`).
- [ ] Verify `npx tsc --noEmit`, `npm run build`; commit `refactor(seo): fold /seo into /seo-pillar — brief ports to Overview, /seo redirects`.

### Task 8: Dashboard leads with the Pending Review inbox (item 9)

**Files:**
- Modify: `app/(embedded)/page.tsx`

- [ ] Relocate the Pending Review block (currently lines ~1209–1272, gated on `topPendingRecs.length > 0`) to immediately after the banners (before the Operations row at ~958). Structure change: drop the leading `<Layout.Section><Divider /></Layout.Section>` from the moved block and instead leave a `<Divider />` section where it used to sit only if needed between Intel and Skill Insights (Intel row already ends with its own divider at ~1274 — keep exactly one divider between Intel and Skill Insights). No state moves: `recAction`, `approveRec`, `rejectRec`, `actionLabel` are all top-level (verified).
- [ ] Verify `npx tsc --noEmit`, `npm run build`, `npm test`.
- [ ] GROW: update `.mex/ROUTER.md` (shared helpers live in `lib/format.ts`/`lib/ui/tones.ts` — pages must use them; nav single-source facts; `/seo`→`/seo-pillar` redirect; dashboard inbox-first), bump `last_updated`.
- [ ] Commit `feat(dashboard): pending-review inbox leads` + docs commit; push origin main.

## Self-review notes

- Item 10 → Tasks 1–3; item 11 → Task 4; item 12 → Task 5; item 7 → Task 6; item 8 → Task 7; item 9 → Task 8. ✔
- Deliberate exclusions recorded inline (domain-specific tone mappers stay; ad-pilot/insights get no last-updated because their payloads carry no timestamp — inventing one is out of scope).
- market-intelligence `relativeTime`/`severityTone` keep their exported names as thin wrappers so `components.tsx` call sites don't churn.
- Survey facts baked in: dashboard block relocation is state-free; `/seo`'s only non-subset feature is the AI brief; nav is already single-source.
