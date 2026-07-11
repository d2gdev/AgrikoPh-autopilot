# Agriko Topical Map Strategy Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete validated Agriko topical-map package the single active, immutable strategy authority for governed Autopilot content and SEO proposals without allowing partial activation or bypassing existing approval/execution safeguards.

**Architecture:** Store immutable package sources, manifest identity, validation report, and compiled deterministic policy records in PostgreSQL. An atomic activation pointer selects one whole validated package. Policy evaluation enriches or blocks proposal creation; it never publishes, redirects, or executes live changes. Existing ContentProposal transitions, Recommendation guardrails, AuditLog, and Shopify-write workflows remain authoritative.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Zod, Vitest, Shopify Admin API, existing Content Pilot and SEO Pilot surfaces.

## Global Constraints

- The authoritative source package is exactly six artifacts plus manifest defined in `/home/sean/Agriko/shopify-theme/docs/seo/agriko-topical-map-strategy-package-spec.md`; the completed historical Task 2 implementation remains five-artifact work until Task 2A lands as a new commit.
- Validate and activate the entire package atomically; no artifact, cluster, CSV row, or compiled subset can become active independently.
- Every embedded mutation starts with `await requireAppAuth(req)`, then `requirePermission` before parsing or database work.
- All persistence uses `import { prisma } from "@/lib/db"`.
- Never perform Shopify writes, redirects, canonical changes, publishing, deployment, or live execution from package import/validation/activation.
- Preserve ContentProposal approval/publish transitions and Recommendation `EXECUTE_APPROVED_LIVE_ENABLED` safeguards.
- Package files are read from a configured server-only strategy root; browser code never receives raw package bytes.

