# Agriko Brand SERP 14-Day Displacement Sprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push FDA Advisory No. 2026-0489 outside the first 20 organic Google results for the exact Philippine query `agriko` through a focused 14-day content and earned-authority sprint that strengthens, complements, and does not duplicate Agriko's active topical map.

**Architecture:** Run two tracks in parallel from day zero. The measurement track converts the existing Serper command into an authenticated, idempotent Autopilot job and schedules browser validation without requiring the operator to remember it. The content track improves the already-ranking About asset, strengthens the map-owned provenance chain, and pitches two evidence-backed Philippine editorial stories; no affected product page, generic profile, marketplace, social channel, or duplicate brand article is used.

**Tech stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, `RawSnapshot`, `JobRun`, existing cron locks and alerts, Serper Organic Search, Playwright MCP with the installed Windows Chrome extension, Google Search Console, Google Ads Keyword Planner for Philippines geo target `2608`, Shopify SEO Pilot, Content Pilot, and governed Store Tasks.

## Global Constraints

- Market: Philippines, with separate national and Cebu desktop/mobile observations and `Asia/Manila` reporting.
- Active guide: package `agriko-topical-map-2026-07-12`, strategy version `2026-07-12`, SHA-256 `f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c`.
- The topical map guides ownership, intent, links, evidence, and review constraints; it is not replaced, duplicated, or treated as an exhaustive prohibition on complementary work.
- Google Ads is the keyword-demand source. DataForSEO is excluded.
- The advisory and closely associated cacao/turmeric product URLs are excluded from campaign content and internal-link promotion.
- Campaign content must not discuss, rebut, imitate, summarize, or optimize around the advisory.
- No Instagram, Shopee, Waze, ShopMetro, YouTube, Merchant Center, marketplace, generic directory, or social-profile execution.
- No fake reviews, doorway pages, copied articles, fabricated relationships, link schemes, undisclosed placements, or mass press-release syndication.
- No live Shopify write is authorized by this document. Existing proposal, review, Store Task, and execution controls remain mandatory.
- Measurement jobs are read-only and must never call Shopify or advertising mutation connectors.
- The operator must approve factual identity evidence, final content, outreach, and the one-time browser scheduler installation; recurring observations and alerts must then run without operator memory.

---

## 1. Objective and Success Criteria

### Baseline

- Connected Windows Chrome captured the advisory at organic position 4 on 2026-07-15 using `q=agriko`, `gl=ph`, `hl=en`, and `pws=0`.
- The same capture found Agriko homepage position 1, Facebook position 2, Shopee position 3, the advisory position 4, Instagram position 5, Agriko About position 6, Waze position 7, and ShopMetro position 8.
- Serper returned only six organic results per localized request and did not reproduce the advisory. Its current `not_in_top_30` label is not credible coverage evidence.

### Sprint target

- Interim milestone: the advisory is outside the first 10 organic results in browser-validated Philippine observations.
- Primary target: the advisory is position 21 or lower, or absent from the first 20, in the browser-validated Philippine result set.
- Stability confirmation: after first crossing the primary threshold, at least 27 of the next 28 scheduled automated observations remain outside the top 20, with a browser validation confirming the state.
- The 14-day action sprint does not become a 30-, 60-, or 90-day roadmap. Automated monitoring may continue after day 14.

### Not success

- Moving the advisory from position 4 to position 5 or 6.
- Serper reporting absence while returning fewer than 30 organic results.
- Publishing content that never ranks above the advisory.
- Completing briefs, audits, outreach, or automation without ranking movement.
- Increasing impressions without observed displacement.

---

## 2. Philippine Market Evidence

| Evidence | Philippine finding | Planning consequence |
|---|---|---|
| Google Ads, Philippines `2608`, English `1000` | `agriko`: 40 average monthly searches, medium competition | Optimize for a small exact-brand SERP, not a high-volume generic campaign |
| Google Ads | `agriko 5 in 1 tea`: 30; `agriko turmeric`: 10; `agriko farm`: 10 | Use `agriko farm` only where it matches the About/farming guide; do not expand campaign work into affected products |
| Google Ads | `agriko philippines`, `agriko fda`, and long cacao/advisory variants have no reportable volume | Do not create advisory-response or exact-product content |
| GSC | Homepage: 857 branded impressions, 35 clicks, average position 3.93 | Preserve homepage ownership and current title |
| GSC plus browser | About: 143 branded impressions, average position 3.17, browser position 6 | About is the fastest owned candidate to improve and measure |
| GSC | Find Agriko: 61 branded impressions, average position 1.29 | Preserve its location intent; add only the map-required buying-guide body link |
| GSC | Journal: 45 branded impressions, average position 6.60 | Treat as support; do not retarget it to generic `agriko` |
| Current SERP | Government authority plus exact brand/product wording places the advisory above most owned pages | One-domain publishing alone is insufficient; independent Philippine editorial assets are required |

