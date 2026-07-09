# SEO + Content Pilot Logic Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** perform a comprehensive, evidence-backed audit of SEO Pilot and Content Pilot logic, then deliver a severity-ordered issue list with exact file-level citations and recommended fixes.

**Architecture:** keep analysis grounded in existing module boundaries (`app/api/seo/*`, `lib/seo/*`, `app/(embedded)/(seo-pillar)/*`, `app/api/content-pilot/*`, `lib/content-pilot/*`, `app/(embedded)/(content-pilot)/*`, `lib/opportunities/*`) and validate all findings with tests or source-level traces before reporting.

**Tech Stack:** Next.js App Router, TypeScript, Prisma (via `import { prisma } from "@/lib/db"`), Vitest.

## Global Constraints

- Never execute live ad or Shopify write paths from analysis tooling.
- Respect project non-negotiables in `AGENTS.md`, including Prisma usage and auth-call order.
- Use repo-established patterns; no broad refactors for this audit.
- Track findings with explicit severity labels: Critical / Important / Minor.
- Commit one file per phase: evidence notes → findings file; no behavioral code changes are required unless explicitly approved in the final synthesis.
- Current execution state: completed (audit-only pass, findings updated in `docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md`).

---

### Task 1: SEO Pilot Evidence Sweep

**Files (read-only):**
- `app/api/seo/analysis/route.ts`
- `app/api/seo/analyze/route.ts`
- `app/api/seo/promote/route.ts`
- `app/api/seo/gaps/promote/route.ts`
- `app/api/seo/route.ts`
- `app/api/seo/recommendations/decompose/route.ts`
- `lib/seo/data.ts`
- `lib/seo/gsc-normalized.ts`
- `app/api/cron/daily/route.ts`
- `app/(embedded)/(seo-pillar)/seo-pillar/components/*`
- `__tests__/api/seo-pilot-routes.test.ts`

**Deliverables:**
- A full issue list for SEO Pilot only, each with path + symptom + impact.
- Severity-ranked audit entries in `docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md` under section `SEO Pilot Findings`.

- [x] **Step 1: Run focused route and UI tests**
  - `npm test -- __tests__/api/seo-pilot-routes.test.ts`
  - `npm test -- __tests__/api/seo/analyze.test.ts __tests__/api/seo-analysis.test.ts 2>/dev/null || true`

- [x] **Step 2: Capture logic hotspots from source**
  - Confirm control flow and dedupe semantics in:
    - `getLatestGscData` source switching and window handling
    - promotion candidate skip rules (striking-distance/content-gap overlap logic)
    - proposal generation dedupe + replacement behavior in SEO cron path

- [x] **Step 3: File findings for SEO Pilot**
  - Create/append this file with section and format:
    - `## SEO Pilot Findings`
    - `- [Critical] ... (path:line)`
    - `- [Important] ... (path:line)`
    - `- [Minor] ... (path:line)`
  - Prioritize correctness and data-loss risks before UX polish.

- [x] **Step 4: Commit Task 1**
  - `git add docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md`
  - `git commit -m "docs: record seo pilot audit findings"`

---

### Task 2: Content Pilot Evidence Sweep

**Files (read-only):**
- `app/api/content-pilot/proposals/generate/route.ts`
- `app/api/content-pilot/proposals/manual/route.ts`
- `app/api/content-pilot/proposals/[id]/route.ts`
- `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`
- `app/api/content-pilot/regenerate-filipino/route.ts`
- `app/api/content-pilot/publish/route.ts`
- `app/api/cron/daily/route.ts`
- `lib/content-pilot/publish-draft.ts`
- `lib/content-pilot/generate-proposals.ts`
- `lib/opportunities/route.ts`
- `lib/opportunities/generate.ts`
- `__tests__/api/content-pilot-routes.test.ts`
- `__tests__/lib/content-pilot/*.test.ts`

**Deliverables:**
- A full issue list for Content Pilot only, each with path + symptom + impact.
- Severity-ranked audit entries in `docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md` under section `Content Pilot Findings`.

- [x] **Step 1: Run focused tests and capture current pass/fail state**
  - `npm test -- __tests__/api/content-pilot-routes.test.ts`
  - `npm test -- __tests__/lib/content-pilot`

- [x] **Step 2: Inspect proposal, scheduling, and publish code paths**
  - Focus on:
    - dedupe keys and null-handling collisions
    - pending/replacement semantics in proposals
    - draft generation and approval gating behavior
    - proposal→opportunity conversion logic in `upsertOpportunities`

- [x] **Step 3: File findings for Content Pilot**
  - Append findings to same review file with explicit severity + rationale.

- [x] **Step 4: Commit Task 2**
  - `git add docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md`
  - `git commit -m "docs: record content pilot audit findings"`

---

### Task 3: Cross-Pilot Severity Synthesis and Recommendations

**Files (read-only):**
- `docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md`
- `.superpowers/sdd/progress.md`
- `docs/CRON.md`

**Deliverables:**
- Global severity matrix: Critical/Important/Minor by subsystem and blast radius.
- Concrete next-action list with owner and risk tags.

- [x] **Step 1: Deduplicate overlapping findings**
  - Combine SEO and Content findings, collapsing duplicates and dependency chains.

- [x] **Step 2: Produce ordered severity ranking**
  - Use this section structure:
    - `## Severity Ranking`
    - `- [Critical] ...` with production impact and first-fix order
    - `- [Important] ...`
    - `- [Minor] ...`

- [x] **Step 3: Add recommendations and owner mapping**
  - For each item add:
    - `Owner: Content Pilot / SEO Pilot / Shared runtime`
    - `Fix effort: low|med|high`
    - `Risk of fix: low|med|high`

- [x] **Step 4: Commit synthesis**
  - `node -e "const fs=require('fs'); const p='docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md'; console.log(fs.readFileSync(p,'utf8').split('\n').length);"`
  - `git add docs/superpowers/reviews/2026-07-09-seo-content-pilot-audit-findings.md`
  - `git commit -m "docs: add cross-pilot severity synthesis"`

---

## Final Verification

- [x] Verify files are saved and parse cleanly in markdown.
- [x] Verify no runtime code paths were modified in this audit scope.
- [x] Verify all tasks have a complete findings section.

## Execution Log

- Subagent lane: Carson
  - Scope: SEO Pilot evidence sweep and route-level dedupe/status behavior.
  - Status: complete

- Subagent lane: Leibniz
  - Scope: Content Pilot evidence sweep, proposal generation path, and cron interactions.
  - Status: complete

- Subagent lane: Goodall
  - Scope: Test execution and blind-spot mapping.
  - Status: complete

- Subagent lane: Galileo
  - Scope: Cross-pilot synthesis, severity ordering, and execution risk tags.
  - Status: complete

## Self-Review

- Spec coverage: This plan covers SEO Pilot and Content Pilot logic end-to-end, from cron generation through proposal outcomes and operator surfaces.
- Placeholder scan: No TBD/placeholder text.
- Type consistency: Findings file structure and section names are consistent across tasks.