## Planned File Map

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma` | Immutable package/version, artifact, validation, compiled-rule, activation, and compliance persistence. |
| `prisma/migrations/<timestamp>_add_topical_map_strategy_package/migration.sql` | Expand-only schema migration and indexes. |
| `lib/topical-map/types.ts` | Canonical TypeScript types and discriminated rule/result unions. |
| `lib/topical-map/manifest.ts` | Zod manifest parsing, canonical JSON hashing, compatibility checks. |
| `lib/topical-map/package-reader.ts` | Server-only discovery and byte/hash loading of all required artifacts. |
| `lib/topical-map/compiler.ts` | Deterministic Markdown/CSV compilation with source locators. |
| `lib/topical-map/validator.ts` | Whole-package cross-reference, ownership, redirect, gate, and stale-evidence validation. |
| `lib/topical-map/activation.ts` | Transactional immutable version persistence, activation, supersession, rollback. |
| `lib/topical-map/evaluator.ts` | Deterministic proposal-policy evaluation and compliance evidence. |
| `lib/topical-map/proposal-context.ts` | Adapters for ContentProposal, SEO, links, redirects, canonical/indexation operations. |
| `app/api/topical-map/*/route.ts` | Read-only inspection plus admin import/activate/rollback routes. |
| `app/(embedded)/(seo-pillar)/seo-pillar/components/StrategyPackagePanel.tsx` | Operator package status, validation report, activation and rollback UI. |
| `lib/content-pilot/generate-proposals.ts`, SEO proposal routes | Governed proposal evaluation; no direct execution changes. |
| `__tests__/lib/topical-map/*.test.ts`, `__tests__/api/topical-map-routes.test.ts`, `__tests__/postgres/topical-map-strategy.test.ts` | Unit, route, and database acceptance coverage. |

---

### Task 1: Define immutable persistence and migration contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_topical_map_strategy_package/migration.sql`
- Test: `__tests__/prisma/topical-map-strategy-migration.test.ts`, `__tests__/postgres/topical-map-strategy.test.ts`

**Interfaces:**
- Produces `TopicalMapStrategyVersion`, `TopicalMapStrategyArtifact`, `TopicalMapValidationIssue`, `TopicalMapCompiledRule`, `TopicalMapActivation`, `TopicalMapProposalCompliance`.
- `TopicalMapStrategyVersion` has unique `(siteHost, packageSha256)`, lifecycle `draft|validated|active|superseded|rolled_back|rejected`, immutable package metadata, and no update path for package bytes/hash.
- `TopicalMapActivation` has unique `siteHost` and points to exactly one validated version.

- [ ] **Step 1: Write failing migration tests** asserting all six models/indexes exist, the activation pointer is unique per site, compiled rules retain source locator, and compliance records retain proposal entity/version/hash/result/gates.
- [ ] **Step 2: Run** `npm test -- __tests__/prisma/topical-map-strategy-migration.test.ts`; **expected:** fail because models do not exist.
- [ ] **Step 3: Add expand-only Prisma models and SQL migration.** Use nullable foreign keys for existing `ContentProposal` and `Recommendation` relations, JSON fields for raw manifest/provenance/compiled payload/evidence, and indexes on lifecycle, active pointer, proposal entity, package hash, and rule type.
- [ ] **Step 4: Run** `npm run db:generate && npm run verify:prisma-client && npm test -- __tests__/prisma/topical-map-strategy-migration.test.ts`; **expected:** pass.
- [ ] **Step 5: Add PostgreSQL tests** for one active activation per host, rejected-version foreign-key rejection, and immutable package hash uniqueness.
- [ ] **Step 6: Run** `DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres`; **expected:** pass without production access.
- [ ] **Step 7: Commit** `feat(topical-map): add immutable strategy package persistence`.

### Task 2: Implement manifest, package discovery, and integrity validation

**Files:**
- Create: `lib/topical-map/types.ts`, `lib/topical-map/manifest.ts`, `lib/topical-map/package-reader.ts`
- Create: `__tests__/lib/topical-map/manifest.test.ts`, `__tests__/lib/topical-map/package-reader.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `readStrategyPackage(root: string): Promise<RawStrategyPackage>` returns all five required artifacts, byte hashes, manifest, and package hash.
- `parseManifest(value: unknown): StrategyManifest` accepts only schema `1.0.0`, exact required artifact IDs, SHA-256 values, supported compatibility range, `agrikoph.com`, and evidence date.

- [ ] **Step 1: Write failing tests** with a complete fixture package, missing evidence file, duplicate artifact ID, mismatched SHA-256, unsupported runtime schema, and mismatched filename/version.
- [ ] **Step 2: Run** `npm test -- __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts`; **expected:** fail because readers do not exist.
- [ ] **Step 3: Implement canonical JSON serialization, SHA-256 hashing, path traversal rejection, required-file discovery, and manifest Zod parsing.** Read only from `TOPICAL_MAP_STRATEGY_ROOT`; reject symlink escape outside root.
- [ ] **Step 4: Add `TOPICAL_MAP_STRATEGY_ROOT=` documentation to `.env.example`; it is server-only and not `NEXT_PUBLIC_*`.
- [ ] **Step 5: Re-run focused tests; expected:** all fixture failures return typed `StrategyPackageError` codes and valid package passes.
- [ ] **Step 6: Commit** `feat(topical-map): validate complete strategy package manifests`.

### Task 3: Compile all source artifacts with traceability

**Files:**
- Create: `lib/topical-map/compiler.ts`, `lib/topical-map/url-normalizer.ts`
- Create: `__tests__/lib/topical-map/compiler.test.ts`, fixture directory under `__tests__/fixtures/topical-map/2026-07-11/`

**Interfaces:**
- `compileStrategyPackage(raw: RawStrategyPackage): CompiledStrategyPackage` emits typed clusters, page rules, intent owners, content decisions, prohibited-content rules, links, redirects, canonical/indexation rules, evidence gates, and high-stakes reviews.
- Every compiled item has `ruleId`, `sourceArtifactId`, `sourceLocator`, `strategyVersion`, and `packageSha256`.

- [ ] **Step 1: Write failing tests** asserting compilation retains all URL inventory rows, all redirect rows, all 456 internal-link rows, known `do_not_create` decisions, conditional brown-recipe creation, dossier gates, and medical/dosage review rules.
- [ ] **Step 2: Run** `npm test -- __tests__/lib/topical-map/compiler.test.ts`; **expected:** fail because compiler does not exist.
- [ ] **Step 3: Implement CSV header validation and Markdown section/table extraction without LLM calls.** Normalize Agriko URLs by lowercasing host, stripping default ports, preserving path/query only where strategy source specifies it, and rejecting external destinations except declared evidence links.
- [ ] **Step 4: Re-run compiler tests; expected:** exact row counts/source locators and typed rules pass.
- [ ] **Step 5: Commit** `feat(topical-map): compile whole-package policy records`.

### Task 4: Whole-package validator and validation report

**Files:**
- Create: `lib/topical-map/validator.ts`
- Create: `__tests__/lib/topical-map/validator.test.ts`

**Interfaces:**
- `validateCompiledPackage(input): ValidationReport` returns `valid`, `issues[]`, `blockingIssueCount`, `evidenceFreshness`, and never repairs input.
- Blocking codes include `MISSING_ARTIFACT`, `HASH_MISMATCH`, `INCOMPATIBLE_SCHEMA`, `CONFLICTING_INTENT_OWNER`, `ORPHANED_REFERENCE`, `REDIRECT_CONFLICT`, `CANONICAL_CONFLICT`, `MISSING_EVIDENCE_GATE`, and `STALE_MANDATORY_EVIDENCE`.

- [ ] **Step 1: Write failing tests for each blocking code plus valid July-11 fixture.**
- [ ] **Step 2: Run** `npm test -- __tests__/lib/topical-map/validator.test.ts`; **expected:** fail because validator does not exist.
- [ ] **Step 3: Implement deterministic cross-reference checks.** Reject conflicts rather than choosing a winner; permit historic stale evidence only for inspection, never activation where a mandatory gate is stale.
- [ ] **Step 4: Re-run tests; expected:** valid package reports zero blocking issues, every corrupted fixture reports exact rule/source locator.
- [ ] **Step 5: Commit** `feat(topical-map): reject incomplete or conflicting strategy packages`.

### Task 5: Persist, activate, supersede, and rollback atomically

**Files:**
- Create: `lib/topical-map/activation.ts`
- Create: `__tests__/lib/topical-map/activation.test.ts`, `__tests__/postgres/topical-map-activation.test.ts`

**Interfaces:**
- `importAndValidatePackage(input): Promise<StrategyVersionResult>` stores immutable artifacts/rules/report; it never activates.
- `activateStrategyVersion(input: { siteHost; versionId; actor }): Promise<ActiveStrategy>` uses one Prisma transaction, requires `validated`, supersedes old active version, writes `AuditLog` action `topical_map_strategy_activated`.
- `rollbackStrategyVersion` only targets an already validated historic version and writes `topical_map_strategy_rolled_back`.

- [ ] **Step 1: Write failing tests for idempotent same-hash import, invalid import rejection, concurrent activation, supersession, rollback, and audit payloads.**
- [ ] **Step 2: Run focused unit and PostgreSQL tests; expected:** fail before implementation.
- [ ] **Step 3: Implement transactions with conditional lifecycle predicates and no mutable overwrite of package/artifact/rule bytes.**
- [ ] **Step 4: Re-run focused tests; expected:** exactly one active pointer and auditable lifecycle transitions.
- [ ] **Step 5: Commit** `feat(topical-map): atomically activate immutable strategy versions`.

### Task 6: Build deterministic policy evaluation and compliance evidence

**Files:**
- Create: `lib/topical-map/evaluator.ts`, `lib/topical-map/proposal-context.ts`
- Create: `__tests__/lib/topical-map/evaluator.test.ts`

**Interfaces:**
- `evaluateStrategyPolicy(active, candidate): StrategyComplianceResult` returns `compliant | conflict | blocked | needs_evidence | needs_high_stakes_review | unavailable_strategy`, matched rules, freshness, required approvals, and stable reason codes.
- Candidate types: `content`, `internal_link`, `redirect`, `canonical`, `indexation`, `seo_metadata`.

- [ ] **Step 1: Write failing tests for owner conflict, explicit do-not-create, exact required link, link to legacy redirect source, conditional recipe threshold, stale evidence, dosage medical review, and unavailable active strategy.**
- [ ] **Step 2: Run** `npm test -- __tests__/lib/topical-map/evaluator.test.ts`; **expected:** fail because evaluator does not exist.
- [ ] **Step 3: Implement pure matching only; prohibit LLM calls, AI-generated owner selection, gate waivers, and active-version selection.**
- [ ] **Step 4: Re-run tests; expected:** identical input yields identical result and source rule IDs.
- [ ] **Step 5: Commit** `feat(topical-map): evaluate governed proposals deterministically`.

### Task 7: Add secured operator import, inspection, activation, and rollback APIs

**Files:**
- Create: `app/api/topical-map/packages/route.ts`, `app/api/topical-map/packages/[id]/route.ts`, `app/api/topical-map/packages/[id]/activate/route.ts`, `app/api/topical-map/packages/[id]/rollback/route.ts`
- Create: `__tests__/api/topical-map-routes.test.ts`

- [ ] **Step 1: Write failing tests proving every mutation calls auth first then `SETTINGS_ADMIN`, unauthorized/forbidden paths perform no filesystem/database/audit work, invalid packages cannot activate, and successful activation writes audit records.
- [ ] **Step 2: Run** `npm test -- __tests__/api/topical-map-routes.test.ts`; **expected:** fail before routes exist.
- [ ] **Step 3: Implement routes using server-only configured root, typed safe errors, and activation service.** GET inspection is auth-only; import/activate/rollback require `SETTINGS_ADMIN`.
- [ ] **Step 4: Re-run route tests; expected:** 401/403 short circuit, 409 for invalid lifecycle, 200/201 for valid operations.
- [ ] **Step 5: Commit** `feat(topical-map): add secured strategy package operations`.

### Task 8: Integrate governed Content Pilot and SEO proposal creation

**Files:**
- Modify: `lib/content-pilot/generate-proposals.ts`, `app/api/content-pilot/proposals/manual/route.ts`, `app/api/seo/promote/route.ts`, `app/api/seo/gaps/promote/route.ts`, `app/api/seo/recommendations/decompose/route.ts`
- Create: `lib/topical-map/compliance-store.ts`
- Test: `__tests__/api/content-pilot-permissions.test.ts`, `__tests__/api/seo-pilot-routes.test.ts`, `__tests__/lib/content-pilot/generate-proposals.test.ts`, new `__tests__/lib/topical-map/proposal-integration.test.ts`

- [ ] **Step 1: Write failing tests for compliant proposal traceability, blocked owner conflict causing no ContentProposal write, high-stakes result requiring review metadata, and unavailable strategy creating no governed proposal.
- [ ] **Step 2: Run focused suites; expected:** fail before evaluator integration.
- [ ] **Step 3: Invoke evaluator before proposal creation and persist the full compliance record in normalized storage plus `sourceData.strategyCompliance`.** Existing approval, draft generation, publish, and reconciliation state machines remain unchanged.
- [ ] **Step 4: Re-run tests; expected:** compliant proposals retain version/hash/rules; conflicts have visible evidence and no publishable proposal.
- [ ] **Step 5: Commit** `feat(topical-map): govern Content and SEO proposals`.

### Task 9: Integrate links, redirects, canonical/indexation, and high-stakes workflow boundaries

**Files:**
- Create: `lib/topical-map/governed-operations.ts`, `app/api/topical-map/evaluate/route.ts`
- Modify: `lib/content-pilot/internal-link-edges.ts`, `lib/content-pilot/generate-proposals.ts`, `app/api/content-pilot/link-graph/route.ts`, `app/api/seo/health/route.ts`, `app/api/seo/analyze/route.ts`, `app/api/seo/recommendations/decompose/route.ts`
- Test: `__tests__/lib/topical-map/governed-operations.test.ts`, route suites for each modified owner

- [ ] **Step 1: Write failing tests showing a required link passes only with exact source/destination rule, a legacy URL link is blocked, redirect/canonical operations require satisfied evidence gates, and health/dosage operations require designated review metadata.**
- [ ] **Step 2: Run focused tests; expected:** fail before policy adapter exists.
- [ ] **Step 3: Implement adapters that generate reviewable proposals only.** They must never call Shopify mutation APIs; redirect/canonical/indexation execution remains unavailable until separately approved execution work is designed.
- [ ] **Step 4: Re-run tests; expected:** all governed operation types preserve rule evidence and fail closed on unavailable strategy.
- [ ] **Step 5: Commit** `feat(topical-map): govern links and technical SEO operations`.

### Task 10: Add SEO Pilot operator surface and observability

**Files:**
- Create: `app/(embedded)/(seo-pillar)/seo-pillar/components/StrategyPackagePanel.tsx`, `__tests__/components/topical-map-strategy-panel.test.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`, SEO Pilot types/load hook, `app/api/seo/*` read aggregation as needed

- [ ] **Step 1: Write failing component tests for active version, stale evidence banner, validation issues, conflict counts, rule trace links, activation/rollback permissions, and no hidden partial state.
- [ ] **Step 2: Run** `npm test -- __tests__/components/topical-map-strategy-panel.test.ts`; **expected:** fail before panel exists.
- [ ] **Step 3: Implement read-first operator UI with explicit active/inactive/rejected status, validation report, package hash, evidence date, activation audit timeline, and proposal compliance evidence.**
- [ ] **Step 4: Re-run component/API tests; expected:** active package and conflicts are intelligible without exposing raw strategy files to the browser.
- [ ] **Step 5: Commit** `feat(seo): expose topical map strategy governance`.

### Task 11: Complete migration safety, documentation, and full acceptance gates

**Files:**
- Modify: `.mex/ROUTER.md`, `.mex/context/architecture.md`, `.mex/context/skills-recommendations.md`, `.env.example`, `docs/CRON.md` only if a new validation cron is introduced
- Create or update: `.mex/patterns/topical-map-strategy-package.md`, `.mex/patterns/INDEX.md`
- Modify: `/home/sean/Agriko/shopify-theme/docs/seo/agriko-topical-map-plugin-governance.md` only to link the implemented runtime contract.

- [ ] **Step 1: Add package-validation job only after a separate cron design confirms `requireCronAuth` then `acquireJobLock`; otherwise retain operator-triggered validation and document no cron exists.**
- [ ] **Step 2: Add deployment migration guidance: expand-only migration, backup, `prisma migrate deploy`, no destructive rollback; rollback is activation-pointer rollback, not schema rollback.
- [ ] **Step 3: Run** `npm run db:generate && npm run verify:prisma-client && npm test && npm run typecheck && npm run typecheck:test && npm run lint && DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/autopilot_test?connection_limit=1&pool_timeout=5' npm run build && git diff --check`; **expected:** all pass, lint may report only pre-existing warnings.
- [ ] **Step 4: Run** PostgreSQL suite with the isolated URL; **expected:** activation uniqueness, immutability, and compliance persistence pass.
- [ ] **Step 5: Perform specification review and code-quality review; resolve initial findings, then re-run the full acceptance gate.**
- [ ] **Step 6: Deploy only after explicit authorization.** Verify remote commit, migration status, active build artifact, PM2 restart, health endpoint, active strategy remains unchanged unless an operator explicitly activates a validated package, and no Shopify write was performed by import/validation.

## Final Acceptance Matrix

## Approved Compilation-Contract Amendment

Tasks 1 and 2 above are completed historical five-artifact work. They must not be rewritten. The following tasks are mandatory before compiler work resumes. The authoritative package is six required artifacts plus manifest; no incomplete, unapproved, or five-artifact package has authority.

### Task 2A: Six-artifact package amendment

**Files:** Modify `lib/topical-map/types.ts`, `lib/topical-map/manifest.ts`, `lib/topical-map/package-reader.ts`, `__tests__/lib/topical-map/manifest.test.ts`, `__tests__/lib/topical-map/package-reader.test.ts`, and `.env.example` only if contract-root documentation changes. No Prisma change: Task 1 remains compatible unless later implementation evidence proves a contract-specific field necessary.

**Interfaces:** Require exact artifacts `map`, `evidence`, `url-inventory`, `redirect-inventory`, `internal-links`, and `compilation-contract`. The sixth artifact is `agriko-topical-map-compilation-contract-${strategyVersion}.json`, media type `application/json`, and UTF-8 without BOM. Manifest and reader return a six-artifact `RawStrategyPackage`; the reader verifies the raw contract-byte hash before JSON decoding. Package hashing is non-circular: contract references five semantic hashes, manifest references six hashes, and final package hash derives from canonical manifest without `packageSha256`.

**Task 2A envelope:** Parse only `contractSchemaVersion`, `contractRevision`, `strategyVersion`, `siteHost`, `sourceArtifacts`, and `compatibility`; permit all other top-level fields as opaque. Require exact `contractSchemaVersion: "1.0.0"`, positive-decimal `contractRevision` matching `^[1-9][0-9]*$`, and top-level host `agrikoph.com`. `sourceArtifacts` is exactly five ordered entries — `map`, `evidence`, `url-inventory`, `redirect-inventory`, `internal-links` — each with exactly `id` and lowercase SHA-256 `sha256`; every source hash equals the corresponding manifest hash. `compatibility` has exactly `runtimeSchema`, `pluginVersion`, `siteHost`, and `urlNormalization`, each exactly equal to manifest compatibility; unknown compatibility keys fail. Contract strategy version equals manifest strategy version, and all three host values equal `agrikoph.com`.

**Stable errors:** `MISSING_COMPILATION_CONTRACT`, `CONTRACT_FILENAME_MISMATCH`, `CONTRACT_MEDIA_TYPE_MISMATCH`, `INVALID_CONTRACT_ENCODING`, `INVALID_CONTRACT_ENVELOPE`, `UNSUPPORTED_CONTRACT_SCHEMA`, `INVALID_CONTRACT_REVISION`, `CONTRACT_STRATEGY_VERSION_MISMATCH`, `CONTRACT_SITE_HOST_MISMATCH`, `CONTRACT_SOURCE_ARTIFACT_MISMATCH`, `CONTRACT_SOURCE_HASH_MISMATCH`, `CONTRACT_COMPATIBILITY_MISMATCH`.

- [ ] Write failing focused tests: previous five-artifact fixture fails; valid six-artifact fixture passes; missing/duplicate/unknown contract fails; incorrect contract filename, media type, hash, schema version, revision, UTF-8/BOM encoding, source artifact set/order/hash, strategy version, host, or compatibility fails with its stable error; changing only contract bytes changes artifact and package identity; opaque top-level body fields remain uninterpreted; traversal and symlink protections apply to the sixth artifact.
- [ ] Run `npm test -- __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts`; expect failure from five-artifact assumptions.
- [ ] Implement minimum parser/type/reader changes; preserve raw bytes, reject partial package loading, parse only the approved compatibility envelope, and do not parse or infer policy semantics.
- [ ] Re-run the focused tests; expect all pass. Run `npm test -- __tests__/prisma/topical-map-strategy-migration.test.ts`, `npm run verify:prisma-client`, `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, and `git diff --check`.
- [ ] Commit `feat(topical-map): require compilation contract artifact`.

### Task 2B: Contract authoring and operator approval

**Files:** Create the contract schema and July 11 compilation-contract artifact in `/home/sean/Agriko/shopify-theme/docs/seo/`; create contract/locator/coverage tests and runtime validation types in `lib/topical-map/` only where necessary; update the six-artifact manifest after source-editor approval.

**Interfaces:** Task 2B replaces Task 2A's opaque body with the full contract schema: locator grammar, coverage inventory, typed rule envelopes, ambiguity records, source fingerprints, review metadata, and full policy semantics. It preserves the Task 2A compatibility envelope exactly. Every rule resolves to human-source anchors; every declared coverage unit has a disposition; unresolved activation-blocking ambiguity prevents approval.

- [ ] Write failing tests for source-anchor resolution, fingerprint drift, bidirectional coverage, unanchored rule rejection, undisposed coverage rejection, conflicting exclusive mappings, and unresolved activation-blocking ambiguity.
- [ ] Run focused contract tests; expect failure because no approved contract exists.
- [ ] Author the contract and coverage inventory without changing human semantic sources; update the six-artifact manifest only after editorial review.
- [ ] Run focused tests; expect exact anchor/coverage validation pass.
- [ ] Stop at explicit operator approval of the contract and coverage inventory. Do not begin compiler work, activate a package, or write runtime policy before approval.
- [ ] Commit `docs(seo): add reviewed topical map compilation contract` only after approval.

### Revised Task 3: Compile approved contract mappings

**Dependencies:** Task 2A complete and Task 2B operator-approved. `compileStrategyPackage(raw)` consumes approved typed contract rules only. Markdown/CSV code resolves and fingerprints cited anchors; it never derives typed policy semantics from prose.

**Tests:** Require every contract rule to resolve; every coverage unit to dispose; locator/fingerprint drift and unresolved activation-blocking ambiguity to reject compilation atomically; all 163 URL rows, 113 redirect rows, and 456 link rows to remain accounted for; and output to retain contract plus human-source locators.

### Downstream Amendment Requirements

Validator, activation, evaluator, APIs, UI, traceability, deployment, documentation, and final acceptance must require six-artifact identity, approved contract version, coverage/anchor validation, ambiguity handling, human-source plus contract-rule traceability, and atomic rejection without partial authority. No downstream task may activate or evaluate an incomplete or unapproved package.

**Dependency order:** (1) approved envelope documentation; (2) Task 2A six-artifact boundary implementation; (3) Task 2B full schema, July 11 contract authoring, and explicit operator approval; (4) compiler work. Task 2A and Task 2B remain unimplemented until their own TDD and approval gates complete.

- Complete six-artifact package plus manifest validates with hashes, the approved envelope, and source locators.
- Missing, stale mandatory, incompatible, conflicting, orphaned, or mismatched packages cannot activate.
- Activation/supersession/rollback is transactional, immutable, audit logged, and leaves exactly one active version.
- Content, SEO, links, redirects, canonicalization, indexation, and high-stakes candidates all receive deterministic compliance evidence.
- No partial package, AI decision, import action, or strategy status can bypass ContentProposal approvals, permissions, AuditLog, guardrails, or live-execution gates.
- Full tests, Prisma verification, typechecks, lint, build, diff check, reviews, and production verification pass before completion.
