# Functionality Roadmap Implementation Plan (Master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Structure note (scope check):** This spec spans ~12 independent subsystems. Per writing-plans scope rules, it is decomposed into **phases, each a self-contained sub-plan boundary that ships working, testable software on its own**. Execute phases in order (dependencies noted). Before starting a phase, write its code-complete task plan as `docs/superpowers/plans/YYYY-MM-DD-phase<N>-<slug>.md` using superpowers:writing-plans (the pattern used for the 2026-07-03 tier2 and tier34 plans), then execute it. This master document locks scope, order, file boundaries, interfaces, schema changes, and acceptance criteria for every phase.

**Goal:** Close every identified functionality gap — the plugin currently observes far more than it acts — plus audit items 13 (ad-approvals stepper/timeline/names), 16 (monolith splits), 17 (a11y/theming), and remove all Google Ads code.

**Architecture:** Reuse the proven loop pattern everywhere: ingest → insight → recommendation/task → operator approval → gated executor → audit log → outcome check. New write paths copy the alt-text apply pattern (operator-clicked, Zod-validated, rate-limited, audit-logged Shopify/Meta mutation). External notifications reuse the existing `lib/alerts.ts` webhook transport. No new frameworks.

**Tech Stack:** Next.js 14 App Router, Polaris, Prisma/PostgreSQL, Meta Graph API, Shopify Admin GraphQL 2025-01, Vitest, PM2/Linode deploy via `scripts/linode-deploy.mjs`.

## Global Constraints

- **No Google Ads, ever** (user directive 2026-07-03). Phase 0 deletes those code paths; no later phase may reference `google_ads`.
- Live external writes (Meta or Shopify) only via operator approval; recommendation-driven executions additionally require `EXECUTE_APPROVED_LIVE_ENABLED=true` AND status `approved`/`override_approved`. New execution surfaces get their own env kill-switch, defaulting off.
- `pause_ad` must never enter `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts`.
- All DB access via `import { prisma } from "@/lib/db"`. Embedded API routes: `await requireAppAuth(req)` first statement. Cron routes: `requireCronAuth(req)` then `acquireJobLock`.
- Every external write creates an `AuditLog` row.
- Shared UI helpers are mandatory: `lib/format.ts`, `lib/ui/tones.ts`, `components/ui/states.tsx` — no hand-rolled timeAgo/tones/skeletons.
- Migrations: additive only; `prisma migrate deploy` runs on prod via the deploy script. New required env vars go in `.env.example` AND prod `/opt/autopilot/.env` before deploy.
- Verification gate per phase: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean; new API/job logic gets Vitest coverage in `__tests__/` following existing mock patterns (see `__tests__/api/recommendations-revert.test.ts`, `__tests__/api/images-apply.test.ts`).
- After each phase: GROW (`.mex/ROUTER.md` update), commit+push to main. Deploy at the checkpoints marked 🚀 (ask nothing; deploy per `.mex/patterns/deploy.md`).

## Phase order & dependency map

| Phase | Title | Size | Depends on |
|---|---|---|---|
| 0 | Google Ads removal | S | — |
| 1 | Operator visibility: external alerts + outcome surfacing | S/M | — |
| 2 | SEO meta write-back to Shopify | S/M | — |
| 3 | Insights → actions (fatigue → recommendations) | M | 1 (outcome UI shows results) |
| 4 | Shopify orders ingestion + real-revenue ROAS | M | — |
| 5 | Ad-approvals stepper, timeline, human names (item 13) | M | — |
| 6 | Market Intelligence → advisory recommendations | M | 4 (margin-aware pricing) |
| 7 | Ad launch: approved ads → Meta (paused) | L | 5 |
| 8 | Monolith splits (item 16) | M×3 | best after 3,5,6 land their UI |
| 9 | A11y/theming pass (item 17) | M | folded into 8 per page + final sweep |

🚀 Deploy checkpoints: after Phase 1, after Phase 4, after Phase 7, after Phase 9.

