# Ad Approval Flow Specification (v2.0)

## Goals

- Design a robust, auditable Facebook Ad Approval workflow.
- Create a complete implementation specification that minimizes developer assumptions.
- Clearly define the workflow, responsibilities, system states, AI agents, permissions, notifications, and data model.
- Enable concurrent reviews without race conditions or data loss.
- Define exact behavior for revision workflows, AI orchestration, and edge cases.

---

# Design Principles

The Ad Approval workflow shall adhere to the following principles:

- Every submission must be fully auditable.
- No approval decision shall ever be lost.
- No submission data shall be overwritten (immutable revision history).
- Every review must be attributable to a specific reviewer or AI agent.
- AI assists the approval process but does not replace required human approvals.
- Human reviewer assignments are centrally managed through Settings.
- Every workflow transition shall be deterministic and traceable.
- Revision workflows must be explicit and unambiguous.
- All AI agent execution must be traceable, retryable, and resilient to failure.

---

# Overview

Build an **Ad Approval** workflow for Facebook ads within the custom plugin located at:

`\\wsl.localhost\Ubuntu\home\sean\Agriko\auto-pilot`

The feature shall appear under:

**Ad Pilot → Ad Approvals**

The submitter is automatically determined from the currently authenticated user.

---

# Workflow States

## State Diagram

```
                        ┌─────────────┐
                        │    Draft    │
                        └──────┬──────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
            ┌───────▼────────┐    ┌──────▼──────────┐
            │ For AI Pre-    │    │ (Deleted/       │
            │ Review         │    │  Cancelled)     │
            └────────┬───────┘    └─────────────────┘
                     │
            ┌────────▼──────────┐
            │ In AI Pre-Review  │
            │ (Async Job)       │
            └────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼────┐ ┌────▼──────┐ ┌──▼────────┐
   │Needs    │ │For Brand  │ │ Rejected  │
   │Revision │ │Review     │ │(Terminal) │
   └────┬────┘ └────┬──────┘ └───────────┘
        │           │
   ┌────▼───────────▼────────────────────┐
   │ In Brand Review (Async Job)         │
   └────────┬──────────────────────────┬─┘
            │                          │
        ┌───▼───┐        ┌────────────▼──┐
        │Needs  │        │For Conversion  │
        │Revision│      │Review          │
        └────┬──┘        └───────┬────────┘
             │                   │
        ┌────▼──────────────────▼──────────────┐
        │ In Conversion Review (Human Review) │
        └────────┬───────────────────────┬────┘
                 │                       │
             ┌───▼────┐          ┌──────▼──┐
             │Needs   │          │For      │
             │Revision│          │Technical│
             └────┬───┘          │Review   │
                  │              └──┬──────┘
                  │                 │
             ┌────▼──────────────────▼──────────────┐
             │ In Technical Review (Async Job)     │
             └────────┬──────────────────────┬─────┘
                      │                      │
                  ┌───▼────┐          ┌─────▼──────────┐
                  │Needs   │          │With Penultimate│
                  │Revision│          │Approver        │
                  └────┬───┘          └────┬───────────┘
                       │                   │
                  ┌────▼───────────────────▼──────────────────┐
                  │ With Penultimate Approver (Human Review) │
                  └──────────┬──────────────────────┬────────┘
                             │                      │
                         ┌───▼────┐          ┌─────▼──────┐
                         │Needs   │          │With Final   │
                         │Revision│          │Approver     │
                         └────┬───┘          └─────┬───────┘
                              │                    │
                         ┌────▼───────────────────▼──────────────┐
                         │ With Final Approver (Human Review)   │
                         └──────────┬──────────────────┬────────┘
                                    │                  │
                                ┌───▼───────┐     ┌───▼──────────┐
                                │Approved to │     │ Needs        │
                                │Make Kwarta │     │ Revision     │
                                │(Terminal)  │     └────┬─────────┘
                                └────────────┘          │
                                                    ┌───▼────────────────┐
                                                    │ (Reset to Draft)   │
                                                    └────────────────────┘
```

## State Definitions

### Active States (Workflow in Progress)

| State | Type | Purpose | Trigger |
|-------|------|---------|---------|
| **Draft** | Initial | Ad awaiting first submission | New ad created |
| **For AI Pre-Review** | Queue | Waiting for AI Pre-Review job to execute | User clicks "Submit for Review" |
| **In AI Pre-Review** | Processing | AI Pre-Review job is executing | System transitions from "For AI Pre-Review" |
| **For Brand Review** | Queue | Waiting for AI Brand Review job to execute | AI Pre-Review passes |
| **In Brand Review** | Processing | AI Brand Review job is executing | System transitions from "For Brand Review" |
| **For Conversion Review** | Queue | Waiting for human Conversion Reviewer | AI Brand Review passes |
| **In Conversion Review** | Awaiting Human | Assigned Conversion Reviewer is actively reviewing | Conversion Reviewer opens record |
| **For Technical Review** | Queue | Waiting for AI Technical Review job to execute | Conversion Review passes |
| **In Technical Review** | Processing | AI Technical Review job is executing | System transitions from "For Technical Review" |
| **With Penultimate Approver** | Awaiting Human | Penultimate Approver is actively reviewing | Technical Review passes |
| **With Final Approver** | Awaiting Human | Final Approver is actively reviewing | Penultimate Approver passes |
| **Approved to Make Kwarta** | Terminal Complete | Ad approved and ready for campaign creation | Final Approver passes |

### Terminal States (Workflow Ended)

| State | Trigger | Behavior |
|-------|---------|----------|
| **Needs Revision** | Any review stage | Workflow pauses; submitter must revise and resubmit (see Revision Workflow section) |
| **Rejected** | Any review stage | Workflow terminates; ad cannot proceed; submitter can create new ad |
| **Cancelled** | Submitter or admin | Workflow terminates; audit log records cancellation reason |

---

# State Transition Rules

| Current Status | Allowed Next Statuses | Rules |
|---|---|---|
| **Draft** | For AI Pre-Review | Only submitter can trigger; requires all required fields complete |
| | Cancelled | Submitter can cancel anytime |
| **For AI Pre-Review** | In AI Pre-Review | System transitions automatically; async job enqueued |
| | Cancelled | Submitter can cancel while waiting |
| **In AI Pre-Review** | For Brand Review | AI job completes with pass decision |
| | Needs Revision | AI job completes with revision decision; comments required |
| | Rejected | AI job completes with rejection decision; reason required |
| **For Brand Review** | In Brand Review | System transitions automatically; async job enqueued |
| | Needs Revision | Manual override by admin only; must justify in audit log |
| | Rejected | Manual override by admin only; must justify in audit log |
| **In Brand Review** | For Conversion Review | AI job completes with pass decision |
| | Needs Revision | AI job completes with revision decision; comments required |
| | Rejected | AI job completes with rejection decision; reason required |
| **For Conversion Review** | In Conversion Review | System assigns to Conversion Reviewer; timestamp recorded; Conversion Reviewer role must be assigned (see Role Requirement Enforcement section) |
| **In Conversion Review** | For Technical Review | Assigned human reviewer completes review with pass decision |
| | Needs Revision | Assigned human reviewer completes review; comments required |
| | Rejected | Assigned human reviewer completes review; reason required |
| **For Technical Review** | In Technical Review | System transitions automatically; async job enqueued |
| | Needs Revision | Manual override by admin only; must justify in audit log |
| | Rejected | Manual override by admin only; must justify in audit log |
| **In Technical Review** | With Penultimate Approver (or With Final Approver if conflict) | AI job completes with pass decision; system checks for conflict of interest (see Conflict-of-Interest Detection section). If submitter == Penultimate Approver: escalate to With Final Approver instead. If submitter == Final Approver: blocked and flagged for manual intervention (this transition runs in a worker, so it returns a blocked job result rather than an HTTP code). |
| | Needs Revision | AI job completes with revision decision; comments required |
| | Rejected | AI job completes with rejection decision; reason required |
| **With Penultimate Approver** | With Final Approver (or error if conflict) | Penultimate Approver approves; system checks for conflict of interest (see Conflict-of-Interest Detection section). If submitter == Final Approver: HTTP 409 Conflict; manual intervention required. |
| | Needs Revision | Penultimate Approver rejects with revision; comments required |
| | Rejected | Penultimate Approver rejects; reason required |
| **With Final Approver** | Approved to Make Kwarta | Final Approver approves |
| | Needs Revision | Final Approver requests revision; comments required |
| | Rejected | Final Approver rejects; reason required |
| **Needs Revision** | Draft | Submitter begins revision; new revision number incremented |
| **Rejected** | (None) | Terminal state; no transitions allowed |
| **Cancelled** | (None) | Terminal state; no transitions allowed |

---

# Revision Workflow (Critical)

## How Revisions Work

When status transitions to **"Needs Revision"** at any stage:

1. **Approval record remains open** with status = `Needs Revision`
2. **Revision counter increments** (Revision 1 → Revision 2, etc.)
3. **Submitter receives notification** with reviewer comments and required changes
4. **Submitter transitions approval back to Draft** and modifies the ad copy/creative
5. **Submitter re-submits** (same approval record, new revision)
6. **Workflow restarts at initial stage** (For AI Pre-Review)

