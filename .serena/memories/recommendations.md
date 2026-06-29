---
name: recommendations
description: Recommendation lifecycle, guardrails, executor, and execution flow
metadata:
  type: project
---

# Recommendations

## Lifecycle

`Recommendation` DB model states: `pending → approved | rejected → executed | failed`

UI: Ad Pilot page shows pending recommendations. Approve/reject via `PUT /api/recommendations/[id]/approve` or `/reject`. Override via `/request-override`.

## Execution (`jobs/execute-approved.ts`)

Runs daily at 06:00 UTC via `/api/cron/execute-approved`.
- `EXECUTE_APPROVED_LIVE_ENABLED=true` → live execution; `false` → dry-run (logs only)
- Filters to `approved` recs with supported action types
- Runs guardrail checks per recommendation
- Calls `lib/executor.ts` to execute against Meta API

## Guardrails (`lib/guardrails.ts`)

Pre-execution safety checks:
- `CONVERSION_SENSITIVE_ACTIONS` — actions requiring minimum conversion threshold (NOT `pause_ad`)
- Conversion confidence check: requires 10+ conversions for sensitive actions
- `pause_ad` is explicitly exempt — can always execute regardless of conversion count
- `GuardrailConfig` DB table for per-action threshold overrides

## Executor (`lib/executor.ts`)

- Maps action type to Meta API call
- Unsupported action types are filtered before reaching executor (no silent failures)
- Logs result to `AuditLog` model
- Updates `Recommendation` status to `executed` or `failed`

## RawSnapshot

`RawSnapshot` model stores the raw API response per recommendation at fetch time. Used for guardrail input and audit trail.
