# Phase 9 — A11y & Theming Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the roadmap's final item (17): replace remaining raw hex colors with Polaris design tokens, replace emoji-as-icons with Polaris icons + text, make scrollable regions keyboard-reachable, and lock the rule in with a policy test — across the pages NOT already covered by the Phase 8a/8b/8c fold-ins.

**Architecture:** Pure presentation-layer edits to three page files plus two shared component files. No API, schema, state, or handler changes anywhere. The Phase 8 fold-ins already cleaned dashboard, content-pilot, and seo-pillar (except two small scrollable-region gaps found by this phase's survey); the survey below found exactly **11 raw-hex lines in 3 files**, **8 emoji-icon sites in 3 files**, and **3 keyboard-unreachable scrollable regions** — this plan enumerates all of them exhaustively.

**Tech Stack:** Next.js App Router, React, `@shopify/polaris` (Icon, Button, InlineStack, Text), `@shopify/polaris-icons`, Polaris CSS custom properties (`var(--p-color-...)`), Jest.

## Global Constraints

- **Zero behavior change**: no handler, state, fetch, or routing edits. Visual/a11y presentation only.
- All database access via `import { prisma } from "@/lib/db"` (not touched this phase, but binding).
- Do NOT touch the seo-pillar page's lifted promote/plan/track handlers (Phase 8c standing rule).
- `pause_ad` must never be added to `CONVERSION_SENSITIVE_ACTIONS` (not touched this phase, but binding).
- **Gate every task on the full test suite** (`npm test`), not just tsc/build — Phase 8c's process-gap lesson. Baseline: 741 passing tests.
- **NO deploy in this phase.** The prod deploy script runs `prisma migrate deploy` automatically, and the unapplied `DailySales` migration (`20260704020000_daily_sales`) is explicitly deferred to operator go-ahead. The roadmap's "🚀 Final deploy" is surfaced to the operator at the end, never executed.
- Icon names verified to exist in the installed `@shopify/polaris-icons`: `ChevronUpIcon`, `ChevronDownIcon`, `CashDollarIcon`, `AlertTriangleIcon`, `CheckIcon`, `XIcon`.
- Token names verified to exist in the installed `@shopify/polaris-tokens`: `--p-color-bg-fill-success`, `--p-color-bg-fill-warning`, `--p-color-bg-fill-caution`, `--p-color-bg-fill-critical`, `--p-color-bg-fill-tertiary`, `--p-color-bg-surface-secondary`, `--p-color-icon-secondary`.
- Commit style: match repo convention, e.g. `refactor(a11y): ...` / `fix(a11y): ...`, one commit per task.
- Token discipline: use `rtk grep`, `rtk git log`/`diff`, `rtk ls`, `rtk find` instead of bare commands.

## Survey Results (ground truth, 2026-07-05)

Raw hexes (`grep -rn --include="*.tsx" -E "#[0-9a-fA-F]{6}" "app/(embedded)"` — 11 lines):

| File | Lines | What |
|---|---|---|
| `app/(embedded)/(ad-pilot)/campaigns/page.tsx` | 64–67, 108, 111 | `roasBarColor` (4 hexes), `ConfBar` fill (3 hexes in one line) + track |
| `app/(embedded)/(ad-pilot)/recommendations/page.tsx` | 351 | `#f6f6f6` execution-detail background |
| `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` | 103, 130, 134, 153 | Brand hero panel (deliberate — becomes the documented exemption) |

Emoji-as-icons: campaigns `▲▼` (382), `💰` (478), `⚠` (492), `✓ Approve` (514), `✗ Reject` (522); recommendations `⚠` (338); market-intelligence `✓` (548). The seo-pillar `▲▼` occurrences (`page.tsx:294`, `KeywordsPanel.tsx:66`, `widgets.tsx:23`) are **not** in scope: they are data-cell trend glyphs paired with numeric text (widgets.tsx's Delta already has an `aria-hidden` glyph + visually-hidden text from 8c) — they satisfy the second-channel rule and were reviewed as acceptable in Phase 8c.

Keyboard-unreachable scrollable regions (`overflowX/overflow: "auto"`): `recommendations/page.tsx:351`, `content-pilot/components/helpers.tsx:80`, `components/dashboard/JobHealth.tsx:144`.

Clickable non-button elements: **none found** (single-line and multiline sweeps both clean — all `onClick`s are on Polaris `Button`s or inside them).

---

### Task 1: Campaigns page — tokens + Polaris icons

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/campaigns/page.tsx` (566 lines; edits at 63–67, 106–118, ~378–384, ~476–480, ~490–495, ~508–524, plus imports)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks (Task 5's policy test requires this file to be hex-free).

- [ ] **Step 1: Check no test couples to the literals being changed**

Run: `rtk grep -rn "✓ Approve\|✗ Reject\|roasBarColor\|ConfBar\|#007f5f" __tests__/`
Expected: no matches. If any match, read that test and update its assertion in the same commit, preserving what it verifies (Phase 8c lesson: fix faithfully, don't weaken).

- [ ] **Step 2: Add imports**

At the top of the file, extend the existing `@shopify/polaris` import with `Icon` (if not already imported), and add:

```tsx
import { AlertTriangleIcon, CashDollarIcon, CheckIcon, XIcon } from "@shopify/polaris-icons";
```

- [ ] **Step 3: Replace `roasBarColor` hexes with tokens**

```tsx
function roasBarColor(v: number | null): string {
  if (v === null) return "var(--p-color-icon-secondary)";
  if (v >= 1.0)  return "var(--p-color-bg-fill-success)";
  if (v >= ROAS_THRESHOLD) return "var(--p-color-bg-fill-warning)";
  return "var(--p-color-bg-fill-critical)";
}
```

(The colored top bar is not a color-only signal: the adjacent `Badge tone={roasTone(...)}` carries the same information as text — no second channel needed.)

- [ ] **Step 4: Replace `ConfBar` hexes with tokens**

```tsx
function ConfBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 85 ? "var(--p-color-bg-fill-success)"
    : pct >= 65 ? "var(--p-color-bg-fill-warning)"
    : "var(--p-color-icon-secondary)";
  return (
    <InlineStack gap="150" blockAlign="center">
      <div style={{ width: 48, height: 4, borderRadius: 2, background: "var(--p-color-bg-fill-tertiary)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <Text as="span" variant="bodySm" tone="subdued">{pct}% conf</Text>
    </InlineStack>
  );
}
```

(`{pct}% conf` text already provides the non-color channel.)

- [ ] **Step 5: Replace the `▲▼` caret on the pending-actions toggle with Polaris disclosure**

At ~line 378–384, change the Button to use the built-in disclosure chevron instead of glyphs in the label:

```tsx
<Button
  size="slim"
  tone="critical"
  disclosure={isOpen ? "up" : "down"}
  onClick={() => toggleRecs(c.id)}
>
  {`${c.pendingRecs} pending action${c.pendingRecs !== 1 ? "s" : ""}`}
</Button>
```

- [ ] **Step 6: Replace `💰` with `CashDollarIcon`**

At ~line 476–480:

```tsx
<InlineStack gap="150" blockAlign="center">
  <Icon source={CashDollarIcon} tone="subdued" />
  <Text as="span" variant="bodySm" fontWeight="semibold">
    {rec.estimatedImpact}
  </Text>
</InlineStack>
```

- [ ] **Step 7: Replace `⚠` with `AlertTriangleIcon`**

At ~line 490–495 (inside the existing `bg-surface-caution` Box):

```tsx
<InlineStack gap="100" blockAlign="start" wrap={false}>
  <Icon source={AlertTriangleIcon} tone="caution" />
  <Text as="p" variant="bodySm">{rec.guardReason}</Text>
</InlineStack>
```

- [ ] **Step 8: Replace `✓ Approve` / `✗ Reject` glyphs with Button icons**

At ~lines 508–524, keep every prop identical and change only the icon/label:

```tsx
<Button
  size="slim"
  variant="primary"
  icon={CheckIcon}
  loading={approvingId === rec.id}
  disabled={rejectingId !== null}
  onClick={() => setConfirmTarget({ rec, campaignId: c.id })}
>
  Approve
</Button>
<Button
  size="slim"
  icon={XIcon}
  loading={rejectingId === rec.id}
  disabled={approvingId !== null}
  onClick={() => reject(rec, c.id)}
>
  Reject
</Button>
```

- [ ] **Step 9: Verify the file is hex- and emoji-clean**

Run: `rtk grep -n -E "#[0-9a-fA-F]{3,8}\b|▲|▼|✓|✗|💰|⚠" "app/(embedded)/(ad-pilot)/campaigns/page.tsx"`
Expected: no matches.

- [ ] **Step 10: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, 741/741 tests pass, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add "app/(embedded)/(ad-pilot)/campaigns/page.tsx"
git commit -m "refactor(a11y): campaigns page — Polaris tokens for ROAS/confidence bars, icons for emoji glyphs"
```

---

### Task 2: Recommendations page — token + icon + keyboard-reachable detail region

**Files:**
- Modify: `app/(embedded)/(ad-pilot)/recommendations/page.tsx` (519 lines; edits at ~336–355 plus imports)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed later (Task 5's policy test requires this file hex-free).

- [ ] **Step 1: Add imports**

Extend the `@shopify/polaris` import with `Icon` (if missing) and add:

```tsx
import { AlertTriangleIcon } from "@shopify/polaris-icons";
```

- [ ] **Step 2: Replace the `⚠` guard-reason line (~line 338)**

```tsx
{rec.guardReason && (
  <InlineStack gap="100" blockAlign="start" wrap={false}>
    <Icon source={AlertTriangleIcon} tone="critical" />
    <Text as="p" tone="critical">{rec.guardReason}</Text>
  </InlineStack>
)}
```

- [ ] **Step 3: Tokenize and make the execution-detail scroll region keyboard-reachable (~line 351)**

```tsx
<div
  tabIndex={0}
  role="region"
  aria-label="Execution detail"
  style={{ fontFamily: "monospace", fontSize: 12, background: "var(--p-color-bg-surface-secondary)", padding: 10, borderRadius: 6, overflowX: "auto" }}
>
  {JSON.stringify(rec.executionResult, null, 2)}
</div>
```

- [ ] **Step 4: Verify file clean**

Run: `rtk grep -n -E "#[0-9a-fA-F]{3,8}\b|⚠|✓|✗" "app/(embedded)/(ad-pilot)/recommendations/page.tsx"`
Expected: no matches.

- [ ] **Step 5: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add "app/(embedded)/(ad-pilot)/recommendations/page.tsx"
git commit -m "refactor(a11y): recommendations page — token for exec-detail bg, warning icon, keyboard-reachable scroll region"
```

---

### Task 3: Market Intelligence — brand-hero exemption formalized + check icon + contrast fix

**Files:**
- Modify: `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` (edits at ~90–170 hero, ~548, plus imports)

**Interfaces:**
- Consumes: nothing.
- Produces: this file becomes the **single documented allowlist entry** in Task 5's policy test — the comment text below is what justifies it.

**Decision (pre-made, do not re-litigate):** the hero panel's dark agricultural gradient + gold accent is a deliberate, designed brand surface ("soft agricultural glow… depth without decoration"), self-contained and legible in both Polaris themes; its palette has no Polaris-token equivalent. Ripping it out for token purity would be a design regression, not an a11y win. It stays, as a **disclosed exemption** — hoisted into one named constant with a justification comment, allowlisted in the policy test, and disclosed in ROUTER.

- [ ] **Step 1: Hoist hero palette into a named constant with justification comment**

Add above the hero component:

```tsx
// Agriko brand surface — deliberate, documented exception to the no-raw-hex rule
// (allowlisted in __tests__/a11y/no-raw-hex.test.ts): this hero is a self-contained
// dark branded panel, legible in both Polaris light and dark themes, and its
// agricultural palette has no Polaris token equivalent. Do not "fix" these hexes.
const BRAND_HERO = {
  gradient: "linear-gradient(135deg, #0A2417 0%, #124A2C 60%, #0C3320 100%)",
  glow: "radial-gradient(circle, rgba(61,187,107,0.20) 0%, rgba(61,187,107,0) 70%)",
  gold: "#E8A33D",
  goldRing: "rgba(232,163,61,0.22)",
  accentGreen: "#69E29A",
  textPrimary: "#FFFFFF",
  textMuted: "rgba(233,238,231,0.75)",
  shadow: "0 14px 34px -16px rgba(6,26,16,0.65)",
} as const;
```

Then replace each inline literal in the hero JSX with the matching `BRAND_HERO.*` reference. **Contrast fix folded in:** the two muted-text colors currently at alpha 0.68 (`rgba(233,238,231,0.68)`, "Last sweep …" line) and 0.62 (metric labels) both become `BRAND_HERO.textMuted` at **0.75** — at 0.62 over the `#124A2C` gradient stop the computed contrast is ≈4.4:1 (fails WCAG AA for 12.5px text); at 0.75 it is ≈5.6:1 (passes). This is the one intentional visual change in the file.

- [ ] **Step 2: Replace the trailing `✓` (~line 548)**

Add `CheckIcon` to the existing `@shopify/polaris-icons` import (which already has `RefreshIcon`), add `Icon` to the Polaris import if missing, then:

```tsx
<InlineStack gap="100" blockAlign="center">
  <Icon source={CheckIcon} tone="success" />
  <Text as="p" tone="success" variant="bodySm">Sent to Content Pilot</Text>
</InlineStack>
```

- [ ] **Step 3: Verify only BRAND_HERO holds hexes**

Run: `rtk grep -n -E "#[0-9a-fA-F]{3,8}\b" "app/(embedded)/(market-intelligence)/market-intelligence/components.tsx"`
Expected: matches ONLY inside the `BRAND_HERO` constant block (gradient line, gold, accentGreen, textPrimary). Also run `rtk grep -n "✓\|✗\|⚠" <same file>` — expected: no matches.

- [ ] **Step 4: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(embedded)/(market-intelligence)/market-intelligence/components.tsx"
git commit -m "refactor(a11y): market-intelligence — formalize brand-hero hex exemption, AA contrast for muted text, CheckIcon"
```

---

### Task 4: Keyboard access for the two remaining scrollable regions

**Files:**
- Modify: `app/(embedded)/(content-pilot)/content-pilot/components/helpers.tsx:80` (raw-JSON `<pre>`)
- Modify: `app/(embedded)/components/dashboard/JobHealth.tsx:132-148` (error-excerpt `<pre>`)

**Interfaces:** none consumed or produced.

These are the two scrollable overflow regions the Phase 8a/8b fold-ins missed (those fold-ins were scoped to hex colors; the keyboard rule is Phase 9's). A scrollable region that can't receive focus can't be scrolled by keyboard users.

- [ ] **Step 1: content-pilot helpers.tsx — focusable raw-JSON pre**

```tsx
<pre tabIndex={0} role="region" aria-label="Proposal details" style={{ fontSize: "12px", overflowX: "auto", background: "var(--p-color-bg-surface-secondary)", padding: "8px", borderRadius: "4px" }}>
  {JSON.stringify(proposedState, null, 2)}
</pre>
```

- [ ] **Step 2: dashboard JobHealth.tsx — focusable error-excerpt pre**

Add `tabIndex={0} role="region" aria-label="Job error detail"` to the `<pre>` at ~line 133 (the one with `maxHeight: 120, overflow: "auto"`); style object unchanged.

- [ ] **Step 3: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(embedded)/(content-pilot)/content-pilot/components/helpers.tsx" "app/(embedded)/components/dashboard/JobHealth.tsx"
git commit -m "fix(a11y): make scrollable JSON/error regions keyboard-focusable (content-pilot, dashboard)"
```

---

### Task 5: Policy lock-in test + final sweep

**Files:**
- Create: `__tests__/a11y/no-raw-hex.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 must have landed (otherwise this test fails on their files).
- Produces: the standing "rule going forward" from the roadmap — any future raw hex in `app/(embedded)` fails CI.

Deliberately sequenced last rather than TDD-first so the suite stays green between tasks (Phase 8c lesson: every task gates on the full suite; a red policy test sitting across three tasks would defeat that).

- [ ] **Step 1: Write the policy test**

```ts
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = "app/(embedded)";

// Deliberate brand surface — the Market Intelligence hero is a self-contained
// dark branded panel whose agricultural palette has no Polaris token
// equivalent. See the BRAND_HERO constant's comment in that file.
const ALLOWLIST = new Set([
  "app/(embedded)/(market-intelligence)/market-intelligence/components.tsx",
]);

// Word-boundary hex; can false-positive on e.g. "#123456" issue refs in
// comments — if that ever happens, reword the comment or extend ALLOWLIST.
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|css)$/.test(name) ? [p] : [];
  });
}