## Revision Data Model

Each revision creates a new `AdRevision` record linked to the parent `Approval`:

```
Approval
  ├─ id: UUID
  ├─ current_revision: 1
  ├─ status: "Needs Revision"
  │
  └─ Revisions (one-to-many)
      ├─ Revision 1
      │   ├─ copy: { primary_text, headline, description, cta, ... }
      │   ├─ creative: { image_url, video_url, ... }
      │   ├─ submitted_at: timestamp
      │   ├─ reviews: [AI Pre-Review Report]
      │
      └─ Revision 2 (after revision)
          ├─ copy: { updated primary_text, ... }
          ├─ creative: { updated image_url, ... }
          ├─ submitted_at: timestamp
          ├─ reviews: [] (empty, restarted workflow)
```

## Key Rules

- **Old reviews do NOT carry forward** when resubmitting after "Needs Revision"
- **All revision data is immutable** — once stored, cannot be edited or deleted
- **Revision history is fully visible** in the audit log and revision panel
- **Approval record never closes** until final state (Approved, Rejected, or Cancelled)
- **Multiple revisions allowed** — no limit on revision count
- **Submitter can only modify Draft ads** — in-progress workflows are read-only to non-reviewers

---

# AI Agent Orchestration

## AI Job Execution Model

All AI review stages (Pre-Review, Brand Review, Technical Review) execute as **asynchronous background jobs** with the following guarantees:

### Job Lifecycle

1. **Enqueue** — When status transitions to `For X Review`, system enqueues async job
2. **Acquire Lock** — Job acquires advisory lock on Approval record to prevent concurrent modifications
3. **Execute** — Job runs AI agent with timeout of **90 seconds**
4. **Report** — Job generates AI Report and stores in database
5. **Transition** — Job transitions status to next state or terminal state
6. **Release Lock** — Job releases lock and completes

### Timeout & Retry Strategy

| Scenario | Action | Retry Limit |
|----------|--------|-------------|
| Job timeout (>90s) | Job fails; status remains `For X Review`; queued for retry | 3 retries, exponential backoff (1m, 5m, 15m) |
| Job crash | Error logged; status remains `For X Review`; queued for retry | 3 retries, exponential backoff |
| AI API unavailable | Job fails gracefully; retried as above | 3 retries |
| Job completes normally | Status transitions; report stored | N/A |

### Failure Handling

- **If all retries exhausted:** Admin notification sent; approval record flagged `REQUIRES_MANUAL_INTERVENTION`; no auto-transition
- **Manual override:** Admin can force transition after investigation
- **Audit trail:** All retry attempts logged with timestamps and error messages

### Concurrency Safety

- **Advisory locks** prevent simultaneous modifications to same approval
- **Optimistic locking** on Approval record (version number) to detect stale writes
- **No mid-review edits** — submitter cannot modify ad while in active review stage

---

# AI Agents

## AI Pre-Review Agent

**Purpose:** Validate copy quality, grammar, readability, and Facebook policy compliance.

**Execution:** Async job; max 90 seconds

**Inputs:**
- Primary Text
- Headline
- Description
- CTA
- Start Date
- End Date

**Validation Checks:**

| Check | Type | Confidence Threshold | Notes |
|-------|------|----------------------|-------|
| Grammar | Automated | ≥90% | Spelling, grammar, sentence structure |
| Readability | Automated | ≥85% | Flesch-Kincaid grade level target: 6-8 |
| CTA Clarity | Automated | ≥80% | CTA text must be present, clear, actionable |
| Prohibited Wording | Pattern Match | 100% | Check against Facebook banned word list (e.g., "miracle cure", "guaranteed", "secret") |
| Health Claims | LLM-based | ≥85% | Detect unsubstantiated health/medical claims |
| Before/After Imagery | Vision + metadata | ≥80% | Detect before/after imagery in creative (prohibited for health products) |
| Personal Attributes | LLM-based | ≥75% | Detect targeting by protected attributes (age, gender, ethnicity, religion) |
| Misleading Claims | LLM-based | ≥85% | Detect false, exaggerated, or unsupported product claims |

**Pass Threshold:** All checks ≥ confidence threshold AND no detected prohibited wording

**Output:**
- Overall Result: `PASS` | `NEEDS_REVISION` | `REJECTED`
- Executive Summary: 1-2 sentences
- Validation Checks Performed: List all checks with results
- Warnings: List any low-confidence findings (60-80% confidence)
- Errors: List failures and reasons
- Recommendations: Specific fixes for revision
- Confidence Score: Overall (0-100%)
- Generated Timestamp: ISO 8601

**Decision Logic:**
- **PASS:** All checks pass
- **NEEDS_REVISION:** 1-2 checks fail but issues are fixable (grammar, wording, claim clarity)
- **REJECTED:** 3+ checks fail, or prohibited wording detected, or health claims unsupported

---

## AI Brand Review Agent

**Purpose:** Validate logo, colors, fonts, tone, USP, product naming, URL, and contact consistency.

**Execution:** Async job; max 90 seconds

**Inputs:**
- Logo image/file
- Primary Text
- Headline
- Description
- CTA
- Website URL
- Contact information
- Creative (image/video)

**Validation Checks:**

| Check | Type | Confidence Threshold | Notes |
|-------|------|----------------------|-------|
| Logo Presence | Vision | ≥95% | Logo must be visible in creative |
| Logo Quality | Vision | ≥80% | Logo must be clear, not blurry, appropriate size |
| Logo Placement | Vision | ≥85% | Logo placement consistent with brand guidelines |
| Brand Colors | Vision | ≥80% | Color palette matches brand (compare image to reference colors) |
| Font Consistency | Vision | ≥75% | Fonts used match brand guidelines or are professional |
| Tone of Voice | LLM-based | ≥80% | Copy tone matches brand voice (e.g., professional, casual, friendly) |
| USP Clarity | LLM-based | ≥80% | Unique selling proposition is clear and differentiated |
| Product Naming | LLM-based | ≥85% | Product names are correct, consistent, not misspelled |
| Website URL Valid | URL Check | 100% | URL is accessible, not 404, not redirected to third-party |
| Contact Info Accuracy | Regex + manual | ≥90% | Email format valid, phone number format valid, address present |

**Pass Threshold:** All checks ≥ confidence threshold

**Output:** Standard Report Schema (see AI Review Reports section)

**Decision Logic:**
- **PASS:** All checks pass
- **NEEDS_REVISION:** 1-2 checks fail but fixable (font choice, color adjustment, URL, contact info)
- **REJECTED:** 3+ checks fail, or logo missing, or USP unclear, or contact info invalid

---

## Technical Review AI Agent

**Purpose:** Validate Facebook pixel setup, UTM parameters, URL validity, mobile compatibility, page speed, event tracking, and campaign naming.

**Execution:** Async job; max 120 seconds (allows for network requests to destination URL)

**Inputs:**
- Destination URL
- Campaign Name
- UTM Parameters (source, medium, campaign, content, term)
- Facebook Pixel ID
- Event tracking configuration

**Validation Checks:**

| Check | Type | Confidence Threshold | Notes |
|-------|------|----------------------|-------|
| URL Accessible | HTTP Request | 100% | Destination URL must return 200-299 status code |
| URL Mobile Compatible | Puppeteer | ≥90% | URL renders correctly on mobile (viewport 375x667) |
| Page Load Speed | Puppeteer Lighthouse | ≥80% | Largest Contentful Paint <3 seconds; ignore if external hosting issue |
| Facebook Pixel Present | Script detection | ≥95% | Facebook pixel tracking code must be installed on destination URL |
| Event Tracking Config Valid | JSON Schema | 100% | Event tracking must follow Facebook conversion API schema |
| UTM Parameters Valid | Regex + logic | 100% | All UTM params present, properly formatted, no spaces |
| Campaign Naming Convention | Regex | ≥90% | Campaign name follows naming convention (e.g., `[Date]-[Product]-[Audience]`) |
| No Redirect Loops | HTTP tracer | 100% | URL must not contain redirect loops (max 5 redirects) |
| Destination Domain Trust | Domain reputation | ≥75% | Destination domain not flagged as spam/phishing (check against blocklists) |

**Pass Threshold:** All checks ≥ confidence threshold AND URL accessible AND pixel present

**Output:** Standard Report Schema

**Decision Logic:**
- **PASS:** All checks pass, URL accessible, pixel installed
- **NEEDS_REVISION:** 1-2 checks fail but fixable (UTM format, campaign naming, URL redirect chain)
- **REJECTED:** URL unreachable, pixel missing, multiple check failures (≥3), or suspicious domain

---

# Reviewer Assignment

## Assignment Strategy

All human reviewers are assigned through **Settings → Approval Configuration**.

### Required Roles

