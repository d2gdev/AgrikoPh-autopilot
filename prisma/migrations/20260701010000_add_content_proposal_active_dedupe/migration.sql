-- Enforce active Content Pilot proposal idempotency for SEO Pilot and manual
-- proposal creation. Rejected/completed historical rows may duplicate; active
-- operator-review rows may not duplicate the same logical action.
--
-- Existing duplicate active rows must be resolved before this migration runs.

CREATE UNIQUE INDEX IF NOT EXISTS "ContentProposal_active_action_dedupe_key"
  ON "ContentProposal" (
    "proposalType",
    COALESCE("articleHandle", ''),
    lower("title")
  )
  WHERE "status" IN ('pending', 'approved', 'override_approved');
