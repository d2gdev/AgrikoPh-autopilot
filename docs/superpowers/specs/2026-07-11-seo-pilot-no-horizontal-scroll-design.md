---
name: seo-pilot-no-horizontal-scroll-design
description: Responsive layout contract that removes horizontal scrolling from every SEO Pilot panel without removing data or actions.
last_updated: 2026-07-11
---

# SEO Pilot No-Horizontal-Scroll Design

## Goal

SEO Pilot must remain fully usable without horizontal scrolling at viewport widths of 320, 375, 768, 1024, and 1440 pixels. Every field, sort option, filter, and operator action remains available.

## Scope

The change covers the SEO Pilot page shell and all nine panels: Overview, Opportunities, Content Gaps, On-Page Health, Keywords, Pillar Clusters, Page Health, Opportunity Clusters, and Strategy. It also hardens the shared `ResponsiveDataTable` used by those panels.

## Responsive Behavior

1. Navigation uses the existing desktop tab strip only when it fits. Compact layouts use a labelled, full-width view selector so the navigation itself never becomes a horizontal scroller.
2. `ResponsiveDataTable` uses the Polaris desktop table only on genuinely wide layouts. Mobile and tablet layouts render each row as a vertical labelled record.
3. Stacked records use a two-column label/value layout when space permits and collapse naturally for narrow or unusually long content. Both sides use `min-width: 0`; text and URLs may wrap anywhere when necessary.
4. Custom React nodes, badges, buttons, and action groups render directly in a constrained cell container rather than inside text components. Action groups may wrap and must remain operable.
5. Sort controls wrap and become full width on narrow screens. Controlled sort state remains shared with the desktop table.
6. Filter and input rows remove fixed minimum widths that exceed the available container. Controls use flexible, full-width wrappers and preserve their existing actions.
7. Long queries, article titles, page paths, evidence text, and badges wrap rather than expanding their parent.

## Desktop Behavior

Desktop tables remain available when the layout is wide enough to display them without an internal horizontal-scroll requirement. Data, sortable headings, and actions are unchanged. Dense tables switch to stacked records before their columns become unusable rather than clipping or hiding fields.

## Accessibility

- Compact navigation retains an explicit label.
- Stacked records preserve visible heading/value associations.
- Existing buttons, links, selects, badges, and keyboard behavior remain intact.
- No content is hidden merely to satisfy the layout.

## Testing

Regression coverage will verify:

- SEO Pilot navigation has a compact non-scrolling control.
- Every SEO Pilot data presentation uses `ResponsiveDataTable` rather than a raw wide `DataTable`.
- Responsive cells have shrink and wrapping containment.
- Opportunities and Keywords retain compact sorting.
- Filter, input, and action rows use wrapping, shrinkable wrappers.
- No SEO Pilot source introduces `overflow-x: auto`, `white-space: nowrap`, or a fixed minimum width that forces compact overflow.

Focused component tests, application and test typechecks, lint, the full test suite, a production build using a disposable localhost PostgreSQL URL, and `git diff --check` must pass before merge.

## Safety and Integration

This is a presentation-only change. It does not alter API behavior, permissions, publishing, authentication, guardrails, database schema, or live Shopify/Meta behavior. Work is isolated, reviewed, merged directly to `main` only after verification, and not deployed without separate authorization.