| Role | Responsibilities | Escalation Path | Backup | SLA |
|------|---|---|---|---|
| **Conversion Reviewer** | Review ad copy, creative, offer clarity, landing page consistency. Score 1–5 on 6 questions (min 24/30 AND no question below 3 to pass). | If unavailable >4 hours, escalate to Penultimate Approver | Admin-assigned backup email on file | 4 hours |
| **Penultimate Approver** | Strategic review; ensure brand alignment, competitive positioning, campaign strategy. Approve or request revision. | If unavailable >8 hours, escalate to Final Approver | Admin-assigned backup email on file | 8 hours |
| **Final Approver** | Final gatekeeping; approve only ads meeting all criteria. May reject at this stage if issues detected. | If unavailable >24 hours, admin intervention required | (None; critical role) | 24 hours |

### Assignment Rules

- **One user per role** — No round-robin, team assignment, or per-submission manual assignment
- **No self-approval** — Submitter cannot be assigned as reviewer
- **Conflict of interest prevention** — Submitter cannot be Conversion Reviewer, Penultimate Approver, or Final Approver in their own approval chain (see Conflict-of-Interest Detection section)
- **Role overlap allowed** — One user may hold multiple roles (but not in same approval chain)
- **Role requirement enforcement** — All three roles MUST be assigned at all times; Settings blocks unassignment and returns error if attempted

### Unavailability & Escalation

If assigned reviewer is unavailable (per escalation path above):

1. **Send escalation notification** to next level with approval record
2. **Log escalation** in audit trail with reason and timestamp
3. **Auto-assign backup** if configured; otherwise require manual assignment
4. **SLA tracking:** Log time spent in escalation state

---

## SLA Escalation Background Job

### Job Specification

**Name:** `ApprovalSLAEscalationWorker`  
**Frequency:** Every 5 minutes  
**Runtime:** <30 seconds  
**Failure handling:** Log error; retry on next cycle (no manual intervention needed)

### Job Logic

```
RUN EVERY 5 MINUTES:

1. Query database:
   SELECT * FROM Approval
   WHERE current_status IN ('In Conversion Review', 'With Penultimate Approver', 'With Final Approver')
   AND updated_at < NOW() - INTERVAL

2. For each approval:
   
   A. IF current_status = 'In Conversion Review':
      - Check: (NOW() - updated_at) > 4 hours?
      - If YES:
        * Check: backup_user_id configured?
        * If YES:
          - Auto-assign backup: assigned_conversion_reviewer_id = backup_user_id
          - Create notification: "Escalated to backup Conversion Reviewer"
          - Log audit: action=ESCALATED, reason="Primary reviewer unavailable >4h", new_reviewer=backup_user_id
          - Send email to backup: "[Campaign] escalated to you (primary unavailable)"
        * If NO:
          - Flag approval: flags.requires_manual_intervention = true, reason="Conversion Reviewer SLA breach"
          - Create notification to ADMIN: "Escalation required: [Campaign] needs Conversion Reviewer assignment"
          - Log audit: action=ESCALATION_REQUIRED, reason="Primary unavailable >4h, no backup assigned"
   
   B. IF current_status = 'With Penultimate Approver':
      - Check: (NOW() - updated_at) > 8 hours?
      - If YES:
        * Check: backup_user_id configured for Penultimate Approver role?
        * If YES:
          - Auto-assign backup: assigned_penultimate_approver_id = backup_user_id
          - Create notification: "Escalated to backup Penultimate Approver"
          - Log audit: action=ESCALATED, reason="Penultimate Approver unavailable >8h", new_reviewer=backup_user_id
          - Send email to backup: "[Campaign] escalated to you (primary unavailable)"
        * If NO:
          - Escalate to Final Approver:
            - Status → 'With Final Approver'
            - assigned_penultimate_approver_id → NULL
            - assigned_final_approver_id → configured Final Approver
            - Create notification to Final Approver: "[Campaign] escalated from Penultimate (primary unavailable)"
            - Log audit: action=ESCALATED, reason="Penultimate Approver SLA breach, escalated to Final", skipped_stage=PENULTIMATE
            - SKIP Penultimate Approver step entirely
   
   C. IF current_status = 'With Final Approver':
      - Check: (NOW() - updated_at) > 24 hours?
      - If YES:
        * Flag approval: flags.requires_manual_intervention = true, reason="Final Approver SLA breach >24h"
        * Create critical notification to ADMIN: "🚨 CRITICAL: [Campaign] stuck with Final Approver for >24h. Manual intervention required."
        * Log audit: action=SLA_BREACH, reason="Final Approver unavailable >24h, no auto-escalation possible", severity=CRITICAL
        * (Do NOT auto-skip Final Approver; it is the final stage)

3. End job
```

### Error Handling

| Scenario | Action |
|----------|--------|
| Database query fails | Log error; retry on next cycle; send error to monitoring system |
| Notification send fails | Log error; retry on next notification cycle; do not block escalation |
| Multiple simultaneous escal ations for same approval | Acquire lock before modifying approval; use optimistic locking to detect conflicts |

### Monitoring & Alerting

- **Job latency:** Alert if >30 seconds
- **Job failure:** Alert if 3 consecutive failures
- **Escalations triggered:** Track count per day (metric: `approval_sla_escalations_total`)
- **Manual interventions:** Track count per role (metric: `approval_manual_interventions_required`)

---

## Conflict-of-Interest Detection

### Detection Strategy

Conflict of interest is detected at **state transition time** (not at approval creation), ensuring submitter can never approve their own ad.

### Conflict Detection Rules

| Current Status | Transition To | Conflict Check | Resolution |
|---|---|---|---|
| **In Technical Review** | **For Penultimate Approver** | If `submitter_id == assigned_penultimate_approver_id`: Conflict detected | **Escalate to Final Approver:** Transition to `With Final Approver` instead; skip Penultimate Approver stage; assign Final Approver; log escalation; notify Final Approver |
| **With Penultimate Approver** | **With Final Approver** | If `submitter_id == assigned_final_approver_id`: Conflict detected | **Return HTTP 409 Conflict:** "Submitter cannot be Final Approver for own ad. Escalation path exhausted. Admin intervention required." Flag approval for manual intervention; notify admin |
| **Any stage** | **In Conversion Review** | If `submitter_id == assigned_conversion_reviewer_id`: Conflict detected | **Prevent assignment:** When Technical Review passes, check if submitter == Conversion Reviewer role holder. If yes, trigger admin escalation flow (require manual override). Do not auto-transition to Conversion Review. |

### Implementation Details

> **Note on the pseudocode below:** It is illustrative of the required *behavior and decision logic*, not a literal API contract. Exact error codes, ORM/database calls, and framework conventions are at the implementing developer's discretion, provided the observable behavior (state changes, audit entries, notifications, and who can/cannot proceed) matches. One distinction matters and is reflected below: the **Technical Review → Penultimate Approver** transition is triggered by the AI Technical Review *background worker* (no HTTP caller), so it returns a job result and flags on failure. The **Penultimate → Final Approver** transition is triggered by a *user action* (the approver clicking Approve), so it returns HTTP status codes.

#### Transition A — In Technical Review → For Penultimate Approver (runs in background worker)

Triggered when the AI Technical Review job completes with a pass. There is no HTTP request in scope; the function returns a job result and, on any blocking condition, flags the approval and defers to admin rather than "erroring" to a caller that isn't there.

```javascript
// Called by the AI Technical Review worker on pass. Returns a JobResult, not an HTTP response.
function transitionToForPenultimateApprover(approval) {
  const penultimateApproverId = settings.penultimate_approver_id;

  // Role missing is a configuration error, not a request error. Flag and stop; do not transition.
  if (!penultimateApproverId) {
    flagApprovalForManualIntervention(approval, 'Penultimate Approver role unassigned');
    return JobResult.blocked('CONFIG_ERROR: Penultimate Approver unassigned');
  }

  // CONFLICT CHECK: submitter is the Penultimate Approver -> escalate past this stage to Final.
  if (approval.submitter_id === penultimateApproverId) {
    const finalApproverId = settings.final_approver_id;

    if (!finalApproverId) {
      flagApprovalForManualIntervention(approval, 'Conflict: submitter is Penultimate Approver, and Final Approver is unassigned');
      return JobResult.blocked('CONFIG_ERROR: escalation target (Final Approver) unassigned');
    }

    approval.current_status = 'With Final Approver';
    approval.assigned_penultimate_approver_id = null;
    approval.assigned_final_approver_id = finalApproverId;
    approval.updated_at = NOW();

    auditLog.create({
      approval_id: approval.id,
      action: 'CONFLICT_ESCALATED',
      previous_status: 'In Technical Review',
      new_status: 'With Final Approver',
      comment: 'Submitter is Penultimate Approver; escalated to Final Approver',
      details: { skipped_stage: 'PENULTIMATE_APPROVER' }
    });

    notificationService.send({
      recipient_id: finalApproverId,
      message: `[${approval.campaign_id}] escalated to you from Penultimate Approver (conflict of interest). Please review.`,
      approval_id: approval.id
    });

    return JobResult.ok({ escalated: true, skipped_stage: 'PENULTIMATE_APPROVER' });
  }

  // No conflict; proceed normally.
  approval.current_status = 'For Penultimate Approver';
  approval.assigned_penultimate_approver_id = penultimateApproverId;
  approval.updated_at = NOW();

  auditLog.create({
    approval_id: approval.id,
    action: 'STATUS_CHANGED',
    previous_status: 'In Technical Review',
    new_status: 'For Penultimate Approver'
  });

  return JobResult.ok();
}
```

