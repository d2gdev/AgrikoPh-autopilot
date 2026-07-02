---
name: keyword-gap-analysis
description: Compares keyword-research volume and bid-range data against current Google Ads keywords and GSC organic queries to surface high-volume keywords with no presence at all, and low-volume keywords quietly eating budget.
enabled: true
metadata:
  platform: Google
  extraSources: [keyword_research, gsc]
  insightBlock: search-term-opportunities
---

# 46/ Keyword Gap Analysis — Google

## What it does
Compares the "Keyword Research" data section (search volume, competition, bid ranges) against your current Google Ads keywords and the "Organic Search (GSC)" queries you already show up for. Surfaces the gaps in both directions: high-value keywords you're missing entirely, and low-value keywords currently burning spend.

## How it works
Claude builds three keyword sets from the payload: (1) active Google Ads keywords/search terms with their spend and performance, (2) GSC queries the site already gets organic clicks or impressions for, and (3) the keyword-research universe with volume, competition, and bid-range data. It then diffs them to find:

1. **High-volume, no-presence keywords** — keyword-research terms with meaningful monthly search volume and reasonable competition that appear in neither the paid keyword list nor the GSC query list. These are pure whitespace — call them out with volume/bid context in the narrative, since launching a new keyword is not an executable action here.
2. **Low-volume keywords eating budget** — active paid keywords with real spend but low or negligible search volume in the keyword-research data (or volume far below what the spend would suggest is efficient), especially when performance (CTR, conversion rate, CPA) is poor. These are strong candidates for `pause_campaign`, `pause_ad`, or `adjust_budget` recommendations, depending on which entity level the keyword rolls up to in the payload.
3. **Underbid opportunities** — active keywords converting well where the keyword-research bid range suggests room to raise bids for more volume. Note these in the narrative only; bid changes are not part of this skill's executable action set.

## Output contract — recommendations
This skill's recommendations MUST use only the **executable** action types: `pause_campaign`, `pause_ad`, `adjust_budget`. Do not emit `change_bid` or `add_negative_keyword` recommendation objects — keyword-level actions (new keywords, negative keywords, bid changes) are not executed by the pipeline and belong in the narrative analysis as opportunities for a human to action manually. When a low-volume/underperforming keyword doesn't map cleanly onto a campaign- or ad-level entity in the data, describe it in the narrative instead of forcing a recommendation object. Follow the exact recommendation JSON schema and field rules given in the system instructions (fenced ```recommendations block, PHP numeric proposedValue for adjust_budget, null proposedValue for pause actions).

## Output contract — insights
BEFORE the recommendations block, also output a fenced ```search-term-opportunities block containing a JSON array matching the schema given in the system instructions. This is how a Google-platform skill's findings persist and reach a human, since `google_ads` recommendation objects are filtered out at generation time and never saved — the insight block is the only output this skill produces that survives. These items are routed straight to the operator's Opportunity feed.

Map both directions of the keyword-gap diff into `searchTerm` items:
- **High-volume, no-presence keywords** (whitespace opportunities): one item per keyword, with `searchTerm` set to the keyword text, `impressions`/`clicks`/`conversions` set to `0` (no paid or organic presence exists yet), `currentCpaPHP` set to `null`, `recommendedBidPHP` set from the keyword-research bid range, `recommendedMatchType` chosen based on competition/intent, and **`isNegativeKeyword: false`**.
- **Low-volume keywords eating budget** (waste terms): one item per keyword, with `searchTerm` set to the keyword text, the paid keyword's real `impressions`/`clicks`/`conversions`/`currentCpaPHP`, and **`isNegativeKeyword: true`** to flag it as a candidate for exclusion.

If neither direction has data, output an empty array `[]`. Set `theme` to a short cluster label consistent with the recommendations narrative, and `suggestedAdGroup` to the ad group name when the keyword maps to one, or `null` otherwise.

## What you get back
- A ranked list of high-volume keyword gaps (search volume, competition, estimated bid range) with no current paid or organic presence
- A list of low-volume keywords currently spending budget, with their performance and why they're a drag
- Underbid opportunities noted in the narrative, with current vs. suggested bid range
- Recommendation objects only for entities that map to `pause_campaign`, `pause_ad`, or `adjust_budget`

## When to use it
- Monthly keyword strategy reviews
- Before a budget increase, to confirm spend is going to keywords with real demand behind them
- When keyword-research data has just been refreshed and needs to be reconciled against live campaigns
- Quarterly account audits to catch keyword drift (old keywords that no longer match search demand)