All rank observations must disclose provider, `gl`, location text, language, device, timestamp, result depth, and whether signed-out state was confirmed.

---

## 3. Current SERP Diagnosis

1. The advisory matches the brand exactly in its title and URL and sits on an authoritative Philippine government domain.
2. Agriko's homepage already owns position 1, so a homepage retitle is unnecessary and risks existing performance.
3. Google currently shows strong host diversity: one Agriko domain result, social/marketplace results, the FDA page, a second Agriko page, a map result, and a retailer result.
4. About is already the second Agriko-owned browser result at position 6 and is the only owned page with both material branded GSC evidence and direct page-one browser evidence.
5. The map-owned Christies Paglinawan page, Farming Practices page, farming pillar, sustainable-farming spoke, Find Agriko page, and Journal can strengthen entity and provenance signals, but none is credited as displacement until observed above the advisory.
6. The live About page identifies Gerry Paglinawan as founder and schema declares founding year 2016, while its narrative starts in 2013. The active map gives Christies Paglinawan the secondary variant `Agriko founder`, but the live person page identifies Christies as CEO. This must be resolved from first-party evidence before editing either page.
7. Farming and buying guides currently surface an unrelated UGC-ad article in Related Articles. That weakens topical recirculation and should be corrected only on the selected campaign pages.

---

## 4. Topical-Map Alignment

| Existing map asset | Map role and decision | Campaign use |
|---|---|---|
| `/` | Brand/store site hub; primary `Agriko`; P1; keep | Defend position 1; retain title, canonical, and organization identity |
| `/pages/about` | Brand trust; `Agriko organic farm`; P2; keep and receive provenance links | Primary owned displacement candidate |
| `/pages/christies-paglinawan` | Person/trust; Christies Paglinawan; P2; keep and support E-E-A-T | Supporting entity asset; correct secondary role from founder to CEO if evidence confirms |
| `/pages/farming-practices` | Organic-farming trust page; P2; keep and link with farming pillar | Supporting provenance bridge to About and farming content |
| `/blogs/news/what-is-organic-farming` | Farming pillar; keep and strengthen | Retain existing link to Farming Practices and add only evidenced Agriko provenance |
| `/blogs/news/sustainable-rice-farming` | Sustainability spoke; P0 indexation issue | Retain separate intent; ensure the map-required Farming Practices body link |
| `/pages/find-agriko` | Location page; `find Agriko`; P1; keep and link from buying guides | Preserve intent; add the required body link from the where-to-buy guide |
| `/blogs/news/where-to-buy-organic-rice-in-the-philippines` | Commercial-investigation hub; P1; keep and strengthen | Add the exact map-required body link to Find Agriko |
| `/blogs/news` | Journal index; P2; keep; improve discovery only if needed | Supporting hub; no generic brand retargeting |
| `/pages/events` | Brand-trust page; P3; keep | Use only for verified public milestones or DTI recognition; otherwise no change |

### Existing governed work

- Production contains 398 approved Content Proposals, one pending Content Proposal, and 482 pending topical-map Store Tasks.
- The sole pending Content Proposal concerns the red-rice-versus-brown-rice article and does not implement this campaign.
- Pending Store Tasks already contain canonical/indexation advisories for About, Farming Practices, Find Agriko, Events, Contact, FAQ, and collections. The sprint must not recreate those advisories.
- This plan adds content/provenance and exact-link deltas only; generic canonical and indexation work remains in the existing queue.

---

## 5. Strategy-Bound Gaps