#### Transition B — With Penultimate Approver → With Final Approver (runs in HTTP handler)

Triggered by a user action: the Penultimate Approver clicks Approve. HTTP status codes apply here. A missing Final Approver role is a server-side configuration fault, so it returns 503 (service not configured), not 500; the conflict case is a 409 (the request conflicts with the current assignment state) rather than a generic 400.

```javascript
// Called by the "Penultimate Approver approves" request handler. Returns an HTTP response.
function transitionToWithFinalApprover(approval) {
  const finalApproverId = settings.final_approver_id;

  if (!finalApproverId) {
    flagApprovalForManualIntervention(approval, 'Final Approver role unassigned');
    return HTTP 503 {
      error: 'Final Approver role is not configured. Approval cannot proceed until an admin assigns it.',
      approval_id: approval.id,
      requires_manual_intervention: true
    };
  }

  // CONFLICT CHECK
  if (approval.submitter_id === finalApproverId) {
    // Escalation path exhausted; submitter is both Penultimate AND Final Approver
    flagApprovalForManualIntervention(
      approval, 
      'Conflict of interest: submitter is both Penultimate and Final Approver. No escalation path available.'
    );
    
    auditLog.create({
      approval_id: approval.id,
      action: 'CONFLICT_UNRESOLVABLE',
      previous_status: 'With Penultimate Approver',
      new_status: null,
      comment: 'Submitter is Final Approver; cannot proceed. Admin must reassign or approve manually.'
    });
    
    notificationService.send({
      recipient_id: 'ADMIN',
      message: `🚨 CRITICAL: [${approval.campaign_id}] by ${approval.submitter_id} has unresolvable conflict of interest. Submitter is both Penultimate and Final Approver. Manual intervention required.`,
      severity: 'CRITICAL'
    });
    
    return HTTP 409 {
      error: 'Submitter cannot be Final Approver for own ad. Escalation path exhausted. Admin intervention required.',
      approval_id: approval.id,
      requires_manual_intervention: true
    };
  }
  
  // No conflict; proceed normally
  approval.current_status = 'With Final Approver';
  approval.assigned_final_approver_id = finalApproverId;
  approval.updated_at = NOW();
  
  auditLog.create({
    approval_id: approval.id,
    action: 'STATUS_CHANGED',
    previous_status: 'With Penultimate Approver',
    new_status: 'With Final Approver'
  });
  
  return HTTP 200;
}
```

### Audit Trail for Conflicts

Every conflict detection and escalation is logged:

```
AuditLog entry:
  action: 'CONFLICT_ESCALATED' | 'CONFLICT_UNRESOLVABLE'
  comment: Specific conflict reason
  details: {
    skipped_stage: 'PENULTIMATE_APPROVER' (if applicable),
    escalated_to: 'FINAL_APPROVER' | 'ADMIN',
    original_assignee: uuid,
    submitter_id: uuid
  }
```

---

## Role Requirement Enforcement

### Setting Constraints

The `ReviewerAssignment` table enforces that all three roles are ALWAYS assigned:

```sql
CREATE TABLE ReviewerAssignment (
  id UUID PRIMARY KEY,
  role ENUM('CONVERSION_REVIEWER', 'PENULTIMATE_APPROVER', 'FINAL_APPROVER') UNIQUE NOT NULL,
  assigned_user_id UUID NOT NULL REFERENCES User(id) ON DELETE RESTRICT,
  backup_user_id UUID REFERENCES User(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES User(id),
  
  -- CONSTRAINT: All three roles must have assigned_user_id
  CHECK (assigned_user_id IS NOT NULL)
);

-- Ensure exactly 3 rows exist (one per role)
CREATE TRIGGER enforce_three_roles
BEFORE DELETE ON ReviewerAssignment
FOR EACH ROW
BEGIN
  IF (SELECT COUNT(*) FROM ReviewerAssignment) = 1 THEN
    RAISE EXCEPTION 'Cannot delete last reviewer assignment. At least one role must be assigned.';
  END IF;
END;
```

### Settings API Behavior

#### When Admin Tries to Unassign a Role

```
PUT /settings/reviewer-assignments/CONVERSION_REVIEWER
Body: { "assigned_user_id": null }

Response: HTTP 400 {
  "error": "Cannot unassign role. All reviewer roles must be assigned at all times.",
  "current_assignment": {
    "role": "CONVERSION_REVIEWER",
    "assigned_user_id": "uuid-123",
    "assigned_user_email": "alice@agriko.ph"
  },
  "hint": "Use 'Reassign' endpoint to change assignment: PUT /settings/reviewer-assignments/CONVERSION_REVIEWER/reassign"
}
```

#### When Admin Reassigns a Role

```
PUT /settings/reviewer-assignments/CONVERSION_REVIEWER/reassign
Body: { "assigned_user_id": "uuid-456", "backup_user_id": "uuid-789" }

Response: HTTP 200 {
  "role": "CONVERSION_REVIEWER",
  "previous_user": "alice@agriko.ph",
  "new_user": "bob@agriko.ph",
  "backup_user": "charlie@agriko.ph",
  "effective_immediately": true,
  "in_progress_approvals": [
    { "approval_id": "xyz", "stage": "In Conversion Review", "assigned_since": "2h 30m" }
  ],
  "note": "Reassignment is effective immediately. Approvals in-progress stay with previous reviewer; future approvals use new assignment."
}
```

### Startup Validation

On application startup, system validates:

```javascript
async function validateReviewerAssignments() {
  const roles = ['CONVERSION_REVIEWER', 'PENULTIMATE_APPROVER', 'FINAL_APPROVER'];
  
  for (const role of roles) {
    const assignment = await ReviewerAssignment.findOne({ role });
    
    if (!assignment || !assignment.assigned_user_id) {
      const error = `CRITICAL: ${role} is not assigned. Application cannot start.`;
      logger.error(error);
      process.exit(1);
    }
    
    logger.info(`✓ ${role}: ${assignment.assigned_user_id}`);
  }
  
  logger.info('✓ All reviewer roles assigned. Application starting.');
}
```

If validation fails on startup:
1. Application **does not start** (hard fail)
2. Admin receives critical alert: "Application cannot start: [Role] not assigned in Settings"
3. Admin must visit Settings, assign role, and restart application

### Behavior If Role Becomes Unassigned Mid-Operation

(This should not happen due to constraints, but if it does via database corruption):

```
Job: TransitionApprovalState (In Technical Review → For Penultimate Approver)

1. Fetch settings: penultimate_approver_id = NULL (unexpected!)
2. Check: if (!penultimateApproverId) ...
3. Action:
   - Flag approval: requires_manual_intervention = true
   - Reason: "Penultimate Approver role became unassigned"
   - Audit log: action=CONFIGURATION_ERROR, severity=CRITICAL
   - Notification to ADMIN: "🚨 CRITICAL: Penultimate Approver role is unassigned. Cannot proceed with approvals. Please assign immediately."
   - Email alert to ops team
4. Status remains: 'In Technical Review' (no transition)
5. Developer must investigate database corruption
```

---

# Conversion Review Scoring Rubric

## Conversion Reviewer Tasks

Conversion Reviewer manually scores 6 criteria on 1–5 Likert scale.

**Pass requires BOTH:**
- **Total score ≥ 24 / 30** (80%), AND
- **No individual question scored below 3**

The aggregate bar (80%) ensures most dimensions are genuinely strong while tolerating one soft spot. The per-question floor prevents an ad from passing on aggregate while hiding a single catastrophic weakness — e.g. a landing page scored 1 for consistency should never be masked by strong creative scores. If either condition fails, the outcome is Needs Revision.

### Scoring Rubric

#### Question 1: "Would I stop scrolling?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Definitely | Creative immediately grabs attention; strong visual or emotional hook; unique/memorable |
| **4** | Probably | Creative is attractive and relevant; would capture most viewers |
| **3** | Maybe | Creative is adequate; not memorable but not boring; middle of the road |
| **2** | Unlikely | Creative is generic or less relevant; requires strong copy to overcome visual weakness |
| **1** | No Way | Creative is boring, unclear, or off-brand; fails to engage immediately |

#### Question 2: "Is the offer obvious within 3 seconds?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Absolutely | Offer is the hero of the ad; immediate, clear, compelling value proposition |
| **4** | Yes | Offer is clear and prominent; takes 2-3 seconds to understand |
| **3** | Sort of | Offer is present but not prominent; must read full ad to understand |
| **2** | Barely | Offer is buried or unclear; requires inference |
| **1** | No | No discernible offer; ad is confusing about what's being sold |

#### Question 3: "Is the CTA clear and compelling?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Absolutely | CTA is explicit, action-oriented, urgent, and enticing (e.g., "Shop Now", "Claim 20% Off") |
| **4** | Yes | CTA is clear and specific; invites action |
| **3** | Somewhat | CTA is present but generic or weak (e.g., "Learn More") |
| **2** | Weak | CTA is vague or buried in copy |
| **1** | Missing | No clear CTA or call to action |