describe("a11y/theming policy (roadmap Phase 9): no raw hex colors in app/(embedded)", () => {
  it("uses Polaris design tokens instead of hardcoded hex colors", () => {
    const offenders = walk(ROOT)
      .filter((p) => !ALLOWLIST.has(p.split("\\").join("/")))
      .flatMap((p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .map((line, i) => (HEX.test(line) ? `${p}:${i + 1}: ${line.trim()}` : null))
          .filter((x): x is string => x !== null)
      );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new test alone**

Run: `npm test -- __tests__/a11y/no-raw-hex.test.ts`
Expected: PASS. If it fails, each listed offender is a real miss from Tasks 1–3 — fix it there (token swap), never by widening the allowlist.

- [ ] **Step 3: Final acceptance sweeps**

```bash
rtk grep -rn --include="*.tsx" -E "#[0-9a-fA-F]{6}" "app/(embedded)"          # only market-intelligence/components.tsx BRAND_HERO
rtk grep -rn --include="*.tsx" -E "✓|✗|💰|⚠|✅|❌|🚀|📈|📉|⏳|🔥" "app/(embedded)"  # no matches
grep -rn --include="*.tsx" -B2 "onClick" "app/(embedded)" | grep -E "<(div|span|td|tr|li)[ >]"  # no clickable non-buttons
```

Expected: exactly as annotated. (`▲▼` are intentionally excluded from the emoji sweep — the surviving seo-pillar occurrences are reviewed data-cell glyphs with text channels, see Survey Results.)

- [ ] **Step 4: Browser a11y walk (best-effort)**

Use the `chrome-devtools-mcp:a11y-debugging` skill against a local `npm run dev` on the four core pages (Dashboard `/`, Campaigns, Recommendations, Ad Approvals): keyboard-walk every action, check contrast, and check dark-mode legibility. **The embedded app requires Shopify App Bridge auth — if pages don't render meaningfully outside the admin iframe, do not fight it**: record "browser walk blocked by embedded auth; static checks passed" and rely on Step 3's static sweeps + the Polaris-token guarantee (tokens are theme-aware by construction). One minimal attempt, then stop — no diagnostic cascades.

- [ ] **Step 5: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 742/742 (741 baseline + this task's new test), build clean.

- [ ] **Step 6: Commit**

```bash
git add __tests__/a11y/no-raw-hex.test.ts
git commit -m "test(a11y): enforce no-raw-hex policy in app/(embedded) with documented brand-hero allowlist"
```

---

### Task 6: GROW — record, push, surface deploy decision

**Files:**
- Modify: `.mex/ROUTER.md` (add Phase 9 entry to Current Project State; bump `last_updated`)
- Modify: `docs/superpowers/plans/2026-07-03-functionality-roadmap.md` (mark item 17 / Phase 9 done, noting the brand-hero exemption)

**Interfaces:** none.

- [ ] **Step 1: Update ROUTER.md** — add a Phase 9 bullet under "Working": scope actually executed (3 pages tokenized/icon-swapped, 3 scroll regions made focusable, MI hero formalized as the single disclosed hex exemption with the AA contrast bump, policy test added), and note the seo-pillar handlers were untouched per the standing rule.

- [ ] **Step 2: `mex log --type decision "Phase 9: MI brand hero kept as documented no-raw-hex exemption (allowlisted in policy test); muted text alpha raised to 0.75 for WCAG AA"`**

- [ ] **Step 3: Commit and push**

```bash
git add .mex/ROUTER.md docs/superpowers/plans/2026-07-03-functionality-roadmap.md
git commit -m "docs(mex): record Phase 9 a11y/theming sweep"
git push origin main
```

- [ ] **Step 4: Surface — do not execute — the final deploy.** Report to the operator: Phase 9 (the last roadmap item) is complete and pushed; the roadmap's final deploy is ready but withheld because the deploy script auto-applies migrations and the `DailySales` migration is under an explicit operator-go-ahead hold. Deploying is their call.

---

## Self-Review

1. **Spec coverage** — hex retrofit: named offenders `roasBarColor`/`ConfBar` (Task 1), dashboard offenders already done in 8b, sparklines done in 8b/8c, market-intelligence (Task 3 — survey found the only remaining hexes there are the brand hero, "bars" already clean). Emoji-as-icons: all 8 surviving sites covered (Tasks 1–3). Color-only second channel: ROAS bar/ConfBar both verified to already have text channels; Delta done in 8c. Focus/keyboard: no clickable divs exist; all 3 scrollable regions covered (Tasks 2, 4). Final sweep + a11y-debugging checker: Task 5. Acceptance grep: enforced permanently by the policy test. Final deploy: surfaced, deliberately not executed (migration hold). ✔
2. **Placeholder scan** — every code step shows exact code; no TBDs. ✔
3. **Type consistency** — no cross-task types introduced; icon/token names verified against installed packages during survey. ✔
4. **Known deviation from roadmap text** — acceptance says "grep clean except third-party requirements"; the MI brand hero is a first-party exemption instead. Pre-made decision, documented in Task 3, disclosed in ROUTER and the policy-test allowlist.