| Gap | Evidence | Required delta |
|---|---|---|
| About is below the advisory | Browser #6 despite strong branded GSC evidence | Improve factual entity clarity, provenance, leadership links, and evidence without changing its map role |
| Leadership terminology is inconsistent | About names Gerry as founder; Christies page says CEO; map variant says founder | Verify roles and dates; amend only the incorrect map/page/schema field |
| Provenance links stop short of About | Map strengthens farming pages and Farming Practices but gives no exact campaign edge into About | Add precise, natural About links from the founder and Farming Practices trust pages after approval |
| Buying-guide body link is absent | Internal-link matrix explicitly requires where-to-buy to Find Agriko | Add the exact body link; do not confuse navigation with the required contextual edge |
| Related-content recirculation is off-topic | Farming and buying guides surface a UGC-ad article | Replace that recommendation with map-owned farming/rice pages on selected assets |
| One independent result is unlikely to move a government page outside top 20 | Host-diverse SERP and one-domain limit | Secure original Philippine editorial coverage using verified farm/company evidence |
| Measurement can report false absence | Serper returns six results while code records `not_in_top_30` | Introduce explicit incomplete-provider status before automation |

---

## 6. Prioritized Displacement Portfolio

| Priority | Asset | Type | Counted candidate? | Why it can move above the advisory |
|---|---|---|---|---|
| P1 | `https://agrikoph.com/pages/about` | Existing owned page | Yes | Already browser #6 and receives 143 branded impressions |
| P1 | SunStar Cebu original business/farm feature | Independent Philippine editorial page | Yes after publication and observation | Cebu relevance, independent newsroom, exact Agriko entity coverage |
| P1 | Manila Bulletin Agriculture original farm-enterprise feature | Independent Philippine agriculture editorial page | Yes after publication and observation | National Philippine agriculture relevance and topical authority |
| P2 conditional | DTI Region 7 or DTI Philippines MSME follow-up | Independent institutional page | Yes only if existing recognition is verified and an official page is published | Existing DTI result already appears in provider data; a verified official follow-up could rank for the brand |
| Support | `/pages/christies-paglinawan` | Existing person/trust page | No until observed | Connects verified leadership, authorship, About, and farming evidence |
| Support | `/pages/farming-practices` plus two farming articles | Existing trust cluster | No until observed | Reinforces the map's planned Agriko provenance work |
| Support | Find Agriko, where-to-buy guide, Journal recirculation | Existing map work | No | Completes already-required links and improves coherent discovery |

No asset is credited merely because it was published, linked, pitched, or indexed.

---

## 7. Exact Content Briefs

### Brief A: About page factual consolidation

| Field | Requirement |
|---|---|
| URL | `https://agrikoph.com/pages/about` |
| Title | Preserve `Agriko Philippines: Organic Rice & Farm Story` unless browser/GSC evidence supports a later test |
| Format | Existing About/trust page refresh; no new URL |
| Primary query | `Agriko organic farm` from the active map |
| Secondary queries | `agriko`, `agriko farm`, `agriko story` |
| Intent | Navigational and brand trust |
| Map relationship | Strengthens the existing P2 Brand Trust owner |
| Independent value | A clear, evidenced account of who Agriko is, where it operates, who leads it, and how its farm-to-Cebu model works |
| Ranking rationale | It already ranks at browser #6 and has the strongest branded evidence after the homepage |
| Word-count rule | No arbitrary expansion; edit only what improves verified identity, chronology, and usefulness |

Required outline:

1. `Farming from Dumingag for Filipino Homes` — preserve the existing H1 if factual evidence supports it.
2. `Agriko at a glance` — legal company name, Cebu office, Dumingag farm relationship, service area, and founding year from retained records.
3. `How Agriko began` — verified chronology reconciling 2013 and 2016 rather than presenting both without explanation.
4. `Who leads Agriko` — distinguish Gerry Paglinawan's verified founder role from Christies Paglinawan's verified CEO role; link to the person page.
5. `How Agriko farms and sources` — concise summary linking to Farming Practices, without duplicating the farming pillar.
6. `From the farm to Filipino households` — operational journey linking to Find Agriko and the organic-rice collection.
7. `Milestones and recognition` — include DTI recognition only when the exact award/post and date are retained.
8. `Evidence and verification` — visible reviewed date and links to factual supporting pages; no health or advisory copy.

Required evidence:

