# 2026-07-09 SEO + Content Pilot Audit Findings

## SEO Pilot Findings
- [Critical] Daily cron replacement logic blocks all future new-content refreshes once any approved/published null-handle proposal exists — app/api/cron/daily/route.ts:121, impact: keyword-gap/new-content generation can stop silently after one approved or published null-handle proposal, why it matters: operators lose discovery of fresh content-gap opportunities because `fresh` filtering treats all `new-content` proposals as the same key.
- [Important] Gap-promotion UI treats partial-success responses as full success — app/(embedded)/(seo-pillar)/seo-pillar/page.tsx:127, impact: rows skipped by backend constraints are still marked “Created,” why it matters: operators get false completion state and cannot retry individual failed/skipped gaps without another manual page refresh.