#### Question 4: "Does creative support the copy?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Perfectly | Creative and copy are aligned; visual reinforces message; cohesive narrative |
| **4** | Well | Creative supports copy; minor misalignment acceptable |
| **3** | Okay | Creative and copy are related but not strongly reinforcing each other |
| **2** | Weakly | Creative and copy feel disconnected or contradictory |
| **1** | No | Creative and copy are misaligned or contradict each other |

#### Question 5: "Is the landing page consistent with the ad?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Perfect Match | Landing page hero, offer, colors, messaging match ad exactly; seamless experience |
| **4** | Very Consistent | Minor differences acceptable; main message/offer consistent |
| **3** | Somewhat Consistent | Core offer is the same; visual/messaging differences exist |
| **2** | Loosely Consistent | Landing page feels like a different product/offer; confusing transition |
| **1** | Mismatch | Landing page contradicts ad; user confusion likely; high bounce risk |

#### Question 6: "Does the ad have a strong opening?"

| Score | Behavior | Description |
|-------|----------|---|
| **5** | Compelling | Opening line immediately resonates; addresses pain point, curiosity, or desire |
| **4** | Strong | Opening is engaging and relevant; hooks viewer early |
| **3** | Adequate | Opening is okay; not particularly strong or weak |
| **2** | Weak | Opening is generic or delayed engagement |
| **1** | Poor | Opening is confusing, off-topic, or fails to engage |

### Scoring Process

1. **Reviewer opens In Conversion Review approval**
2. **Reviews ad copy and creative**
3. **Clicks each question and selects score (1–5)**
4. **Optional: adds comments** for any score <4
5. **Clicks "Submit Review"**
6. **System calculates total score** (sum of 6 scores) **and checks the lowest individual score**
7. **System evaluates both pass conditions:**
   - **PASS** (both true): total ≥ 24 AND no question below 3 → Status → `For Technical Review`; notification sent
   - **NEEDS REVISION** (either fails): total < 24, OR any question scored 1 or 2 → Status → `Needs Revision`; comments required; reviewer must provide specific feedback on the low-scoring question(s)

### Reviewer Guidance

- **Score based on Facebook audience behavior**, not personal taste
- **Consider mobile-first viewing** (most users scroll on mobile)
- **Be constructive** — if score is low, provide actionable feedback
- **No minimum comments required** for passing scores; comments optional

---

# Dashboard

## My Dashboard

The dashboard displays a personalized view of the approval workflow.

### Sections

#### My Drafts
Ads created by the current user that are still in Draft state.

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Created | Date | When ad was created |
| Revision | Badge | Current revision number |
| Actions | Buttons | Submit, Edit, Delete, Preview |

#### Awaiting My Review
Ads currently assigned to current user for review (status = `In Conversion Review`, `With Penultimate Approver`, or `With Final Approver`).

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Submitter | Text | User who submitted ad |
| Stage | Badge | Current review stage |
| Assigned Since | Date/time | When assigned to me |
| Actions | Buttons | Review, Preview, Comment |

#### Needs My Revision
Ads submitted by current user that received "Needs Revision" feedback.

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Stage | Badge | Stage where revision was requested |
| Reviewer | Text | Who requested revision |
| Feedback | Text | Summary of revision feedback |
| Revision | Badge | Next revision number (auto-increment) |
| Actions | Buttons | Edit Draft, View Feedback, Resubmit |

#### Approved
Ads approved by current user (if user is Penultimate or Final Approver).

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Submitter | Text | User who submitted |
| Approved | Date | Approval date |
| Total Revisions | Number | How many revisions before approval |
| Actions | Buttons | View, Archive |

#### Rejected
Ads rejected at any stage.

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Submitter | Text | Submitter email |
| Rejected By | Text | Reviewer/AI agent name |
| Reason | Text | Rejection reason |
| Actions | Buttons | View, Delete |

#### Recent Activity
Timeline of all actions (submissions, reviews, approvals, rejections) across all ads in the system.

| Column | Type | Notes |
|--------|------|-------|
| Campaign | Text | Ad campaign name |
| Action | Badge | Submitted, Approved, Rejected, Needs Revision, etc. |
| By | Text | User or "AI [Agent Name]" |
| Time | Date/time | When action occurred |
| Actions | Buttons | View |

### Filtering & Sorting

- **Filter by:** Stage, Submitter, Reviewer, Date Range, Status
- **Sort by:** Last Updated, Created, Stage, Submitter
- **Search:** Campaign name, submitter email

### Permissions

- Users see only their own drafts and submissions
- Reviewers see ads assigned to them
- Admins see all ads in system

---

# Notifications

System automatically notifies users via the application's existing notification framework:

| Event | Recipients | Notification | Channel |
|-------|---|---|---|
| **Ad Submitted** | Submitter + assigned Conversion Reviewer (pre-notification) | "Your ad [Campaign] has been submitted for review. Current stage: For AI Pre-Review" | In-app + Email |
| **AI Pre-Review Starts** | Submitter | "Your ad [Campaign] is now in AI Pre-Review. Expected completion: 5 minutes" | In-app |
| **AI Pre-Review Complete** | Submitter | "[Campaign] passed AI Pre-Review. Next stage: Brand Review" OR "[Campaign] needs revision. See feedback." | In-app + Email |
| **Brand Review Starts** | Submitter | "Your ad [Campaign] is now in Brand Review. Expected completion: 5 minutes" | In-app |
| **Brand Review Complete** | Submitter | "[Campaign] passed Brand Review. Now awaiting Conversion Review." OR "[Campaign] needs revision." | In-app + Email |
| **Assigned Conversion Reviewer** | Assigned Reviewer | "[Campaign] by [Submitter] is now awaiting your conversion review. Please review within 4 hours." | In-app + Email |
| **Technical Review Starts** | Submitter | "Your ad [Campaign] is now in Technical Review. Expected completion: 5 minutes" | In-app |
| **Technical Review Complete** | Submitter | "[Campaign] passed Technical Review. Now awaiting Penultimate Approver." OR "[Campaign] needs revision." | In-app + Email |
| **Assigned Penultimate Approver** | Penultimate Approver | "[Campaign] is now awaiting your penultimate approval." | In-app + Email |
| **Assigned Final Approver** | Final Approver | "[Campaign] is now awaiting your final approval." | In-app + Email |
| **Ad Approved** | Submitter + all reviewers (optional digest) | "🎉 [Campaign] has been approved and is ready to launch!" | In-app + Email |
| **Ad Rejected** | Submitter | "❌ [Campaign] has been rejected. Reason: [Reason]. You may create a new submission." | In-app + Email |
| **Needs Revision** | Submitter | "✏️ [Campaign] needs revision at [Stage]. Feedback: [Comments]. Please edit and resubmit." | In-app + Email |
| **Reviewer Escalation** | Next-level Reviewer | "[Campaign] escalated due to [reason]. Please assign backup or review manually." | In-app + Email |

### Notification Preferences

Users can configure:
- Email notifications: on/off
- In-app only: on/off
- Digest mode (daily email summary): on/off
- Notification quiet hours: (optional)

---

# Audit Log

Every state transition, review, and decision is logged immutably.

### Audit Log Schema

| Field | Type | Example |
|-------|------|---------|
| **id** | UUID | `550e8400-e29b-41d4-a716-446655440000` |
| **approval_id** | UUID | FK to Approval |
| **timestamp** | ISO 8601 | `2026-07-15T14:30:22Z` |
| **user_id** | UUID or "SYSTEM" | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| **user_email** | Email | `sean@agriko.ph` or `AI-PreReview-Agent` |
| **action** | Enum | `SUBMITTED`, `APPROVED`, `REJECTED`, `REVISION_REQUESTED`, `STATUS_CHANGED`, `AI_JOB_STARTED`, `AI_JOB_FAILED`, `REVIEW_ASSIGNED`, `REVIEW_COMPLETED`, `ESCALATED`, `CANCELLED` |
| **previous_status** | Enum | `DRAFT` |
| **new_status** | Enum | `FOR_AI_PRE_REVIEW` |
| **details** | JSON | `{ "revision_number": 2, "score": 24, "confidence": 0.92 }` |
| **comment** | Text (nullable) | "Logo placement needs improvement" |
| **ip_address** | IP (nullable) | `192.168.1.1` (for human actions only) |

### Queries Supported

- **List all actions for approval** — Used for revision history view
- **List all actions by user** — For user activity report
- **List all rejections in date range** — For rejection trend analysis
- **List all escalations** — For SLA tracking and escalation analysis

### Immutability Guarantee

- Audit log is **append-only**; no updates or deletes allowed
- Queries check row-level security; users can only view their own actions (or all if admin)
- Archive old records to cold storage after 24 months

---

# Data Model

## Core Tables

