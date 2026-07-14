Run one complete local-only surface-integrity audit pass for Agriko Autopilot.

You are authorized to inspect and repair local code, UI, persistence, tests,
and project records. Do not access production, deploy, write to Shopify or
Meta, activate a strategy, change production data, change credentials or
permissions, or perform destructive work. Pause for explicit operator
authority at any such boundary.

Audit these operator surfaces in this pass:

- Campaigns: Campaigns, Recommendations, Ad Approvals, and Reports.
- SEO Pilot: SEO.
- Store Pilot: Images and Reports.
- Content Pilot: Content.
- Social Pilot: Social.
- Market Intelligence: Competitors and Insights Pilot.
- Growth Brief.
- Unified Report.

For every relevant surface, trace its route, component, service, persisted
model or snapshot, and tests. Check API/DTO/UI field parity; persisted values,
analysis, evidence, timestamps, statuses, priorities, counts, pagination, and
reload behavior; and loading, empty, stale, failed, unavailable, permission,
and non-actionable states. Every displayed analysis or value must have
truthful persisted or explicitly computed provenance.

The topical map is authoritative only for SEO Pilot, Content Pilot, and
governed Store Pilot work. For those surfaces, verify the applicable
map-derived identity, rules, values, analysis, evidence, timestamps, and
actionability gates without exposing raw package bytes. Do not invent
topical-map requirements for campaigns, social, market intelligence, growth,
or reports.

When you find a defect, diagnose it, add or update a regression test first,
make the smallest authorized local repair, and run focused verification plus
proportional type, lint, build, database-client, or full-suite checks. A pass
that finds any defect is unclean even if the repair passes; set
`audit_pass.clean` to false and list the defect, fix, and verification. A
clean pass must have no defects and no fixes. Five consecutive clean passes
are required after the most recent defect; do not claim completion early.

Record concise evidence in the execution report. Return only the required JSON
report and set `audit_pass` with `clean`, `defects`, `fixes`, and
`verification` on every pass.