> **Removed by user decision (2026-07-03):** Social Pilot MVP (blog → Facebook page posts) is explicitly out of scope for this roadmap — do not build it or propose it as part of these phases. Gap #5 (Social Pilot is a shell) stays open and unaddressed by choice; the social-pilot page remains as-is apart from the Phase 8/9 refactor-and-theming treatment every page gets.

---

## Phase 0 — Google Ads removal (housekeeping)

**Rationale:** Directive: Meta only. Dead branches add risk and UI noise (the Recommendations platform filter currently offers "Google Ads").

**Files:**
- Delete: `lib/connectors/google-ads.ts`
- Modify: `jobs/fetch-ads-data.ts` (remove google fetch step), `jobs/execute-approved.ts` (remove the `rec.platform === "google_ads"` branch ~line 288 and google before-state import), `jobs/check-outcomes.ts` (remove google snapshot comparison if present), `lib/guardrails.ts` / `lib/skills/*` (remove google-specific action support in `isSupportedAction`), `app/api/recommendations/route.ts` (drop `google_ads` from `VALID_PLATFORMS`), `app/(embedded)/(ad-pilot)/recommendations/page.tsx` (remove the Google Ads option from the platform Select — with only Meta left, remove the Select entirely), `platformBadge` in the same file (Meta-only), any `SkillInsight` producers with Google vocabulary (see Phase 3 note on search-term insights).
- Tests: update any tests referencing `google_ads` (grep `__tests__` for it); add a regression test asserting `VALID_PLATFORMS` = `{meta}` and that a `google_ads` rec is rejected by `isSupportedAction`.

**Tasks:** (1) grep-driven inventory of every `google_ads`/`google-ads` reference; (2) delete connector + executor branch + fetch step with test updates; (3) UI cleanup; (4) verify gate + commit.

**Acceptance:** `rtk grep -rn "google.ads\|google_ads" app lib jobs --max 5` returns only comments/migrations; suite green.

---

## Phase 1 — Operator visibility: external alerts + outcome surfacing (gaps #7, #8)

**Rationale:** Smallest changes with the largest trust payoff: the operator learns about pending work without opening the app, and can finally see whether past approvals worked.

### 1A — External notifications
**Design locked:** No email infra exists; `lib/alerts.ts` already posts JSON to `ALERT_WEBHOOK_URL`. Extend that transport rather than adding email. Two mechanisms:
1. **Event alerts** — fire through `lib/alerts.ts` when: new recommendations created by `run-skills` (count > 0), a live execution fails, a guardrail hard-block is created, an ad-approval SLA escalates. Call sites: `jobs/run-skills.ts`, `jobs/execute-approved.ts`, `lib/ad-approval` SLA cron.
2. **Daily digest cron** — new `jobs/daily-digest.ts` + `app/api/cron/daily-digest/route.ts` (standard `requireCronAuth` + `acquireJobLock` pattern from `.mex/patterns/add-cron-job.md`): one webhook message summarizing pending recs (and `recsPendingOver7Days`), yesterday's executions + outcomes, failed jobs, content published, ad-approvals awaiting review. Cron entry documented in `docs/CRON.md`, installed in `/etc/cron.d/autopilot` at deploy.