### Table: `Approval`

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | Unique approval identifier |
| `campaign_id` | Text | NOT NULL, UNIQUE | Campaign name/identifier |
| `submitter_id` | UUID | NOT NULL, FK:User | User who submitted ad |
| `current_revision` | Integer | DEFAULT 1 | Revision counter; incremented on re-submit after revision |
| `current_status` | Enum | NOT NULL | Current state (Draft, For AI Pre-Review, etc.) |
| `current_stage` | Enum | NOT NULL | Which review stage: PRE_REVIEW, BRAND, CONVERSION, TECHNICAL, PENULTIMATE, FINAL |
| `assigned_conversion_reviewer_id` | UUID | FK:User, NULLABLE | Assigned Conversion Reviewer |
| `assigned_penultimate_approver_id` | UUID | FK:User, NULLABLE | Assigned Penultimate Approver |
| `assigned_final_approver_id` | UUID | FK:User, NULLABLE | Assigned Final Approver |
| `approved_at` | Timestamp | NULLABLE | When final approval occurred |
| `rejected_at` | Timestamp | NULLABLE | When rejected (any stage) |
| `created_at` | Timestamp | NOT NULL, DEFAULT NOW() | Submission timestamp |
| `updated_at` | Timestamp | NOT NULL, DEFAULT NOW() | Last modification timestamp |
| `flags` | JSONB | NULLABLE | `{ "requires_manual_intervention": true, "reason": "AI job timeout after 3 retries" }` |
| `_version` | Integer | DEFAULT 1 | Optimistic lock counter |

**Indices:**
- PRIMARY KEY: `id`
- UNIQUE: `campaign_id`
- INDEX: `(submitter_id, current_status)`
- INDEX: `(current_status, current_stage)`
- INDEX: `(created_at DESC)` for sorting

---

### Table: `AdRevision`

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | Unique revision identifier |
| `approval_id` | UUID | FK:Approval, NOT NULL | Link to parent approval |
| `revision_number` | Integer | NOT NULL | 1, 2, 3, etc. |
| `submitted_at` | Timestamp | NOT NULL | When revision was submitted |
| `copy` | JSONB | NOT NULL | `{ "primary_text": "...", "headline": "...", "description": "...", "cta": "...", "start_date": "2026-08-01", "end_date": "2026-08-31" }` |
| `creative` | JSONB | NOT NULL | `{ "image_url": "...", "video_url": "...", "thumbnail_url": "...", "aspect_ratios": ["1:1", "16:9"], "logo_placement": "top-left", "captions": "..." }` |
| `status_at_submission` | Enum | NOT NULL | Status ad was in when revision created (usually NEEDS_REVISION) |

**Constraints:**
- UNIQUE: `(approval_id, revision_number)`
- FK: `approval_id` references `Approval(id)` ON DELETE RESTRICT (approvals never deleted)

**Indices:**
- PRIMARY KEY: `id`
- INDEX: `(approval_id, revision_number DESC)` for fetching latest revision

---

### Table: `Review`

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | Unique review identifier |
| `approval_id` | UUID | FK:Approval, NOT NULL | Link to approval |
| `revision_number` | Integer | NOT NULL | Which revision was this review for |
| `stage` | Enum | NOT NULL | PRE_REVIEW, BRAND_REVIEW, CONVERSION_REVIEW, TECHNICAL_REVIEW, PENULTIMATE_APPROVAL, FINAL_APPROVAL |
| `reviewer_type` | Enum | NOT NULL | AI or HUMAN |
| `reviewer_id` | UUID | FK:User, NULLABLE | If HUMAN, who reviewed. If AI, NULL. |
| `reviewer_name` | Text | NOT NULL | "AI Pre-Review Agent" or human name |
| `decision` | Enum | NOT NULL | PASS, NEEDS_REVISION, REJECTED |
| `score` | Decimal | NULLABLE | For Conversion Review: total 6–30. Per-question scores stored in `json_metadata` (needed to enforce the "no question below 3" floor). |
| `comments` | Text | NULLABLE | Reviewer comments; required if decision != PASS |
| `ai_report_id` | UUID | FK:AIReport, NULLABLE | If AI review, link to report |
| `started_at` | Timestamp | NOT NULL | When review began |
| `completed_at` | Timestamp | NOT NULL | When review completed |
| `json_metadata` | JSONB | NULLABLE | Additional structured data (e.g., individual question scores for Conversion Review) |

**Constraints:**
- FK: `approval_id` references `Approval(id)` ON DELETE RESTRICT
- FK: `reviewer_id` references `User(id)` ON DELETE RESTRICT (if NOT NULL)
- FK: `ai_report_id` references `AIReport(id)` ON DELETE SET NULL
- CHECK: `reviewer_type = 'HUMAN' AND reviewer_id IS NOT NULL OR reviewer_type = 'AI' AND reviewer_id IS NULL`
- CHECK: `decision = 'PASS' OR comments IS NOT NULL` (comments required if not passing)

**Indices:**
- PRIMARY KEY: `id`
- INDEX: `(approval_id, revision_number, completed_at DESC)` for fetching reviews

---

### Table: `AIReport`

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | Unique report identifier |
| `agent_name` | Text | NOT NULL | "Pre-Review Agent", "Brand Review Agent", "Technical Review Agent" |
| `approval_id` | UUID | FK:Approval, NOT NULL | Which approval generated this report |
| `revision_number` | Integer | NOT NULL | Which revision was evaluated |
| `overall_result` | Enum | NOT NULL | PASS, NEEDS_REVISION, REJECTED |
| `executive_summary` | Text | NOT NULL | 1-2 sentence summary |
| `validation_checks` | JSONB | NOT NULL | `[{ "check_name": "Grammar", "result": "PASS", "confidence": 0.95 }, ...]` |
| `warnings` | Text | NULLABLE | Low-confidence findings (60-80%) |
| `errors` | Text | NULLABLE | Issues detected |
| `recommendations` | Text | NULLABLE | Specific fixes recommended |
| `confidence_score` | Decimal | NOT NULL | 0.0 - 1.0 |
| `generated_at` | Timestamp | NOT NULL, DEFAULT NOW() | When report was generated |
| `raw_response` | JSONB | NULLABLE | Full AI API response (for debugging) |

**Constraints:**
- FK: `approval_id` references `Approval(id)` ON DELETE CASCADE

**Indices:**
- PRIMARY KEY: `id`
- INDEX: `(approval_id, generated_at DESC)` for fetching latest report

---

### Table: `ReviewerAssignment`

Centralized reviewer configuration; loaded on startup and cached.

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | |
| `role` | Enum | NOT NULL, UNIQUE | CONVERSION_REVIEWER, PENULTIMATE_APPROVER, FINAL_APPROVER |
| `assigned_user_id` | UUID | FK:User, NOT NULL | Who holds this role |
| `backup_user_id` | UUID | FK:User, NULLABLE | Escalation fallback |
| `updated_at` | Timestamp | NOT NULL, DEFAULT NOW() | When assignment changed |
| `updated_by` | UUID | FK:User, NOT NULL | Admin who made change |

**Constraints:**
- UNIQUE: `(role)` — one user per role
- FK: `assigned_user_id` references `User(id)` ON DELETE RESTRICT

---

### Table: `AIJobQueue`

Tracks async AI job execution for observability.

| Column | Type | Constraints | Notes |
|--------|------|---|---|
| `id` | UUID | PK | Job identifier |
| `approval_id` | UUID | FK:Approval, NOT NULL | Which approval triggered job |
| `stage` | Enum | NOT NULL | PRE_REVIEW, BRAND_REVIEW, TECHNICAL_REVIEW |
| `status` | Enum | NOT NULL | QUEUED, PROCESSING, COMPLETED, FAILED, RETRY |
| `attempt_number` | Integer | NOT NULL, DEFAULT 1 | Retry attempt counter |
| `error_message` | Text | NULLABLE | Last error (if failed) |
| `started_at` | Timestamp | NULLABLE | When job started processing |
| `completed_at` | Timestamp | NULLABLE | When job finished |
| `timeout_seconds` | Integer | NOT NULL | 90 for most jobs, 120 for Technical Review |
| `next_retry_at` | Timestamp | NULLABLE | When job will be retried (exponential backoff) |

**Indices:**
- PRIMARY KEY: `id`
- INDEX: `(approval_id, status)` for checking job state
- INDEX: `(status, next_retry_at)` for retry queue

---

## Relationships Summary

```
User
  ├── (1:N) → Approval (submitter_id, assigned_conversion_reviewer_id, assigned_penultimate_approver_id, assigned_final_approver_id)
  ├── (1:N) → Review (reviewer_id)
  ├── (1:N) → ReviewerAssignment (assigned_user_id, backup_user_id, updated_by)
  └── (1:N) → AuditLog (user_id)

Approval
  ├── (1:N) → AdRevision
  ├── (1:N) → Review
  ├── (1:N) → AIReport
  ├── (1:N) → AIJobQueue
  ├── (1:N) → AuditLog
  └── (N:M) → User (through assigned reviewers)

AdRevision
  └── (N:1) → Approval

Review
  ├── (N:1) → Approval
  ├── (N:1) → User (reviewer_id, if HUMAN)
  └── (N:1) → AIReport (ai_report_id, if AI)

AIReport
  └── (N:1) → Approval

AIJobQueue
  └── (N:1) → Approval
```

---

# Concurrency & Performance

