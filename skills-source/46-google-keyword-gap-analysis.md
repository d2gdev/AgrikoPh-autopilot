---
name: keyword-gap-analysis
description: Compares keyword-research volume data (DataForSEO) against GSC organic queries to surface high-volume keywords with no organic presence at all, and to flag keyword-research gaps worth targeting with content.
enabled: true
metadata:
  platform: SEO
  extraSources: [keyword_research, gsc]
  insightBlock: search-term-opportunities
---

# 46/ Keyword Gap Analysis — SEO

## What it does
Compares the "Keyword Research" data section (DataForSEO search volume) against the "Organic Search (GSC)" queries the site already shows up for. Surfaces high-value keywords the site has no organic presence for at all — whitespace worth targeting with new or updated content.

## How it works
Claude builds two keyword sets from the payload: (1) GSC queries the site already gets organic clicks or impressions for, and (2) the keyword-research universe with monthly search volume from DataForSEO. It diffs them to find high-volume, no-presence keywords — keyword-research terms with meaningful monthly search volume that appear nowhere in the GSC query list. These are pure whitespace; call them out with volume context in the narrative, since targeting a new keyword is a content decision, not an executable ad action.

## Output contract — recommendations
This skill has no executable ad-account action to propose (it has no ad-spend data to act on) — do not emit a ```recommendations block. All findings belong in the insight block below and the narrative.

## Output contract — insights
Output a fenced ```search-term-opportunities block containing a JSON array matching the schema given in the system instructions. This is the only output this skill produces that persists — it's how the findings reach the operator, routed straight to the Opportunity feed.

Map each high-volume, no-presence keyword into a `searchTerm` item: `searchTerm` set to the keyword text, `impressions`/`clicks`/`conversions` set to `0` (no organic presence exists yet), `currentCpaPHP` set to `null`, `recommendedBidPHP` set to `null` (no bid data available from this data source), `recommendedMatchType` set to `null`, and `isNegativeKeyword: false`.

If there's no gap data, output an empty array `[]`. Set `theme` to a short cluster label consistent with the narrative, and `suggestedAdGroup` to `null` (not applicable to a content-targeting recommendation).

## What you get back
- A ranked list of high-volume keyword gaps (search volume) with no current organic presence

## When to use it
- Monthly keyword strategy reviews
- When keyword-research data has just been refreshed and needs to be reconciled against organic performance
- Planning new content targets based on demonstrated search demand