**Files:** Create `jobs/daily-digest.ts`, `app/api/cron/daily-digest/route.ts`, `__tests__/jobs/daily-digest.test.ts`. Modify `lib/alerts.ts` (add typed `sendOperatorAlert(kind, payload)` wrapper), the three call sites, `docs/CRON.md`, `.env.example` (document `ALERT_WEBHOOK_URL`; it may point at a Slack/Discord/Telegram-bridge webhook — operator's choice; prod value set before deploy).

**Interfaces:** `sendOperatorAlert(kind: "new_recommendations" | "execution_failed" | "hard_block" | "sla_escalation" | "daily_digest", payload: Record<string, unknown>): Promise<void>` — never throws (log-and-continue), so alert failures cannot break jobs.

### 1B — Outcome surfacing
**Design locked:** `Recommendation.outcome`/`outcomeCheckedAt` already exist and `jobs/check-outcomes.ts` populates them. Surface only — no pipeline change.
- Executed tab (`app/(embedded)/(ad-pilot)/recommendations/page.tsx`): outcome badge per rec (`improved`→success, `worsened`→critical, `no_change`/`inconclusive`→subdued) + "checked Xd ago", tone map added to `lib/ui/tones.ts` as `outcomeTone(o: string): Tone`.
- API: `app/api/recommendations/route.ts` already returns full rows (outcome included) — verify, no change expected.
- Dashboard: one "Outcome win rate (90d)" stat in the Operations row fed by a new field on the existing dashboard payload (`app/api/dashboard/...` route that computes `pendingCount` — add `outcomeWinRate: { improved: number; worsened: number; total: number } | null`).

**Acceptance:** With `ALERT_WEBHOOK_URL` set to a test endpoint, a manual digest run posts one message; executed recs show verdict badges; dashboard shows win rate. 🚀 Deploy.

---

## Phase 2 — SEO meta write-back to Shopify (gap #3)

**Rationale:** On-Page Health flags meta problems and Content Pilot drafts `seo-fix` fixes, but nothing writes them to the store. The alt-text apply path (Tier 2) is the template.

**Design locked:**
- New `lib/shopify-admin.ts` functions: `updateProductSeo(productId, { title?, description? })` using `productUpdate` with `seo: { title, description }` input, and `updateArticleSeo`/blog handling only if the seo-fix target is an article (ArticleRecord has the handle; blog articles already have a write path in `lib/connectors` blog publisher — reuse it). **At phase-plan time, verify each mutation shape via the shopify-plugin:shopify-admin skill doc search** (the local validator is broken; search returns doc-exact examples — done successfully for `productUpdateMedia`).
- New `POST /api/content-pilot/proposals/[id]/apply-seo` route: for `seo-fix` proposals only; resolves the target (product vs article) from the proposal's target handle; operator-clicked; Zod-validated (title ≤ 70 chars, description ≤ 320); rate-limited; `AuditLog` action `seo_meta_applied`; marks the proposal published/applied.
- Draft page (`draft/[id]/page.tsx`): "Apply to store" primary action for seo-fix proposals (replacing the blog-publish action that doesn't fit them), with the existing confirm-modal pattern.
- On-Page Health tab: "Create fix" already promotes to proposals — verify the loop end-to-end and document it in `.mex/ROUTER.md`.

**Files:** Modify `lib/shopify-admin.ts`, `app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx`. Create `app/api/content-pilot/proposals/[id]/apply-seo/route.ts`, `__tests__/api/content-pilot-apply-seo.test.ts` (mock `@/lib/shopify-admin`, assert mutation args, audit log, 400 on over-length, 502 on Shopify error — mirror `images-apply.test.ts`).

**Acceptance:** A seo-fix draft's Apply writes the meta to Shopify (verified against dev store or one real product), is audit-logged, and the proposal leaves the queue.

---

## Phase 3 — Insights → actions (gap #2)

**Rationale:** Fatigue cards say "this ad is dying" with no lever. Convert insights into the existing recommendation pipeline so they inherit approval, guardrails, execution, undo, and outcomes for free.

**Design locked:**
- **Fatigue → `pause_ad` recommendations:** new skill step (in `jobs/run-skills.ts` skill roster or a dedicated skill under `lib/skills/`) that reads the latest `SkillInsight` fatigue items with status `urgent`/`dead`, and creates `Recommendation` rows (`platform: "meta"`, `actionType: "pause_ad"`, target = the ad, rationale from the insight, confidence from fatigue severity). Dedup rule: skip if a pending/approved rec already targets the same ad with the same action (mirror the idempotency style used in `jobs/fetch-market-intel.ts`). `pause_ad` is already executable and — by standing rule — never conversion-gated.
- **Fatigue "refresh creative" → `StoreTask`:** for `urgent` (not yet dead) ads, create a `StoreTask` ("Refresh creative for {ad}") so it lands in the operator task list rather than pretending to be executable.
- **Search-term insights:** their vocabulary (bids, match types, negative keywords) is Google Ads — **out of scope by directive**. The phase-plan must either delete the search-term skill or re-target it as Meta search/audience commentary; decide by reading `lib/skills/` at phase-plan time and prefer deletion if it's Google-flavored.
- **Competitor insights:** create `ContentProposal` seeds ("competitor is testing X — draft a counter-angle") — advisory only.

**Files:** Modify `jobs/run-skills.ts` + relevant `lib/skills/*`; tests in `__tests__/jobs/` (given a fatigue insight fixture → expect a pause_ad Recommendation with dedup on second run).

**Acceptance:** Seeded fatigue insight produces a pending `pause_ad` recommendation visible on the Recommendations page; approving it executes through the normal path; second skill run creates no duplicate.

---

## Phase 4 — Shopify orders ingestion + real-revenue ROAS (gap #4)

**Rationale:** All conversion value is Meta-reported. The store's actual sales are the ground truth every other loop should calibrate against.

**Design locked:**
- New connector `lib/connectors/shopify-orders.ts`: Admin GraphQL `orders` query (created_at range, financial status, current total price, line-item product ids), paginated like `fetchProductImages`; requires the `read_orders` access scope — **the phase plan's first task is verifying/expanding the Shopify token scopes** (client-credentials token; scope change may need app config update — check `shopify.app.toml` and the token grant; if blocked, stop and surface to operator).
- New model `DailySales` (`date @unique`, `orders Int`, `revenue Decimal`, `aov Decimal`, `currency String`, `fetchedAt`) + raw order snapshots into the existing `RawSnapshot` table (`source: "shopify_orders"`). Migration is additive.
- New job step in `jobs/fetch-ads-data.ts` (or a sibling `jobs/fetch-orders.ts` on the daily cron) writing yesterday + backfill 28 days on first run.
- Consumers: dashboard "Revenue (Shopify) vs conversion value (Meta)" comparison in the Performance row; `jobs/check-outcomes.ts` gains revenue context for verdicts; guardrails can later reference real revenue (not in this phase).

**Files:** Create `lib/connectors/shopify-orders.ts`, `jobs/fetch-orders.ts`, `app/api/cron/fetch-orders/route.ts` (or fold into existing daily cron — decide at phase-plan time per `docs/CRON.md` layout), migration, `__tests__/jobs/fetch-orders.test.ts`. Modify dashboard payload route + `app/(embedded)/page.tsx` Performance row.

**Acceptance:** `DailySales` rows populate for the trailing 28 days; dashboard shows Shopify revenue next to Meta conversion value; job is idempotent per day. 🚀 Deploy (includes migration).

---

## Phase 5 — Ad-approvals stepper, timeline, human names (item 13)

**Design locked:**
- **Stage stepper** on `app/(embedded)/(ad-pilot)/ad-approvals/[id]/page.tsx`: horizontal steps AI pre-review → Brand → Conversion → Technical → Penultimate → Final → Approved, derived from a pure function `stageProgress(status: string): { steps: Array<{ key, label, state: "done" | "current" | "blocked" | "pending" }> }` in a new `lib/ad-approval/stage-progress.ts` (unit-testable against `lib/ad-approval/constants.ts` STATUS values — including needs_revision/rejected/cancelled mappings).
- **Unified timeline**: merge `AdReview` rows, `AdRevision` rows, and `AdApproval` audit entries into one chronological list (server-side in the detail API route, returned as `timeline: Array<{ at, actor, kind, summary }>`).
- **Human-readable names**: list API (`app/api/ad-approvals/route.ts`) joins `AppUser` for `submitterId`/reviewer ids (fall back to the raw id string when no AppUser row) and includes `campaignLabel` (the `campaignId` field is a free-text label already — display it verbatim; if it matches a Meta campaign id in cached campaign data, show the campaign name).

**Files:** Create `lib/ad-approval/stage-progress.ts` + `__tests__/lib/stage-progress.test.ts`. Modify `app/api/ad-approvals/route.ts`, `app/api/ad-approvals/[id]/route.ts`, both ad-approvals pages.

**Acceptance:** Detail page shows where in the pipeline an ad sits and what's next; list shows names not ids; stepper states unit-tested for all 15 statuses.

---

## Phase 6 — Market Intelligence → advisory recommendations (gap #6)

**Design locked:**
- **De-noising first:** add a smoothing layer over `ShoppingPriceHistory` (rolling 7-day median per competitor-product match, ignore single-capture outliers > ±40% of median) in `lib/market-intel/price-signal.ts` (pure functions, unit-tested against fixture series).
- **Advisory outputs, not auto-execution:** stable price gaps (our price above/below smoothed competitor median by a threshold from `GuardrailConfig`) create `StoreTask` rows ("Review pricing for {product}: competitors at ₱X vs ours ₱Y for 14+ days") — no price is ever changed automatically.
- **Keyword gaps → ContentProposal seeds** (extend the existing keyword_gap `MarketInsight` consumer).
- **Falo fix is a human task:** create a persistent `StoreTask`/notification telling the operator to pull the numeric page ID from Facebook's Page Transparency panel — the silent-zero capture must stop being silent (also alert via Phase 1 `sendOperatorAlert` when any active competitor page captures 0 ads for 7+ consecutive runs).

**Files:** Create `lib/market-intel/price-signal.ts` + tests. Modify `jobs/fetch-market-intel.ts` (task/insight creation + zero-capture alert), market-intelligence page (show smoothed signal + task links).

**Acceptance:** Fixture price series with noise produces a stable signal; a persistent gap creates exactly one StoreTask (idempotent); zero-capture competitor triggers an operator alert.

---

## Phase 7 — Ad launch: approved ads → Meta, paused (gap #1)

**Rationale:** The largest gap: `approved_to_make_kwarta` has no consumer. Close it conservatively — the system creates the ad **in PAUSED state**; a human presses go in Ads Manager (or via a follow-up `enable_campaign`-style action later).

**Design locked:**
- New `lib/connectors/meta-ad-launch.ts`: create creative + ad via Marketing API (`/act_{account}/adcreatives`, `/act_{account}/ads` with `status: "PAUSED"`), from the approved `AdRevision`'s copy/creative JSON. Image/video upload only if the revision carries an asset URL; text-only creative otherwise (v1: link ad with copy; the ROUTER notes creative upload flow was always the incomplete part — this phase completes text+link ads first, asset upload second).
- New job `jobs/launch-approved-ads.ts` + cron route: picks `AdApproval` rows in `approved_to_make_kwarta` without a `launchedAdId`, launches paused, writes `launchedAdId`/`launchedAt` (schema addition), audit-logs `ad_launched_paused`, notifies via `sendOperatorAlert`. Gated by `AD_LAUNCH_ENABLED=true` (defaults off) — separate from `EXECUTE_APPROVED_LIVE_ENABLED`.
- Failure path: `launchError` recorded on the row + surfaced on the detail page with retry.
- Also unblocks: the ad-approval detail page shows launch state as the final stepper step (extends Phase 5's `stageProgress` with a `launched` step).

**Files:** Migration (AdApproval.launchedAdId/launchedAt/launchError), `lib/connectors/meta-ad-launch.ts`, `jobs/launch-approved-ads.ts`, cron route, tests (mock Meta client; assert paused status, idempotency via launchedAdId, flag-off = no-op), detail-page state.

**Acceptance:** With the flag on and a test approval, a PAUSED ad appears in the Meta account tied to the approval record; re-runs don't duplicate; flag off = zero Meta calls. 🚀 Deploy.

---

## Phase 8 — Monolith splits (item 16) — one sub-plan per page

Order: `content-pilot/page.tsx` (1,820 lines) → dashboard `page.tsx` (~1,430) → `seo-pillar/page.tsx` (~1,100). Each is its own execution plan with the same recipe:
- Extract each rendered section into `app/(embedded)/<route>/components/<Section>.tsx` files (co-located, not in the global `components/`), moving section-scoped state down and lifting only shared state; target: page file < 400 lines of composition.
- **Zero behavior change** — verify with `npm run build` bundle diff sanity and manual click-through of every action on the page (the /verify skill).
- Campaigns (551 lines) explicitly skipped — under threshold after Tier-4 slimming.

**Acceptance per page:** identical behavior, page file < 400 lines, no new lint/type errors, all page actions exercised once.

---

## Phase 9 — A11y & theming pass (item 17)

**Rule going forward + retrofit:**
- Replace hardcoded hexes with Polaris tokens (`var(--p-color-...)`): known offenders `roasBarColor`/`ConfBar` (campaigns), `stalenessStyle`/`STATUS_DOT_COLOR` (dashboard), sparkline colors, market-intelligence bars.
- Replace emoji-as-icons (▲▼ ✓ ✗ 💰 ⚠) with Polaris icons (`@shopify/polaris-icons`) + text labels; keep emoji only in human-facing copy where decorative.
- Color-only signals get a shape/text second channel (trend arrows with sr-only text, badges instead of bare colored bars).
- Focus/keyboard: custom clickable divs become `Button variant="monochromePlain"` or get `tabIndex`/`role`/`onKeyDown`; scrollable HTML previews get `tabIndex={0}` + `role="region"` + label.
- Execution: fold into each Phase-8 page as it's split (the retrofit is cheap when the section is already being moved), then one final sweep over the remaining pages with the chrome-devtools a11y-debugging skill as the checker (contrast + keyboard walk on Dashboard, Campaigns, Recommendations, Ad Approvals).

**Acceptance:** No raw hex colors in `app/(embedded)` (`rtk grep -rn "#[0-9a-f]\{6\}" app/(embedded)` clean except third-party requirements); keyboard-only walk can reach and trigger every action on the four core pages; dark mode renders legibly. 🚀 Final deploy.

---

## Explicitly resolved scope questions

- **Store Pilot scope (gap #9):** resolved without a new pillar build — Store Pilot becomes the home of operator tasks produced by Phases 2 (meta fixes), 3 (creative-refresh tasks), and 6 (pricing reviews). Its page gets the task queue treatment during Phase 8/9, not a bespoke feature set.
- **Search-term insights:** Google-flavored → delete or re-target in Phase 3; never rebuilt for Google.
- **Notifications transport:** webhook (`ALERT_WEBHOOK_URL`) — no email infra will be added in this roadmap.
- **Repricing:** advisory tasks only; automatic price changes are out of scope until the operator asks.

## Self-review notes

- Coverage: gaps #1→Phase 7, #2→3, #3→2, #4→4, #5→deferred by user decision (2026-07-03), #6→6, #7→1A, #8→1B, #9→resolved scope note; item 13→Phase 5, 16→8, 17→9; Google Ads removal→Phase 0. ✔
- Every phase names exact files, models, env flags, and acceptance criteria; code-complete steps are deliberately deferred to per-phase plans per the scope-check decomposition declared in the header.
- Interface names introduced here and reused later: `sendOperatorAlert` (1A, used by 6 and 7), `outcomeTone` (1B), `stageProgress` (5, extended by 7), `DailySales` (4). Consistent throughout.
- External-scope risks called out where a phase can dead-end (Shopify `read_orders` scope in 4, Marketing API ad-create permissions in 7): each phase's first task is the permission check, stop-and-surface if blocked.