## Concurrency Guarantees

- **Advisory locks on Approval records** prevent simultaneous state modifications
- **Optimistic locking** (version field) detects stale writes; transaction aborts and retry
- **No mid-stage edits** — submitter cannot modify ad while in active review; returns HTTP 409 Conflict
- **Idempotent state transitions** — re-running same transition twice produces same result

## Performance Targets

| Operation | Target | Notes |
|---|---|---|
| Submit ad for review | <500ms | All fields validated; revision created; job enqueued |
| AI job execution | <90s (Pre/Brand), <120s (Technical) | Includes API calls, report generation |
| Load approval dashboard | <2s | Paginated results; 20 records per page |
| Fetch full revision history | <1s | All revisions + reviews for single approval |
| List audit log (100 records) | <500ms | Indexed query |

## Database Optimization

- **Indices on (approval_id, status)** for fast lookups during workflow transitions
- **Partial indices on active statuses** to speed dashboard queries
- **Denormalization of current_status on Approval** to avoid joins
- **Archive old records** after 24 months to cold storage; maintain hot table <10M rows
- **Partitioning by created_at** (monthly) for audit log tables

---

# Error Handling & Edge Cases

## Edge Case: Reviewer Conflict of Interest

**Scenario:** Submitter is assigned as Conversion Reviewer.

**Resolution:**
1. System detects conflict during assignment
2. Escalates to Penultimate Approver instead
3. Logs escalation in audit trail
4. Notifies Penultimate Approver

## Edge Case: Reviewer Unavailable

**Scenario:** Assigned Conversion Reviewer has not accessed approval for 4+ hours.

**Resolution:**
1. System sends escalation notification to Penultimate Approver
2. Logs escalation with reason: "Conversion Reviewer unavailable >4h"
3. If backup assigned, auto-assigns backup
4. Penultimate Approver may manually assign new Conversion Reviewer or override

## Edge Case: AI Job Timeout

**Scenario:** AI Pre-Review job exceeds 90 seconds.

**Resolution:**
1. Job terminates; error logged
2. Status remains `For AI Pre-Review`
3. Job re-queued for retry (exponential backoff: 1m, 5m, 15m)
4. After 3 failed retries, approval flagged `REQUIRES_MANUAL_INTERVENTION`
5. Admin notified; approval review blocks until manual intervention

## Edge Case: Duplicate Submission

**Scenario:** User clicks "Submit for Review" twice rapidly.

**Resolution:**
1. First click enqueues job; status → `For AI Pre-Review`
2. Second click blocked; system returns HTTP 409 Conflict with error message: "Approval already submitted"

## Edge Case: Status Corruption

**Scenario:** Database corruption or manual intervention results in invalid state.

**Resolution:**
1. System detects invalid state on next workflow action
2. Admin notification sent
3. Approval locked; no transitions allowed
4. Admin must manually review and correct state

## Edge Case: Reviewer Modifies Own Score

**Scenario:** Conversion Reviewer updates score after submitting review.

**Resolution:**
1. Review is immutable once submitted
2. Reviewer cannot edit; system returns HTTP 403 Forbidden
3. Reviewer must contact admin to override (logged in audit trail)

---

| Permission | Role | Scope | Response if Denied |
|---|---|---|---|
| **Create Draft Ad** | Any authenticated user | Own drafts only | HTTP 403 Forbidden |
| **Submit Ad for Review** | Submitter | Own drafts only; all required fields present | HTTP 400 Bad Request (validation) |
| **Edit Draft Ad** | Submitter | Own drafts only; only if status = `Draft` | HTTP 409 Conflict if in active review: `{"error": "Cannot edit ad in active review stage. Current stage: [stage]. Status: [status].", "approval_id": "uuid"}` |
| **Withdraw Submission** | Submitter | Own active submissions only (status not Terminal) | HTTP 400 if already terminal |
| **Review Ads** | Conversion Reviewer, AI agents | Assigned approvals only (humans); all approvals (AI) | HTTP 403 Forbidden if not assigned |
| **Approve Ads** | Penultimate Approver, Final Approver | Assigned approvals only | HTTP 403 Forbidden if not assigned |
| **Reject Ads** | Any reviewer | Assigned approvals only; must provide reason | HTTP 400 if reason missing |
| **Request Revision** | Any reviewer | Assigned approvals only; must provide comments | HTTP 400 if comments missing |
| **View Audit Log** | Admin, Reviewer (own actions only) | Own actions (users); all actions (admins) | HTTP 403 Forbidden if not permitted |
| **Configure Approver Settings** | Admin | All role assignments; cannot unassign (must reassign) | HTTP 400 if attempting unassign |
| **Force State Transition** | Admin | Any approval; requires justification in comments | HTTP 400 if reason missing |
| **View Dashboard** | Any authenticated user | Own records + assigned reviews | HTTP 403 Forbidden if not owner/assigned |
| **Escalate Reviewer** | Admin, next-level reviewer | Escalate current approver to next level; SLA breach reason required | HTTP 400 if invalid target |
| **Delete Draft Ad** | Submitter, Admin | Own/any draft only; only if status = `Draft` | HTTP 409 Conflict if not draft; HTTP 403 if not owner/admin |

---

# Future Enhancements (Out of Scope)

The following features are identified as valuable but are explicitly out of scope for v1.0:

- Automatic publishing to Facebook after final approval
- Integration with Meta Ads Manager (read/write)
- Conditional workflows (e.g., skip Conversion Review for video ads)
- Parallel review workflows (multiple reviewers simultaneously)
- AI-assisted copy rewriting with automatic suggestions
- AI-generated approval summaries
- Slack/Microsoft Teams/Discord notifications
- Reviewer performance analytics and SLA dashboards
- Custom workflows by campaign type or product category
- Approval templates and bulk approvals
- Email/Slack digest of pending reviews (weekly summary)
- Real-time notifications via WebSocket
- Approval time predictions based on historical data

---

# Out of Scope (v1.0)

## Campaign Management
The approval workflow shall not:
- Create Facebook campaigns
- Publish advertisements to Facebook
- Schedule advertisements
- Manage campaign budgets or bid strategies
- Pause/resume live campaigns

## Creative Generation
The approval workflow shall not:
- Generate ad copy
- Generate images or videos
- Edit creative assets
- Rewrite advertisements
- Automatically fix issues

AI agents identify issues and provide recommendations only; all revisions remain the submitter's responsibility.

## Approval Workflow (Immutability)
The workflow shall not:
- Skip required review stages
- Allow reviewers to approve their own submissions
- Modify completed review records
- Delete approval or audit history
- Modify audit log entries

Every approval decision shall remain permanently traceable.

## User Management
The workflow shall not:
- Create or manage users
- Create or manage roles
- Authenticate users

Authentication and user management remain the responsibility of the existing plugin and application.

## Notifications (External Systems)
The workflow shall not implement custom messaging systems; it shall only use the application's existing notification framework.

---

# Implementation Checklist

## Database & Schema
- [ ] Database schema created with all 9+ tables, indices, and constraints
- [ ] ReviewerAssignment constraint enforced (all 3 roles always assigned)
- [ ] Optimistic locking (_version field) tested on Approval updates
- [ ] Immutability constraints verified (no updates to AdRevision, Review, AIReport, AuditLog)
- [ ] Foreign key cascades configured correctly (ON DELETE RESTRICT for critical paths)

## State Machine & Workflow
- [ ] Approval state machine implemented with all transitions
- [ ] Conflict-of-interest detection implemented and tested (all 3 scenarios)
- [ ] Role requirement enforcement tested (startup validation, runtime checks)
- [ ] Revision workflow tested end-to-end (create → resubmit → history preservation)
- [ ] Status transition validation (only allowed transitions permitted)

## AI Orchestration
- [ ] AI job queue implemented with status tracking (QUEUED, PROCESSING, COMPLETED, FAILED, RETRY)
- [ ] Job timeout enforcement: 90s for Pre-Review/Brand/Technical, 120s for Technical Review
- [ ] Exponential backoff retry logic (1m, 5m, 15m) with 3-retry limit
- [ ] AI job failure handling (flag approval, notify admin after max retries)
- [ ] AI Report schema implemented with all required fields
- [ ] Confidence thresholds enforced per AI agent
- [ ] Advisory locks acquired during job execution to prevent race conditions

## SLA & Escalation
- [ ] ApprovalSLAEscalationWorker background job implemented (runs every 5 minutes)
- [ ] Conversion Reviewer SLA (4 hours) tested with auto-escalation to backup
- [ ] Penultimate Approver SLA (8 hours) tested with escalation to Final Approver
- [ ] Final Approver SLA (24 hours) tested with admin notification and manual intervention flag
- [ ] Escalation notifications sent correctly to next-level reviewer/admin
- [ ] Escalation audit log entries created with proper details
- [ ] Backup reviewer auto-assignment working when configured
- [ ] Admin notification triggered when backup not configured

