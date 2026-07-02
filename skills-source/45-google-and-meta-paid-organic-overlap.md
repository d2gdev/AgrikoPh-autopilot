---
name: paid-organic-overlap
description: Cross-references paid campaigns, keywords, and ads against GSC organic rankings and GA4 landing-page behavior to find wasted spend on terms you already rank for, weak landing pages, and organic winners with no paid backup.
enabled: true
metadata:
  platform: Google and Meta
  extraSources: [gsc, ga4]
---

# 45/ Paid ↔ Organic Overlap — Google + Meta

## What it does
Cross-references your paid campaigns, keywords, and ads against organic search performance (GSC) and on-site behavior (GA4) to find three things: paid spend duplicating organic strength, paid landing pages that are quietly leaking conversions, and organic winners that have no paid support behind them.

## How it works
Claude reads the ad account data (Google + Meta campaigns, ad sets/ad groups, ads, keywords) alongside the "Organic Search (GSC)" and "Site Analytics (GA4)" sections appended below it. It joins on query/keyword text and landing-page URL where possible, then evaluates:

1. **Wasted spend on organic winners** — paid keywords/search terms (Google) or ad landing-page targets (Meta) where GSC shows the site already ranks top-5 organically for the same or a near-identical query, with meaningful organic clicks/impressions. These are candidates to pause or cut budget on, since the organic listing is likely already capturing the click.
2. **Weak landing pages** — ad landing pages where GA4 shows high bounce rate or low conversion rate relative to the account average, even though the ad itself is getting healthy CTR/clicks. Flag these as pause/budget-reduction candidates when the underlying page problem can't be fixed by the ad itself (e.g., the page has no clear path to conversion) — but note the *page-level* fix in the narrative, not as a recommendation object, since landing-page edits aren't an executable action type here.
3. **Organic winners with no paid support** — GSC queries with strong organic position (top 10) and healthy click volume, high commercial intent (e.g., "buy", "price", branded modifiers, product-specific terms), where there is currently no matching paid campaign, ad group, or keyword. Call these out as opportunities in the narrative analysis only — do not emit a recommendation for them, since launching new campaigns/keywords is not an executable action type.

## Agriko-specific notes
Agriko's GSC data density is currently low (limited historical query/page volume, especially for newer product lines like specific turmeric or rice SKUs). When you only have a handful of organic sessions or a short date range backing a "top-5 organic" or "high bounce" finding:
- Still surface it in the narrative if it's directionally useful.
- Use a **modest confidenceScore** (0.3–0.5) on any recommendation that leans on thin organic data — do not use confidenceScore above 0.6 unless the organic signal (impressions, clicks, or GA4 sessions) is robust (e.g., 100+ impressions or 20+ sessions over the analysis window).
- Never fabricate organic ranking or GA4 numbers that aren't present in the provided data sections; if a section is empty or missing, say so in the narrative and skip recommendations that would depend on it.

## Output contract — recommendations
This skill's recommendations MUST use only the **executable** action types: `pause_campaign`, `pause_ad`, `adjust_budget`. Do not emit `change_bid` or `add_negative_keyword` recommendation objects from this skill — those action types are not executed by the pipeline and any keyword-level or bid-level suggestions belong in the narrative analysis instead, described as opportunities for a human to action manually. Follow the exact recommendation JSON schema and field rules given in the system instructions (fenced ```recommendations block, PHP numeric proposedValue for adjust_budget, null proposedValue for pause actions).

## What you get back
- A short narrative broken into the three categories above (wasted spend, weak landing pages, organic-only winners)
- Recommendation objects only for the subset of findings that map to `pause_campaign`, `pause_ad`, or `adjust_budget`
- Explicit call-outs when a finding is based on thin GSC/GA4 data, with a correspondingly modest confidenceScore
- New-keyword, negative-keyword, and landing-page-fix ideas listed as narrative opportunities, not recommendation objects

## When to use it
- Monthly or quarterly cross-channel budget reviews
- When GSC/GA4 connectors have been live long enough to have meaningful data
- Before increasing paid budget on a keyword theme, to check for organic cannibalization first
- After a landing page redesign, to see whether paid traffic to it is converting better or worse
