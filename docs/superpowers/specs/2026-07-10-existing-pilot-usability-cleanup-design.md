---
title: Existing Pilot Usability Cleanup
date: 2026-07-10
status: complete
---

# Existing Pilot Usability Cleanup

## Goal
Make the existing SEO Pilot and Content Pilot queues more usable without adding a new workflow. Operators should understand why a row appears, why an empty queue is empty, and whether handled/rejected ideas are being respected.

## Scope
- Content Pilot proposal list API includes lightweight source evidence already stored on `ContentProposal.sourceData`.
- Content Pilot queue rows show concise evidence for the recommendation source, target keyword/query, score, position, impressions, and issue where present.
- Content Pilot rejected rows are labeled as rejected, not as an unlabeled fallback badge.
- Content Pilot empty/generation copy distinguishes "no current proposals", filtered no-match, and "no new proposals because prior decisions are being respected."
- SEO Pilot content gaps show why each gap is actionable.
- SEO Pilot gap/opportunity empty states reflect that handled/skipped/terminal rows stay out of the actionable queue.

## Non-Goals
- No new generator.
- No new database model.
- No deletion of terminal history rows.
- No live Shopify or ad writes.

## Success Criteria
- Existing proposals still load and draft/publish actions keep their current behavior.
- Proposal rows expose source/evidence when source data exists.
- Zero generated proposals no longer reads as a failure or missing data when dedupe is working.
- SEO content gap and opportunity panels do not imply "fetch data first" when the actionable queue is simply clean.
- Focused tests cover the pure evidence/reason helpers and API list source-data selection.