## Conflict-of-Interest Detection
- [ ] Conflict detection at Technical Review → Penultimate Approver transition
- [ ] When conflict detected: escalate to Final Approver, skip Penultimate stage, notify Final Approver
- [ ] Conflict detection at Penultimate Approver → Final Approver transition
- [ ] When unresolvable conflict: HTTP 409 Conflict, flag for manual intervention, notify admin
- [ ] Audit log entries created for all conflict scenarios (CONFLICT_ESCALATED, CONFLICT_UNRESOLVABLE)
- [ ] Edge case tested: submitter is both Penultimate and Final Approver (returns error, requires manual fix)

## UI & Dashboard
- [ ] Conversion Reviewer UI with 6-question scoring rubric (1–5 scale)
- [ ] Score calculation and validation (≥24/30 total AND no question below 3 to pass)
- [ ] Dashboard sections implemented: My Drafts, Awaiting My Review, Needs My Revision, Approved, Rejected, Recent Activity
- [ ] Dashboard filtering (by stage, submitter, reviewer, date, status)
- [ ] Dashboard sorting (by last updated, created, stage, submitter)
- [ ] Draft edit blocking when ad in active review (HTTP 409 response)
- [ ] Revision history panel showing all revisions with timestamps and reviews

## Data Integrity & Audit
- [ ] Audit log created for all actions (submit, approve, reject, revision, escalation, transition)
- [ ] Audit log immutability verified (no updates/deletes)
- [ ] Revision history immutability verified (old revisions cannot be modified)
- [ ] Review records immutable after submission (HTTP 403 if edit attempted)
- [ ] Audit log queries efficient (indexed on (approval_id, action), (user_id, timestamp))

## Concurrency & Performance
- [ ] Advisory locks prevent simultaneous state modifications to same approval
- [ ] Optimistic locking detects stale writes; transaction aborts with retry guidance
- [ ] No mid-stage edits (returns HTTP 409 if attempted while in active review)
- [ ] Idempotent state transitions (re-running same transition twice = same result)
- [ ] Dashboard load time <2s (20 records paginated)
- [ ] Approval submission <500ms (all validations + job enqueue)
- [ ] AI job execution <90-120s (includes API calls, report generation)
- [ ] Audit log queries <500ms (100 records)
- [ ] Load testing passed (500+ concurrent approvals with <5% lock contention)

## Error Handling & Edge Cases
- [ ] Duplicate submission blocked (HTTP 409)
- [ ] AI job timeout handled (status remains, retried with backoff)
- [ ] AI job crash handled (logged, retried)
- [ ] AI API unavailable handled (graceful failure, retried)
- [ ] All 3 retries exhausted (approval flagged REQUIRES_MANUAL_INTERVENTION, admin notified)
- [ ] Reviewer unavailable mid-review (SLA escalation triggered correctly)
- [ ] Role becomes unassigned mid-operation (detected, flagged for intervention)
- [ ] Concurrent reviewer actions blocked (lock contention detected, one transaction aborts)
- [ ] Invalid state detected (admin notified, approval locked)
- [ ] Reviewer attempts self-approval (conflict detection prevents)

## Permissions & Security
- [ ] Permissions model implemented (all roles and scopes)
- [ ] HTTP response codes correct for all denied permissions (403, 409)
- [ ] Submitter cannot edit ad in active review (HTTP 409)
- [ ] Submitter cannot delete ad not in Draft state (HTTP 409)
- [ ] Reviewer cannot edit completed review (HTTP 403)
- [ ] Audit log accessible only to actor (user) or admin (all)
- [ ] Admin forced transitions require justification (audit log records)

## Notifications
- [ ] All notification events implemented (submit, review start, review complete, approve, reject, revision, escalation)
- [ ] Notification messages contain campaign name, submitter, stage, feedback
- [ ] Email notifications sent correctly
- [ ] In-app notifications created correctly
- [ ] Notification preferences respected (email on/off, digest mode, quiet hours)
- [ ] SLA escalation notifications sent to correct recipient

## Admin Tooling
- [ ] Settings UI for reviewer role assignment (Conversion, Penultimate, Final)
- [ ] Settings validation (cannot unassign role, must use "Reassign" endpoint)
- [ ] Backup reviewer assignment in Settings
- [ ] Manual escalation trigger available (admin can force escalation with justification)
- [ ] Manual state transition available (admin can transition with justification)
- [ ] Startup validation (all 3 roles assigned before app starts; exits if any missing)
- [ ] Admin dashboard showing escalations, manual interventions, SLA breaches

## Documentation
- [ ] Admin guide: Settings, reviewer assignment, escalation, manual overrides, SLA management
- [ ] Submitter guide: Submission process, draft creation, revision workflow, dashboard
- [ ] Reviewer guide: Review process, scoring rubric (behavioral anchors), feedback guidelines
- [ ] API documentation: All endpoints, error codes (400, 403, 409, 500), request/response schemas
- [ ] Runbook: Common issues (reviewer unassigned, SLA breach, conflict of interest), resolution steps
- [ ] Data retention policy: Audit log archival after 24 months, approval record retention

## Testing & QA
- [ ] Unit tests: State machine transitions, conflict detection, role validation
- [ ] Integration tests: End-to-end workflow (draft → submit → AI reviews → human reviews → approve)
- [ ] Integration tests: Revision workflow (needs revision → edit → resubmit → restart)
- [ ] Integration tests: SLA escalation (create in-progress approval → wait >SLA → verify escalation)
- [ ] Integration tests: Conflict of interest (submitter as reviewer → escalate → verify)
- [ ] Load tests: 500 concurrent approvals, verify <5% lock contention
- [ ] Concurrency tests: Simultaneous edits to same approval (one succeeds, one fails with optimistic lock)
- [ ] Error scenario tests: AI timeout, API failure, invalid state, reviewer unavailable
- [ ] Security tests: Unauthorized access attempts, invalid role checks, audit log access control
- [ ] Performance tests: Dashboard load, approval submission, audit log queries all meet targets

---

# Appendix: Revision Workflow Example

**Scenario: User submits ad, AI Pre-Review requests revision, user edits and resubmits.**

### Step 1: Initial Submission

```
User: Clicks "Submit for Review"
System:
  - Creates Approval (revision=1, status=Draft)
  - Creates AdRevision (revision_number=1, copy={...}, creative={...})
  - Status → For AI Pre-Review
  - Enqueues AIJobQueue (stage=PRE_REVIEW, status=QUEUED)
  - Audit log: SUBMITTED
  - Notifies Submitter: "Ad submitted"
```

### Step 2: AI Pre-Review Fails

```
AIJobQueue worker:
  - Picks job from queue
  - Acquires advisory lock on Approval
  - Status → In AI Pre-Review
  - Runs AI Pre-Review Agent
  - Agent finds: Grammar error, prohibited wording
  - Creates AIReport (overall_result=NEEDS_REVISION)
  - Creates Review (decision=NEEDS_REVISION, comments="Check grammar in headline. Avoid 'guaranteed'")
  - Status → Needs Revision
  - Release lock
  - Audit log: REVIEW_COMPLETED, decision=NEEDS_REVISION

System:
  - Notifies Submitter: "Your ad needs revision. See feedback."
  - Dashboard shows "Needs Revision" in Needs My Revision section
```

### Step 3: User Edits Draft

```
User: Clicks "Edit" on Needs Revision ad
System:
  - Status → Draft (workflow resets)
  - User edits copy/creative
  - Audit log: REVISION_EDITED
```

### Step 4: User Resubmits

```
User: Clicks "Submit for Review"
System:
  - Increments Approval.current_revision (1 → 2)
  - Creates new AdRevision (revision_number=2, copy={...updated...}, creative={...updated...})
  - Status → For AI Pre-Review
  - Enqueues new AIJobQueue (stage=PRE_REVIEW, status=QUEUED, attempt_number=1)
  - Audit log: RE_SUBMITTED, revision_number=2
  - Notifies Submitter: "Revision 2 submitted for review"

AIJobQueue worker:
  - Picks job from queue
  - Runs AI Pre-Review Agent on Revision 2
  - Agent passes all checks
  - Creates AIReport (overall_result=PASS)
  - Creates Review (decision=PASS)
  - Status → For Brand Review
  - Enqueues AIJobQueue (stage=BRAND_REVIEW)
  - Audit log: REVIEW_COMPLETED, decision=PASS

System:
  - Notifies Submitter: "Your ad passed AI Pre-Review. Next stage: Brand Review"
```

### Step 5: Revision History

```
Dashboard → View Approval:
  - Revision 1 (NEEDS_REVISION)
    - Submitted: 2026-07-15 14:00:00
    - Reviews: AI Pre-Review (NEEDS_REVISION, "Check grammar...")
    - Status: Needs Revision
  - Revision 2 (IN_PROGRESS)
    - Submitted: 2026-07-15 14:15:00
    - Reviews: AI Pre-Review (PASS), AI Brand Review (IN_PROGRESS)
    - Status: In Brand Review
```

---

# Appendix: Contact Information for Questions

- **Spec Owner:** Sean (sean@agriko.ph)
- **Implementation Lead:** [To be assigned]
- **Questions/Clarifications:** [Spec review process TBD]

---

**Document Version:** 2.0  
**Last Updated:** 2026-07-15  
**Status:** Ready for Implementation