- Corporate registration or authoritative company record for legal name and dates.
- Written role confirmation for Gerry and Christies Paglinawan.
- Evidence connecting Paglinawan Farm, Dumingag operations, and Cebu office.
- DTI source URL and award/category evidence before adding recognition.
- Evidence for any testimonial retained on the page; remove unsupported testimonials from the campaign draft rather than using them as trust proof.

Exact links out:

- `/pages/christies-paglinawan` with anchor `Christies Paglinawan, Agriko CEO` if verified.
- `/pages/farming-practices` with anchor `Agriko farming practices`.
- `/pages/find-agriko` with anchor `find Agriko stores`.
- `/collections/organic-rice` with anchor matching the transactional destination, not generic `Agriko`.

Exact links in:

- Retain homepage navigation/body path to About.
- Add `/pages/christies-paglinawan` to About with anchor `Agriko farm story`.
- Add `/pages/farming-practices` to About with anchor `Agriko's Dumingag farm roots` only if visible content supports the statement.
- Add `/pages/events` to About only from a verified milestone entry.

Rollback threshold:

- Revert the content/link release if About drops more than 20% in branded GSC impressions versus its pre-release 28-day baseline after enough data accrues, loses indexation/canonical integrity, or displaces the homepage as primary `Agriko` owner.

### Brief B: Christies Paglinawan leadership page

| Field | Requirement |
|---|---|
| URL | `https://agrikoph.com/pages/christies-paglinawan` |
| Title | Preserve `Christies Paglinawan | Agriko Philippines` |
| Format | Existing Person/trust page refresh |
| Primary query | `Christies Paglinawan` |
| Secondary queries | `Agriko CEO`, `Agriko leadership` |
| Intent | Navigational/person entity |
| Map relationship | Strengthens P2 person/trust page; propose replacing unsupported `Agriko founder` secondary variant with `Agriko CEO` if evidence confirms |
| Counted status | Support only until observed above the advisory |

Required outline:

1. Verified current role and dates.
2. Responsibilities at Agriko, stated without inflated expertise.
3. Relationship to Paglinawan Farm and the company's organic-rice/farming work.
4. Authored or reviewed Agriko resources, linking only to real bylines.
5. Link to About and Farming Practices.

Schema requirements:

- Keep `Person` schema aligned with visible copy.
- Use `worksFor` pointing to `https://agrikoph.com/#organization`.
- Do not use `founder` unless first-party evidence confirms that role.
- Add external `sameAs` only for verified person profiles, not company profiles.

### Brief C: Farming provenance support

| Field | Requirement |
|---|---|
| URLs | `/pages/farming-practices`, `/blogs/news/what-is-organic-farming`, `/blogs/news/sustainable-rice-farming` |
| Existing intents | Agriko farming practices; Philippine organic-farming pillar; sustainable-rice spoke |
| Map relationship | Implements the existing farming-authority provenance work without changing intent ownership |
| Counted status | Support only until observed |

Required changes:

- Preserve `what-is-organic-farming` to Farming Practices link already present.
- Ensure the sustainable-rice article contains the required contextual body link to Farming Practices.
- Add one evidence-backed Farming Practices link to About, without turning the page into a second company story.
- Replace the unrelated UGC-ad Related Article on the two farming pages with the farming pillar, sustainable-rice spoke, or organic-rice collection according to page intent.
- Retain Philippine authorities and limitations; do not add product-health claims.

### Brief D: Buying path and Journal recirculation

| Field | Requirement |
|---|---|
| URLs | `/blogs/news/where-to-buy-organic-rice-in-the-philippines`, `/pages/find-agriko`, `/blogs/news` |
| Map relationship | Implements existing P1 buying-guide-to-locator edge and P2 Journal discovery guidance |
| Counted status | Support only |

Required changes:

- Add a visible body link from the buying guide to `/pages/find-agriko` using `find Agriko retailers`.
- Retain Find Agriko's location intent; do not retarget it to generic `agriko`.
- Remove the unrelated UGC-ad article from Related Articles on the buying guide.
- Do not alter the Journal title or create a campaign category unless observed discovery evidence requires it.

### Brief E: SunStar Cebu editorial pitch

| Field | Requirement |
|---|---|
| Target | SunStar Cebu newsroom via [official contact page](https://www.sunstar.com.ph/contact-us) |
| Proposed title | `From Dumingag to Cebu: How Agriko Built a Farm-to-Household Food Enterprise` |
| Requested section | Cebu business, agriculture, or community enterprise |
| Publisher-controlled URL | Expected under `https://www.sunstar.com.ph/cebu/`; no URL is credited until published |
| Search intent | Independent brand/company discovery |
| Map relationship | Complements Brand Trust and Organic Farming without creating another owned URL |
| Counted status | Only after the final article ranks above the advisory |

Pitch packet:

- Verified 2013/2016 chronology.
- Verified founder and CEO roles.
- Dumingag farm and Cebu office evidence.
- Original farm, founder, operations, and product-category photography.
- A concrete Cebu/Mindanao enterprise angle, not a reputation-management request.
- No advisory mention and no unsupported health or certification claims.

### Brief F: Manila Bulletin Agriculture editorial pitch

| Field | Requirement |
|---|---|
| Target | [Manila Bulletin Agriculture](https://agriculture.com.ph/about/) |
| Proposed title | `What Agriko's Dumingag Farm Story Shows About Bringing Philippine Organic Rice to Market` |
| Requested format | Reported farm-enterprise profile or practical sourcing feature |
| Publisher-controlled URL | Expected under `https://agriculture.com.ph/`; no URL is credited until published |
| Search intent | Philippine agriculture and Agriko entity discovery |
| Map relationship | Complements Organic Farming, Sustainable Rice Farming, and Brand Trust |
| Counted status | Only after the final article ranks above the advisory |

Pitch packet:

- Verified farm practices and sourcing records.
- Clear distinction between company operations and general organic-farming education.
- Original photographs and an available named spokesperson.
- Links to the About page and Farming Practices only when editorially chosen by the publisher.
- No paid-link requirement and no demand for exact anchor text.

### Brief G: Conditional DTI follow-up

| Field | Requirement |
|---|---|
| Trigger | Existing DTI Micro Enterprise recognition is verified from an official source and Agriko has a genuine update |
| Target | DTI Region 7 or DTI Philippines MSME success-story/editorial channel |
| Proposed title | `Agriko After Its DTI Micro Enterprise Recognition: From Cebu Operations to Wider Philippine Reach` |
| Map relationship | Complements Events and Brand Trust |
| Counted status | Only after an official article is published and observed |

Do not pursue this asset if recognition details, permission, or a substantive update cannot be verified by day 2.

---

## 8. Internal-Link Plan

| Source | Destination | Anchor | Action | Purpose |
|---|---|---|---|---|
| `/pages/christies-paglinawan` | `/pages/about` | `Agriko farm story` | Add after role verification | Person-to-organization trust |
| `/pages/about` | `/pages/christies-paglinawan` | `Christies Paglinawan, Agriko CEO` | Add after role verification | Organization-to-person entity |
| `/pages/about` | `/pages/farming-practices` | `Agriko farming practices` | Add or retain | Brand-to-provenance |
| `/pages/farming-practices` | `/pages/about` | `Agriko's Dumingag farm roots` | Add only with matching visible evidence | Provenance-to-brand trust |
| `/blogs/news/what-is-organic-farming` | `/pages/farming-practices` | `Agriko farming practices` | Retain existing | Pillar-to-trust page |
| `/blogs/news/sustainable-rice-farming` | `/pages/farming-practices` | `organic farming in the Philippines` | Ensure body edge | Spoke-to-trust path |
| `/blogs/news/where-to-buy-organic-rice-in-the-philippines` | `/pages/find-agriko` | `find Agriko retailers` | Add body edge | Buying-guide-to-locator |
| `/pages/about` | `/pages/find-agriko` | `find Agriko stores` | Add or retain | Brand-to-location journey |

No global footer, sitewide exact-match, or mass article-link insertion is part of this sprint.

---

## 9. Philippine Authority Requirements

### Approved sprint targets

- SunStar Cebu: exact local enterprise story in Brief E.
- Manila Bulletin Agriculture: exact farm-enterprise story in Brief F.
- DTI Region 7/DTI Philippines: conditional verified follow-up in Brief G.

### Citation sources, not assumed outreach partners

- Department of Agriculture National Organic Agriculture Program for Philippine legal/program context.
- PhilRice, FNRI, and NNC where a selected farming or nutrition passage genuinely requires their evidence.
- These institutions are not presented as Agriko partners without documented relationships.

### Outreach rules

- One tailored pitch per target; no blast list.
- Editorial independence is preserved.
- No requested exact-match anchor, guaranteed placement, or undisclosed payment.
- Every factual assertion in the pitch packet must map to retained evidence.
- If a publisher declines or does not respond, record the outcome; do not syndicate the same article elsewhere.

---

## 10. Measurement Automation

### Task 0A: Make provider coverage truthful

**Files:**

- Modify: `lib/seo/brand-serp.ts`
- Modify: `lib/connectors/serper-organic.ts`
- Modify: `__tests__/lib/brand-serp.test.ts`

**Required behavior:**

- Replace the current automatic `not_in_top_30` fallback when fewer than 30 organic positions are returned.
- Persist `coverageStatus` as `complete_top_30`, `provider_window_incomplete`, `provider_disabled`, or `failed`.
- Persist `advisoryPosition` as a number only when observed.
- Use `not_observed_in_provider_window` when the advisory is absent from an incomplete result window.
- Never interpret `not_observed_in_provider_window` as displacement.

**Verification:**

- [ ] A six-result response without the advisory produces `provider_window_incomplete`.
- [ ] A complete 30-result response without the advisory produces `complete_top_30` and a valid absence observation.
- [ ] A 401/402/403/429 produces `provider_disabled`, not absence.
- [ ] A provider exception produces a failed capture and preserves the previous valid state.

### Task 0B: Persist the four daily observations

**Files:**

- Create: `jobs/capture-brand-serp.ts`
- Create: `app/api/cron/capture-brand-serp/route.ts`
- Create: `__tests__/jobs/capture-brand-serp.test.ts`
- Create: `__tests__/api/cron-capture-brand-serp.test.ts`
- Modify: `docs/CRON.md`

**Required behavior:**

- The route calls `requireCronAuth(req)` first, then `acquireJobLock("capture-brand-serp")`, and releases the lock in `finally`.
- The handler creates a `JobRun`, calls the existing four-check capture function, and upserts one `RawSnapshot` source `brand_serp` per `Asia/Manila` calendar day.
- The `RawSnapshot.payload` contains all normalized observations, raw provider results, result depth, coverage status, advisory status, and provider metadata.
- Same-day retry updates the same snapshot and does not duplicate observations.
- Partial location/device failure yields `partial`; total failure yields `failed`.
- Install the external production schedule at 08:30 Asia/Manila daily after separate deployment approval.

### Task 0C: Schedule browser validation without operator memory

**Files:**

- Create: `scripts/capture-brand-serp-browser.mjs`
- Create: `scripts/install-brand-serp-browser-task.ps1`
- Create: `app/api/cron/brand-serp-browser-observation/route.ts`
- Create: `__tests__/api/cron-brand-serp-browser-observation.test.ts`
- Modify: `.mex/patterns/playwright-mcp-windows-chrome.md`

**Required behavior:**

- Reuse the installed Playwright MCP Bridge extension, Windows Chrome executable, and existing masked token configuration.
- Open a separate tab and capture `agriko` with `gl=ph`, `hl=en`, `pws=0`, and up to 20 visible organic results.
- Post the normalized browser observation to the authenticated Autopilot ingestion route; the route persists it in the day's `brand_serp` snapshot.
- Install a Windows Task Scheduler task that runs weekly while the operator is logged in; no daily manual command is required.
- If Chrome, the extension, or Google is unavailable, record a validation failure and alert the operator. Do not mark the advisory absent.
- The alert is the exception workflow; the operator is not expected to remember the schedule.

### Task 0D: Alert and report

**Files:**

- Create: `jobs/report-brand-serp.ts`
- Create: `app/api/cron/report-brand-serp/route.ts`
- Create: `__tests__/jobs/report-brand-serp.test.ts`
- Modify: `lib/alerts.ts`
- Modify: `docs/CRON.md`

**Required behavior:**

- Add operator alert kinds `brand_serp_capture_failure`, `brand_serp_page_one`, and `brand_serp_top20_regression`.
- Alert after two consecutive daily failed/partial captures or a missed browser-validation window.
- Send a weekly report containing advisory position/status, provider coverage, browser disagreement, selected-candidate positions, and releases from `ContentProposal.publishedAt` and completed Store Tasks.
- Alert on browser-confirmed page-one or top-20 regression after the advisory has crossed the corresponding threshold.
- Schedule the report weekly; no spreadsheet maintenance is required.

### Automation deployment gate

- [ ] Run targeted tests, full `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Merge only the reviewed branch.
- [ ] Deploy through `node scripts/git-deploy.mjs` after separate operator authorization.
- [ ] Install production cron entries only after deploy authorization.
- [ ] Confirm server commit, active build, PM2 restart, `JobRun`, `RawSnapshot`, alert delivery, and public health endpoint before calling automation deployed.

---

## 11. Days 0–2

### Day 0

- [ ] Implement Tasks 0A–0D in parallel with content production; do not wait for seven days of measurements.
- [ ] Capture and retain the pre-change About, person, Farming Practices, farming-pillar, sustainable-farming, buying-guide, Find Agriko, and Journal states.
- [ ] Ask the operator for one evidence packet covering founding chronology, Gerry/Christies roles, farm/company relationship, DTI recognition, usable photography, and spokesperson availability.
- [ ] Draft Brief A and Brief B using only verified fields; bracket unsupported claims for removal, not later invention.

### Day 1

- [ ] Draft Brief C and Brief D exact content/link changes.
- [ ] Prepare the SunStar and Agriculture Magazine pitch packets from the same verified evidence.
- [ ] Evaluate the DTI trigger and reject it immediately if evidence is insufficient.
- [ ] Submit the four owned changes through existing governed proposal paths; do not duplicate pending canonical/indexation tasks.

### Day 2

- [ ] Operator reviews exact content bytes, link diffs, factual evidence, and outreach packets.
- [ ] Revise only rejected factual or editorial items.
- [ ] Queue approved owned changes for the first release wave.
- [ ] Send approved tailored pitches; retain timestamps, recipient channel, exact pitch, and response status.

---

## 12. Days 3–7

### Days 3–4

- [ ] Publish the approved About refresh first and annotate the exact timestamp.
- [ ] Publish the approved Christies role/schema correction and reciprocal About link in the same release only if role evidence is complete.
- [ ] Publish Farming Practices/farming-link changes and the buying-guide-to-Find body link through existing controls.
- [ ] Remove the unrelated UGC-ad recommendation only from the selected campaign pages.
- [ ] Request normal Search Console recrawl for changed owned URLs.

### Days 5–7

- [ ] Run the scheduled browser validation and compare About, advisory, and independent candidate positions.
- [ ] If About enters above the advisory, preserve the release and avoid additional title changes.
- [ ] If About remains below the advisory but is indexed correctly, improve only the weakest evidenced section or incoming link; do not rewrite the page again wholesale.
- [ ] Follow up once with each editorial target using additional evidence, not a duplicate pitch.
- [ ] Release the conditional Events/DTI milestone update only if official recognition evidence and DTI outreach both cleared review.

---

## 13. Days 8–14

### Days 8–10

- [ ] Measure browser and provider positions; report incomplete provider windows separately.
- [ ] If an editorial article publishes, verify indexability, record its final publisher-controlled URL, and link from About or Events only where editorially and topically natural.
- [ ] If no editorial article publishes, do not manufacture a substitute profile, press release, or duplicate brand article.
- [ ] Strengthen the first-wave asset only when GSC/indexation/browser evidence identifies a specific weakness.

### Days 11–14

- [ ] Run the second browser validation.
- [ ] Record which counted candidates actually rank above the advisory.
- [ ] Report the advisory's page-one and top-20 status without averaging it with Serper.
- [ ] Close the action sprint with achieved, partial, or not-achieved status.
- [ ] Continue automated monitoring after day 14 without creating a new roadmap.

---

## 14. Measurement and Attribution

| Observation | Frequency | Source | Authority |
|---|---|---|---|
| Philippines desktop | Daily | Serper localized to Philippines | Automated directional evidence; valid absence only with complete top-30 coverage |
| Philippines mobile | Daily | Serper localized to Philippines | Same |
| Cebu desktop | Daily | Serper localized to Cebu City | Same |
| Cebu mobile | Daily | Serper localized to Cebu City | Same |
| Connected-browser result set | Weekly and after material release | Playwright MCP, Windows Chrome, `gl=ph`, `pws=0` | Resolves provider disagreement; signed-out state must be recorded truthfully |
| Owned-page performance | Before release and weekly | GSC query/page data | Supporting trend evidence, not absolute rank |
| Release attribution | Every release | Content Proposal/Store Task timestamps | Connects changes to observations |

The weekly report lists every counted candidate and one status: `above_advisory`, `below_advisory`, `not_observed`, `not_indexed`, or `unknown_due_to_capture_failure`.

---

## 15. Alerts and Operator Workload

### Automated

- Four daily provider observations.
- Raw response retention and idempotent database persistence.
- Repeated failure alerts.
- Weekly browser task invocation.
- Weekly campaign report.
- Page-one and top-20 regression alerts after threshold crossing.
- Release-to-ranking correlation.

### One-time operator actions

- Supply and approve factual evidence.
- Approve exact Shopify changes.
- Approve exact outreach packets.
- Approve installation of the Windows browser scheduler.

### Explicitly not required

- Running a daily command.
- Checking Google every day.
- Maintaining a spreadsheet.
- Remembering browser-validation dates.
- Manually correlating releases with ranking changes.

---

## 16. Risks and Rollback Rules

| Risk | Control | Rollback or response |
|---|---|---|
| FDA authority remains stronger than new assets | Use already-ranking About plus independent Philippine editorial authority | Report not achieved; do not create thin replacement content |
| Host diversity limits Agriko-owned results | Count only independent published pages and observed owned results | Do not publish multiple duplicate brand pages |
| Founder/date inconsistency | First-party evidence gate | Do not release leadership/timeline changes until resolved |
| Provider false absence | Coverage-status correction and browser validation | Treat incomplete window as unknown |
| About cannibalizes homepage | Preserve page roles and homepage title | Revert title/positioning change if homepage ownership weakens |
| Farming content drifts into health/product claims | Existing evidence and high-stakes review constraints | Remove unsupported passage before release |
| Editorial target does not publish | One follow-up, then record outcome | No syndication or substitute directory campaign |
| Browser scheduler fails | Alert with retained error evidence | Operator handles only the alerted exception; automated provider capture continues |

---

## 17. Rejected Ideas and Exclusions

- New `Agriko story`, `Agriko Philippines`, or founder blog article: rejected because About and the person page already own those intents.
- Homepage title/body rewrite: rejected because the homepage already ranks #1.
- Collection cleanup as displacement work: rejected because existing Store Tasks already govern canonical/indexation questions and utility collections are not credible campaign assets.
- Contact and FAQ optimization: rejected as generic hygiene without evidence they can displace the advisory.
- Affected cacao/turmeric product optimization: rejected by campaign scope and existing health/product gates.
- Advisory-response article, FAQ, statement, or schema: rejected because it would compete on the advisory topic and provide no independent user value.
- Instagram, Shopee, Waze, ShopMetro, YouTube, Merchant Center, marketplace, directory, or social-profile work: rejected as unsupported execution surfaces.
- Mass press release, paid exact-match placement, duplicate publisher article, or link exchange: rejected as low-quality and non-editorial.
- NOAP, PhilRice, FNRI, NNC, or DTI relationship claims without evidence: rejected; they may be cited or approached only under the rules above.
- Seven-day measurement hold or extended action roadmap: rejected; measurement runs beside the 14-day sprint.

---

## 18. Genuine Operator Decisions

Only these decisions require the operator:

1. Confirm the evidence-backed founding chronology: what happened in 2013, what legal/business event occurred in 2016, and which date belongs in schema.
2. Confirm Gerry Paglinawan's exact role and Christies Paglinawan's exact current role; approve a topical-map secondary-variant correction if `Agriko founder` is inaccurate for Christies.
3. Confirm the relationship among Agriko Multi-Trade & Enterprise, Inc., Paglinawan Organic Eco Farm, the Dumingag operation, and the Cebu office.
4. Confirm the exact DTI recognition, date, category, and official source, or reject the DTI asset.
5. Approve which original photographs, spokesperson, and operational evidence may be supplied to SunStar Cebu and Manila Bulletin Agriculture.
6. Approve the exact governed content releases and exact editorial pitches.
7. Authorize the later merge/deployment and one-time Windows Task Scheduler installation after implementation verification.

Everything else in the plan is discoverable, preparable, testable, or automatable without recurring operator memory.
